import type { ContentPart, NormalizedMessage, NormalizedRequest, NormalizedTool } from "@command-go-pool/shared";
import { z } from "zod";

const imageSource = z.object({
  type: z.enum(["base64", "url"]),
  media_type: z.string().optional(),
  data: z.string().optional(),
  url: z.string().optional(),
});

const contentBlock = z.union([
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("image"), source: imageSource }),
  z.object({ type: z.literal("tool_use"), id: z.string(), name: z.string(), input: z.unknown() }),
  z.object({
    type: z.literal("tool_result"),
    tool_use_id: z.string(),
    content: z.union([z.string(), z.array(z.unknown())]).optional(),
    is_error: z.boolean().optional(),
  }),
]);

export const anthropicMessageSchema = z.object({
  model: z.string(),
  max_tokens: z.number(),
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.union([z.string(), z.array(contentBlock)]),
    }),
  ),
  system: z.union([z.string(), z.array(z.object({ type: z.literal("text"), text: z.string() }))]).optional(),
  tools: z
    .array(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        input_schema: z.record(z.unknown()),
      }),
    )
    .optional(),
  stream: z.boolean().optional(),
  temperature: z.number().optional(),
  metadata: z.record(z.unknown()).optional(),
  thinking: z.object({ type: z.string().optional(), budget_tokens: z.number().optional() }).optional(),
});

export type AnthropicMessageRequest = z.infer<typeof anthropicMessageSchema>;

export function isAnthropicQuotaProbe(body: AnthropicMessageRequest): boolean {
  if (body.max_tokens !== 1) return false;
  if (body.tools && body.tools.length > 0) return false;
  if (body.messages.length !== 1) return false;
  const message = body.messages[0];
  if (!message || message.role !== "user") return false;
  let text: string | undefined;
  if (typeof message.content === "string") {
    text = message.content;
  } else {
    const part = message.content[0];
    if (message.content.length === 1 && part?.type === "text") text = part.text;
  }
  return text?.trim().toLowerCase() === "quota";
}

export function anthropicToNormalized(body: AnthropicMessageRequest, aliases: Record<string, string>): NormalizedRequest {
  const system = typeof body.system === "string" ? body.system : body.system?.map((b) => b.text).join("\n");
  const messages: NormalizedMessage[] = [];
  for (const message of body.messages) {
    const parts = typeof message.content === "string" ? [{ type: "text" as const, text: message.content }] : message.content;
    const mapped: ContentPart[] = [];
    const toolResults: ContentPart[] = [];
    for (const part of parts) {
      if (part.type === "text") mapped.push({ type: "text", text: part.text });
      if (part.type === "image") {
        mapped.push({
          type: "image",
          mediaType: part.source.media_type ?? "image/png",
          base64: part.source.type === "base64" ? part.source.data : undefined,
          url: part.source.type === "url" ? part.source.url : undefined,
        });
      }
      if (part.type === "tool_use") mapped.push({ type: "tool-call", id: part.id, name: part.name, arguments: part.input });
      if (part.type === "tool_result") {
        const output = typeof part.content === "string" ? part.content : JSON.stringify(part.content ?? "");
        toolResults.push({ type: "tool-result", id: part.tool_use_id, output, isError: part.is_error });
      }
    }
    if (toolResults.length) messages.push({ role: "tool", content: toolResults });
    if (mapped.length) messages.push({ role: message.role, content: mapped });
  }
  const tools: NormalizedTool[] | undefined = body.tools?.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.input_schema,
  }));
  const effort = body.thinking?.budget_tokens
    ? body.thinking.budget_tokens > 16_000
      ? "high"
      : body.thinking.budget_tokens > 4_000
        ? "medium"
        : "low"
    : undefined;
  return {
    model: aliases[body.model] ?? body.model,
    system,
    messages,
    tools,
    temperature: body.temperature,
    maxTokens: body.max_tokens,
    stream: Boolean(body.stream),
    reasoningEffort: effort,
    metadata: body.metadata,
    sessionHint: typeof body.metadata?.session_id === "string" ? body.metadata.session_id : undefined,
  };
}
