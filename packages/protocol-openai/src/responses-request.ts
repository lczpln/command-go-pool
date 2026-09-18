import type { ContentPart, NormalizedMessage, NormalizedRequest, NormalizedTool } from "@command-go-pool/shared";
import { z } from "zod";

const looseObject = z.record(z.unknown());

export const responsesRequestSchema = z.object({
  model: z.string(),
  instructions: z.string().optional(),
  input: z.union([z.string(), z.array(looseObject)]),
  tools: z.array(looseObject).optional(),
  tool_choice: z.unknown().optional(),
  parallel_tool_calls: z.boolean().optional(),
  reasoning: z
    .object({ effort: z.string().optional(), summary: z.string().optional() })
    .passthrough()
    .nullish(),
  store: z.boolean().optional(),
  stream: z.boolean().optional(),
  stream_options: z.unknown().optional(),
  include: z.array(z.string()).optional(),
  service_tier: z.string().nullish(),
  prompt_cache_key: z.string().nullish(),
  text: z.unknown().optional(),
  client_metadata: z.record(z.unknown()).nullish(),
  access_programs: z.unknown().optional(),
  temperature: z.number().optional(),
  max_output_tokens: z.number().optional(),
  previous_response_id: z.string().nullish(),
  metadata: z.record(z.unknown()).optional(),
});

export type ResponsesRequest = z.infer<typeof responsesRequestSchema>;

export function responsesToNormalized(body: ResponsesRequest, aliases: Record<string, string>): NormalizedRequest {
  const systemParts: string[] = [];
  if (body.instructions?.trim()) systemParts.push(body.instructions);
  const messages: NormalizedMessage[] = [];
  const items: Record<string, unknown>[] =
    typeof body.input === "string" ? [{ type: "message", role: "user", content: [{ type: "input_text", text: body.input }] }] : body.input;
  for (const item of items) {
    const type = str(item.type);
    if (type === "message") {
      const role = str(item.role);
      const parts = messageParts(item.content);
      if (role === "system" || role === "developer") {
        const text = parts
          .filter((part): part is Extract<ContentPart, { type: "text" }> => part.type === "text")
          .map((part) => part.text)
          .join("\n")
          .trim();
        if (text) systemParts.push(text);
        continue;
      }
      if (role !== "user" && role !== "assistant") continue;
      if (!parts.length) continue;
      messages.push({ role, content: parts });
      continue;
    }
    if (type === "function_call") {
      const name = str(item.name);
      const callId = str(item.call_id) ?? str(item.id);
      if (!name || !callId) continue;
      pushToolCall(messages, { type: "tool-call", id: callId, name, arguments: parseArguments(item.arguments) });
      continue;
    }
    if (type === "custom_tool_call") {
      const name = str(item.name);
      const callId = str(item.call_id) ?? str(item.id);
      if (!name || !callId) continue;
      pushToolCall(messages, { type: "tool-call", id: callId, name, arguments: str(item.input) ?? "" });
      continue;
    }
    if (type === "function_call_output" || type === "custom_tool_call_output") {
      const callId = str(item.call_id);
      if (!callId) continue;
      messages.push({
        role: "tool",
        content: [{ type: "tool-result", id: callId, name: str(item.name), output: toolOutput(item.output) }],
      });
      continue;
    }
  }
  const tools = mapTools(body.tools);
  const metadata = { ...(body.metadata ?? {}), ...(body.client_metadata ?? {}) };
  return {
    model: aliases[body.model] ?? body.model,
    messages,
    system: systemParts.filter(Boolean).join("\n\n") || undefined,
    tools: tools.length ? tools : undefined,
    toolChoice: mapToolChoice(body.tool_choice),
    temperature: body.temperature,
    maxTokens: body.max_output_tokens,
    stream: Boolean(body.stream),
    reasoningEffort: body.reasoning?.effort,
    promptCacheKey: body.prompt_cache_key ?? undefined,
    metadata: Object.keys(metadata).length ? metadata : undefined,
  };
}

function pushToolCall(messages: NormalizedMessage[], part: Extract<ContentPart, { type: "tool-call" }>): void {
  const last = messages[messages.length - 1];
  if (last && last.role === "assistant" && last.content.length > 0 && last.content.every((item) => item.type === "tool-call")) {
    last.content.push(part);
    return;
  }
  messages.push({ role: "assistant", content: [part] });
}

function messageParts(content: unknown): ContentPart[] {
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
  if (!Array.isArray(content)) return [];
  const parts: ContentPart[] = [];
  for (const raw of content) {
    const part = asObject(raw);
    if (!part) continue;
    const type = str(part.type);
    if (type === "input_text" || type === "output_text" || type === "text") {
      const text = str(part.text);
      if (text) parts.push({ type: "text", text });
      continue;
    }
    if (type === "input_image") {
      const url = str(part.image_url) ?? str(part.url);
      if (url) parts.push(parseImageUrl(url));
      continue;
    }
    if (type === "refusal") {
      const text = str(part.refusal);
      if (text) parts.push({ type: "text", text });
    }
  }
  return parts;
}

function parseImageUrl(url: string): ContentPart {
  const match = url.match(/^data:([^;]+);base64,(.+)$/);
  if (match) return { type: "image", mediaType: match[1] ?? "image/png", base64: match[2] };
  return { type: "image", mediaType: "image/png", url };
}

function parseArguments(value: unknown): unknown {
  if (typeof value !== "string") return value ?? {};
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function toolOutput(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((raw) => {
        const part = asObject(raw);
        if (!part) return "";
        if (typeof part.text === "string") return part.text;
        if (part.type === "input_image") return "[image]";
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (value === undefined || value === null) return "";
  return JSON.stringify(value);
}

function mapTools(tools: Record<string, unknown>[] | undefined): NormalizedTool[] {
  const out: NormalizedTool[] = [];
  const seen = new Set<string>();
  const add = (name: string | undefined, description: string | undefined, inputSchema: Record<string, unknown>) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    out.push({ name, description, inputSchema });
  };
  const walk = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const raw of list) {
      const tool = asObject(raw);
      if (!tool) continue;
      const type = str(tool.type);
      if (type === "function") {
        add(str(tool.name), str(tool.description), asObject(tool.parameters) ?? { type: "object", properties: {} });
        continue;
      }
      if (type === "custom") {
        add(str(tool.name), str(tool.description), { type: "object", properties: {} });
        continue;
      }
      if (type === "namespace") walk(tool.tools);
    }
  };
  walk(tools);
  return out;
}

function mapToolChoice(choice: unknown): NormalizedRequest["toolChoice"] {
  if (choice === "auto" || choice === "none" || choice === "required") return choice;
  const object = asObject(choice);
  if (!object) return undefined;
  if (str(object.type) === "function") {
    const name = str(object.name) ?? str(asObject(object.function)?.name);
    if (name) return { name };
  }
  return "auto";
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
