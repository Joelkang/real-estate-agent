import { routeAgentRequest, type Schedule } from "agents";
import { AIChatAgent } from "agents/ai-chat-agent";
import { tools} from "./tools";
import  { createDataStreamResponse, streamText, type StreamTextOnFinishCallback ,  type ToolSet } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { processToolCalls } from "./utils";

// Example state type for the agent
interface ChatState {
  messageHistory: { id: string; role: string; content: string; createdAt: Date }[];
}

export class RealEstateAgent extends AIChatAgent<Env, ChatState> {
  initialState: ChatState = { messageHistory: [] };
  gateway = this.env.AI.gateway(this.env.CLOUDFLARE_AI_GATEWAY_ID);

  // Handles incoming chat messages and generates a response using Cloudflare AI Gateway
  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    options?: { abortSignal: AbortSignal | undefined }
  ): Promise<Response | undefined> {
    const dataStreamResponse = createDataStreamResponse({
      execute: async (dataStream) => {
        // Utility function to handle tools that require human confirmation
        // Checks for confirmation in last message and then runs associated tool
        const processedMessages = await processToolCalls(
          {
            dataStream,
            messages: this.messages,
            tools,
          },
          {
            // type-safe object for tools without an execute function
            getWeatherInformation: async ({ city }) => {
              const conditions = ["sunny", "cloudy", "rainy", "snowy"];
              return `The weather in ${city} is ${
                conditions[Math.floor(Math.random() * conditions.length)]
              }.`;
            },
          }
        );


        const google = createGoogleGenerativeAI({
          apiKey: this.env.GOOGLE_AI_STUDIO_TOKEN,
          baseURL: `${await this.gateway.getUrl("google-ai-studio")}/v1beta`,
          headers: {
            // "x-goog-api-key": this.env.GOOGLE_AI_STUDIO_TOKEN,
            'cf-aig-authorization':`Bearer ${this.env.CLOUDFLARE_AI_GATEWAY_API_TOKEN}`,
          }
        });
        const model = google.chat(this.env.GOOGLE_AI_MODEL)


        const result = streamText({
          model,
          messages: processedMessages,
          tools,
          onError(e) {
            console.log('error' , e)
          },
          onFinish,
        });
  
        result.mergeIntoDataStream(dataStream);
      },
    });

    return dataStreamResponse;
  
  }

  // Example: handle a scheduled task
  async executeTask(description: string, task: Schedule<string>) {
    this.setState({
      ...this.state,
      messageHistory: [
        ...this.state.messageHistory,
        { id: crypto.randomUUID(), role: "system", content: `Running scheduled task: ${description}`, createdAt: new Date() },
      ],
    });
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
