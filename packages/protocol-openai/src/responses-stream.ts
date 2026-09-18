import type { NormalizedChunk, PoolErrorCode, TokenUsage } from "@command-go-pool/shared";
import { newId } from "@command-go-pool/shared";

interface MessageItem {
  id: string;
  index: number;
  text: string;
}

interface ReasoningItem {
  id: string;
  index: number;
  text: string;
  partStarted: boolean;
}

interface ToolItem {
  id: string;
  callId: string;
  name: string;
  index: number;
  arguments: string;
  opened: boolean;
  completed: boolean;
}

export interface ResponsesStreamState {
  sequence: number;
  nextIndex: number;
  terminal: boolean;
  message?: MessageItem;
  reasoning?: ReasoningItem;
  toolCalls: Map<string, ToolItem>;
  output: unknown[];
  usage?: TokenUsage;
}

export function responsesStreamState(): ResponsesStreamState {
  return { sequence: 1, nextIndex: 0, terminal: false, toolCalls: new Map(), output: [] };
}

export function responsesCreatedFrame(responseId: string, model: string, createdAt: number, state: ResponsesStreamState): string {
  return frame(state, "response.created", {
    response: responseShell(responseId, model, createdAt, "in_progress"),
  });
}

export function responsesStreamFrames(
  responseId: string,
  model: string,
  createdAt: number,
  chunk: NormalizedChunk,
  state: ResponsesStreamState,
): string {
  if (state.terminal) return "";
  if (chunk.type === "text-delta") return textFrames(chunk.text, state);
  if (chunk.type === "reasoning-delta") return reasoningFrames(chunk.text, state);
  if (chunk.type === "tool-call-delta") return toolDeltaFrames(chunk.id, chunk.name, chunk.argumentsDelta, state);
  if (chunk.type === "tool-call") return toolCallFrames(chunk.id, chunk.name, chunk.arguments, state);
  if (chunk.type === "usage") {
    state.usage = chunk.usage;
    return "";
  }
  if (chunk.type === "finish") {
    state.usage = chunk.usage ?? state.usage;
    return `${flushTools(state)}${responsesCompletedFrame(responseId, model, createdAt, state)}`;
  }
  if (chunk.type === "error") {
    return responsesFailedFrame(responseId, model, createdAt, chunk.error.code, chunk.error.message, state);
  }
  return "";
}

export function responsesCompletedFrame(responseId: string, model: string, createdAt: number, state: ResponsesStreamState): string {
  if (state.terminal) return "";
  const frames: string[] = closeActive(state);
  frames.push(
    frame(state, "response.completed", {
      response: {
        ...responseShell(responseId, model, createdAt, "completed"),
        output: state.output,
        usage: responseUsage(state.usage),
      },
    }),
  );
  state.terminal = true;
  return frames.join("");
}

export function responsesFailedFrame(responseId: string, model: string, createdAt: number, code: PoolErrorCode, message: string, state: ResponsesStreamState): string {
  const frames: string[] = closeActive(state);
  frames.push(
    frame(state, "response.failed", {
      response: {
        ...responseShell(responseId, model, createdAt, "failed"),
        error: { code: responsesErrorCode(code), message: message || "Upstream error" },
      },
    }),
  );
  state.terminal = true;
  return frames.join("");
}

export function responsesFinal(
  responseId: string,
  model: string,
  createdAt: number,
  text: string,
  reasoning: string,
  toolCalls: { id: string; name: string; arguments: string }[],
  usage?: TokenUsage,
) {
  const output: unknown[] = [];
  if (reasoning) {
    output.push({ type: "reasoning", id: newId("rs"), summary: [{ type: "summary_text", text: reasoning }], content: [] });
  }
  if (text) output.push(messageItem(newId("msg"), 0, text, "completed"));
  for (const call of toolCalls) {
    output.push(functionCallItem(newId("fc"), 0, call.id, call.name, call.arguments, "completed"));
  }
  return {
    ...responseShell(responseId, model, createdAt, "completed"),
    output,
    usage: responseUsage(usage),
  };
}

export function responsesErrorCode(code: PoolErrorCode): string {
  if (code === "quota_exhausted" || code === "insufficient_credit") return "insufficient_quota";
  if (code === "rate_limited") return "rate_limit_exceeded";
  if (code === "invalid_request" || code === "unsupported_model") return "invalid_prompt";
  if (code === "auth_failed") return "invalid_api_key";
  return "unknown_error";
}

export function responsesErrorPayload(code: PoolErrorCode, message: string) {
  if (code === "quota_exhausted" || code === "insufficient_credit") {
    return { message, type: "usage_limit_reached", code: "insufficient_quota" };
  }
  if (code === "rate_limited") return { message, type: "rate_limit_exceeded", code: "rate_limit_exceeded" };
  if (code === "invalid_request" || code === "unsupported_model") {
    return { message, type: "invalid_request_error", code: "invalid_prompt" };
  }
  return { message, type: "server_error", code: "server_error" };
}

export function responsesErrorStatus(code: PoolErrorCode): number {
  if (code === "quota_exhausted" || code === "insufficient_credit" || code === "rate_limited") return 429;
  if (code === "auth_failed") return 401;
  if (code === "invalid_request" || code === "unsupported_model" || code === "client_cancelled") return 400;
  return 502;
}

function textFrames(text: string, state: ResponsesStreamState): string {
  const frames: string[] = [];
  if (!state.message) {
    if (state.reasoning) frames.push(closeReasoning(state));
    const item: MessageItem = { id: newId("msg"), index: state.nextIndex++, text: "" };
    state.message = item;
    frames.push(
      frame(state, "response.output_item.added", {
        output_index: item.index,
        item: messageItem(item.id, item.index, "", "in_progress"),
      }),
    );
  }
  const item = state.message;
  item.text += text;
  frames.push(
    frame(state, "response.output_text.delta", {
      item_id: item.id,
      output_index: item.index,
      content_index: 0,
      delta: text,
    }),
  );
  return frames.join("");
}

function reasoningFrames(text: string, state: ResponsesStreamState): string {
  const frames: string[] = [];
  if (!state.reasoning) {
    if (state.message) frames.push(closeMessage(state));
    const item: ReasoningItem = { id: newId("rs"), index: state.nextIndex++, text: "", partStarted: false };
    state.reasoning = item;
    item.partStarted = true;
    frames.push(
      frame(state, "response.output_item.added", {
        output_index: item.index,
        item: { type: "reasoning", id: item.id, summary: [], content: [] },
      }),
      frame(state, "response.reasoning_summary_part.added", {
        item_id: item.id,
        output_index: item.index,
        summary_index: 0,
        part: { type: "summary_text", text: "" },
      }),
    );
  }
  const item = state.reasoning;
  item.text += text;
  frames.push(
    frame(state, "response.reasoning_summary_text.delta", {
      item_id: item.id,
      output_index: item.index,
      summary_index: 0,
      delta: text,
    }),
  );
  return frames.join("");
}

function toolDeltaFrames(callId: string, name: string, argumentsDelta: string, state: ResponsesStreamState): string {
  if (!callId) return "";
  let call = state.toolCalls.get(callId);
  if (!call) {
    call = { id: newId("fc"), callId, name: name || "tool", index: state.nextIndex++, arguments: "", opened: false, completed: false };
    state.toolCalls.set(callId, call);
  }
  const frames: string[] = [];
  if (!call.opened) {
    frames.push(...openTool(call, state));
  }
  if (!argumentsDelta) return frames.join("");
  call.arguments += argumentsDelta;
  frames.push(
    frame(state, "response.function_call_arguments.delta", {
      item_id: call.id,
      output_index: call.index,
      delta: argumentsDelta,
    }),
  );
  return frames.join("");
}

function toolCallFrames(callId: string, name: string, args: unknown, state: ResponsesStreamState): string {
  if (!callId) return "";
  let call = state.toolCalls.get(callId);
  if (!call) {
    call = { id: newId("fc"), callId, name: name || "tool", index: state.nextIndex++, arguments: "", opened: false, completed: false };
    state.toolCalls.set(callId, call);
  }
  const frames: string[] = [];
  if (!call.opened) frames.push(...openTool(call, state));
  if (name) call.name = name;
  call.arguments = typeof args === "string" ? args : JSON.stringify(args ?? {});
  call.completed = true;
  frames.push(
    frame(state, "response.function_call_arguments.done", {
      item_id: call.id,
      output_index: call.index,
      arguments: call.arguments,
    }),
    frame(state, "response.output_item.done", {
      output_index: call.index,
      item: functionCallItem(call.id, call.index, call.callId, call.name, call.arguments, "completed"),
    }),
  );
  state.output.push(functionCallItem(call.id, call.index, call.callId, call.name, call.arguments, "completed"));
  return frames.join("");
}

function openTool(call: ToolItem, state: ResponsesStreamState): string[] {
  const frames: string[] = [];
  if (state.reasoning) frames.push(closeReasoning(state));
  if (state.message) frames.push(closeMessage(state));
  call.opened = true;
  frames.push(
    frame(state, "response.output_item.added", {
      output_index: call.index,
      item: functionCallItem(call.id, call.index, call.callId, call.name, "", "in_progress"),
    }),
  );
  return frames;
}

function closeReasoning(state: ResponsesStreamState): string {
  const item = state.reasoning;
  if (!item) return "";
  state.reasoning = undefined;
  state.output.push({ type: "reasoning", id: item.id, summary: [{ type: "summary_text", text: item.text }], content: [] });
  return [
    frame(state, "response.reasoning_summary_text.done", {
      item_id: item.id,
      output_index: item.index,
      summary_index: 0,
      text: item.text,
    }),
    frame(state, "response.output_item.done", {
      output_index: item.index,
      item: { type: "reasoning", id: item.id, summary: [{ type: "summary_text", text: item.text }], content: [] },
    }),
  ].join("");
}

function closeMessage(state: ResponsesStreamState): string {
  const item = state.message;
  if (!item) return "";
  state.message = undefined;
  state.output.push(messageItem(item.id, item.index, item.text, "completed"));
  return [
    frame(state, "response.output_text.done", {
      item_id: item.id,
      output_index: item.index,
      content_index: 0,
      text: item.text,
    }),
    frame(state, "response.content_part.done", {
      item_id: item.id,
      output_index: item.index,
      content_index: 0,
      part: { type: "output_text", text: item.text, annotations: [] },
    }),
    frame(state, "response.output_item.done", {
      output_index: item.index,
      item: messageItem(item.id, item.index, item.text, "completed"),
    }),
  ].join("");
}

function closeActive(state: ResponsesStreamState): string[] {
  const frames: string[] = [];
  if (state.reasoning) frames.push(closeReasoning(state));
  if (state.message) frames.push(closeMessage(state));
  return frames;
}

function flushTools(state: ResponsesStreamState): string {
  const frames: string[] = [];
  for (const call of state.toolCalls.values()) {
    if (call.completed) continue;
    call.completed = true;
    if (!call.opened) frames.push(...openTool(call, state));
    const argumentsText = call.arguments || "{}";
    frames.push(
      frame(state, "response.output_item.done", {
        output_index: call.index,
        item: functionCallItem(call.id, call.index, call.callId, call.name, argumentsText, "completed"),
      }),
    );
    state.output.push(functionCallItem(call.id, call.index, call.callId, call.name, argumentsText, "completed"));
  }
  return frames.join("");
}

function messageItem(id: string, index: number, text: string, status: string) {
  return {
    type: "message",
    id,
    status,
    role: "assistant",
    content: text ? [{ type: "output_text", text, annotations: [] }] : [],
  };
}

function functionCallItem(id: string, index: number, callId: string, name: string, args: string, status: string) {
  return { type: "function_call", id, call_id: callId, name, arguments: args, status };
}

function responseShell(responseId: string, model: string, createdAt: number, status: string) {
  return {
    id: responseId,
    object: "response",
    created_at: createdAt,
    status,
    model,
    output: [],
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: {},
    parallel_tool_calls: true,
    temperature: null,
    tool_choice: "auto",
    tools: [],
    top_p: null,
  };
}

function responseUsage(usage?: TokenUsage) {
  if (!usage) return null;
  const input = (usage.inputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
  const output = usage.outputTokens ?? 0;
  return {
    input_tokens: input,
    input_tokens_details: {
      cached_tokens: usage.cacheReadTokens ?? 0,
      cache_write_tokens: usage.cacheWriteTokens ?? 0,
    },
    output_tokens: output,
    output_tokens_details: { reasoning_tokens: usage.reasoningTokens ?? 0 },
    total_tokens: input + output,
  };
}

function frame(state: ResponsesStreamState, type: string, payload: Record<string, unknown>): string {
  const body = { type, ...payload, sequence_number: state.sequence++ };
  return `event: ${type}\ndata: ${JSON.stringify(body)}\n\n`;
}
