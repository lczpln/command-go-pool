import type { NormalizedChunk, TokenUsage } from "@command-go-proxy/shared";
import { openaiUsage } from "./request.js";

export function openaiChunkFrame(id: string, model: string, created: number, chunk: NormalizedChunk): string | undefined {
  if (chunk.type === "text-delta") {
    return sse(delta(id, model, created, { content: chunk.text }));
  }
  if (chunk.type === "reasoning-delta") {
    return sse(delta(id, model, created, { reasoning_content: chunk.text }));
  }
  if (chunk.type === "tool-call-delta") {
    return sse(
      delta(id, model, created, {
        tool_calls: [
          {
            index: 0,
            id: chunk.id,
            type: "function",
            function: { name: chunk.name, arguments: chunk.argumentsDelta },
          },
        ],
      }),
    );
  }
  if (chunk.type === "tool-call") {
    return sse(
      delta(id, model, created, {
        tool_calls: [
          {
            index: 0,
            id: chunk.id,
            type: "function",
            function: { name: chunk.name, arguments: JSON.stringify(chunk.arguments ?? {}) },
          },
        ],
      }),
    );
  }
  if (chunk.type === "finish") {
    const finish = chunk.reason === "tool-calls" ? "tool_calls" : chunk.reason === "length" ? "length" : "stop";
    const usageChunk = chunk.usage ? sse({ id, object: "chat.completion.chunk", created, model, choices: [], usage: openaiUsage(chunk.usage) }) : "";
    return `${sse(delta(id, model, created, {}, finish))}${usageChunk}data: [DONE]\n\n`;
  }
  return undefined;
}

export function openaiFinal(id: string, model: string, created: number, text: string, toolCalls: { id: string; name: string; arguments: string }[], usage?: TokenUsage, reasoning?: string) {
  return {
    id,
    object: "chat.completion",
    created,
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: text || null,
          ...(reasoning ? { reasoning_content: reasoning } : {}),
          ...(toolCalls.length
            ? {
                tool_calls: toolCalls.map((c) => ({
                  id: c.id,
                  type: "function",
                  function: { name: c.name, arguments: c.arguments },
                })),
              }
            : {}),
        },
        finish_reason: toolCalls.length ? "tool_calls" : "stop",
      },
    ],
    usage: openaiUsage(usage),
  };
}

function delta(id: string, model: string, created: number, delta: Record<string, unknown>, finish?: string) {
  return {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finish ?? null }],
  };
}

function sse(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}
