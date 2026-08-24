import type { ContentPart, NormalizedMessage, NormalizedRequest, NormalizedTool, TokenUsage } from "@command-go-proxy/shared";
import { z } from "zod";

const partSchema = z.union([
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("image_url"),
    image_url: z.object({ url: z.string() }),
  }),
  z.object({
    type: z.literal("image"),
    source: z.record(z.unknown()).optional(),
  }),
]);

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool", "function"]),
  content: z.union([z.string(), z.array(partSchema), z.null()]).optional(),
  name: z.string().optional(),
  tool_calls: z
    .array(
      z.object({
        id: z.string(),
        type: z.string().optional(),
        function: z.object({ name: z.string(), arguments: z.string() }),
      }),
    )
    .optional(),
  tool_call_id: z.string().optional(),
});

export const openaiChatSchema = z.object({
  model: z.string(),
  messages: z.array(messageSchema),
  stream: z.boolean().optional(),
  temperature: z.number().optional(),
  max_tokens: z.number().optional(),
  max_completion_tokens: z.number().optional(),
  tools: z
    .array(
      z.object({
        type: z.literal("function"),
        function: z.object({
          name: z.string(),
          description: z.string().optional(),
          parameters: z.record(z.unknown()).optional(),
        }),
      }),
    )
    .optional(),
  tool_choice: z.union([z.string(), z.object({ type: z.string(), function: z.object({ name: z.string() }) })]).optional(),
  reasoning_effort: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  prompt_cache_key: z.string().optional(),
});

export type OpenAIChatRequest = z.infer<typeof openaiChatSchema>;

export function openaiToNormalized(body: OpenAIChatRequest, aliases: Record<string, string>): NormalizedRequest {
  const model = aliases[body.model] ?? body.model;
  const messages: NormalizedMessage[] = body.messages.map(mapMessage);
  const tools: NormalizedTool[] | undefined = body.tools?.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    inputSchema: t.function.parameters ?? { type: "object", properties: {} },
  }));
  let toolChoice: NormalizedRequest["toolChoice"];
  if (body.tool_choice === "none" || body.tool_choice === "auto" || body.tool_choice === "required") {
    toolChoice = body.tool_choice;
  } else if (typeof body.tool_choice === "object") {
    toolChoice = { name: body.tool_choice.function.name };
  }
  return {
    model,
    messages,
    tools,
    toolChoice,
    temperature: body.temperature,
    maxTokens: body.max_tokens ?? body.max_completion_tokens,
    stream: Boolean(body.stream),
    reasoningEffort: body.reasoning_effort,
    promptCacheKey: body.prompt_cache_key,
    metadata: body.metadata,
  };
}

function mapMessage(message: z.infer<typeof messageSchema>): NormalizedMessage {
  const content: ContentPart[] = [];
  if (typeof message.content === "string") content.push({ type: "text", text: message.content });
  else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part.type === "text") content.push({ type: "text", text: part.text });
      if (part.type === "image_url") content.push(parseImageUrl(part.image_url.url));
    }
  }
  if (message.tool_calls) {
    for (const call of message.tool_calls) {
      let args: unknown = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        args = call.function.arguments;
      }
      content.push({ type: "tool-call", id: call.id, name: call.function.name, arguments: args });
    }
  }
  if (message.role === "tool" || message.role === "function") {
    content.push({
      type: "tool-result",
      id: message.tool_call_id ?? "tool",
      name: message.name,
      output: typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? ""),
    });
    return { role: "tool", content };
  }
  return { role: message.role, content };
}

function parseImageUrl(url: string): ContentPart {
  const match = url.match(/^data:([^;]+);base64,(.+)$/);
  if (match) return { type: "image", mediaType: match[1] ?? "image/png", base64: match[2] };
  return { type: "image", mediaType: "image/png", url };
}

export function openaiUsage(usage?: TokenUsage) {
  if (!usage) return undefined;
  const prompt = (usage.inputTokens ?? 0) + (usage.cacheReadTokens ?? 0);
  return {
    prompt_tokens: prompt,
    completion_tokens: usage.outputTokens ?? 0,
    total_tokens: prompt + (usage.outputTokens ?? 0),
    prompt_tokens_details: usage.cacheReadTokens
      ? { cached_tokens: usage.cacheReadTokens }
      : undefined,
    completion_tokens_details: usage.reasoningTokens ? { reasoning_tokens: usage.reasoningTokens } : undefined,
  };
}
