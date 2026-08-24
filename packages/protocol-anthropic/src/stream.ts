import type { NormalizedChunk, TokenUsage } from "@command-go-proxy/shared";

export function anthropicStreamFrames(messageId: string, model: string, chunk: NormalizedChunk, state: { started: boolean; block: number }): string {
  const frames: string[] = [];
  if (!state.started) {
    state.started = true;
    frames.push(event("message_start", {
      type: "message_start",
      message: {
        id: messageId,
        type: "message",
        role: "assistant",
        content: [],
        model,
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    }));
    frames.push(event("content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    }));
  }
  if (chunk.type === "text-delta") {
    frames.push(event("content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: chunk.text },
    }));
  }
  if (chunk.type === "reasoning-delta") {
    frames.push(event("content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "thinking_delta", thinking: chunk.text },
    }));
  }
  if (chunk.type === "tool-call") {
    state.block += 1;
    frames.push(event("content_block_start", {
      type: "content_block_start",
      index: state.block,
      content_block: { type: "tool_use", id: chunk.id, name: chunk.name, input: {} },
    }));
    frames.push(event("content_block_delta", {
      type: "content_block_delta",
      index: state.block,
      delta: { type: "input_json_delta", partial_json: JSON.stringify(chunk.arguments ?? {}) },
    }));
    frames.push(event("content_block_stop", { type: "content_block_stop", index: state.block }));
  }
  if (chunk.type === "finish") {
    frames.push(event("content_block_stop", { type: "content_block_stop", index: 0 }));
    frames.push(event("message_delta", {
      type: "message_delta",
      delta: { stop_reason: chunk.reason === "tool-calls" ? "tool_use" : chunk.reason === "length" ? "max_tokens" : "end_turn", stop_sequence: null },
      usage: usage(chunk.usage),
    }));
    frames.push(event("message_stop", { type: "message_stop" }));
  }
  return frames.join("");
}

export function anthropicFinal(messageId: string, model: string, text: string, tools: { id: string; name: string; arguments: unknown }[], usageValue?: TokenUsage) {
  const content: unknown[] = [];
  if (text) content.push({ type: "text", text });
  for (const tool of tools) content.push({ type: "tool_use", id: tool.id, name: tool.name, input: tool.arguments });
  return {
    id: messageId,
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: tools.length ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: usage(usageValue),
  };
}

function usage(usageValue?: TokenUsage) {
  return {
    input_tokens: (usageValue?.inputTokens ?? 0) + (usageValue?.cacheReadTokens ?? 0),
    output_tokens: usageValue?.outputTokens ?? 0,
    cache_read_input_tokens: usageValue?.cacheReadTokens,
  };
}

function event(name: string, payload: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`;
}
