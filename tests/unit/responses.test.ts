import { describe, expect, it } from "vitest";
import {
  responsesRequestSchema,
  responsesToNormalized,
  responsesStreamState,
  responsesCreatedFrame,
  responsesStreamFrames,
  responsesCompletedFrame,
  responsesFinal,
  responsesErrorCode,
  responsesErrorPayload,
  responsesErrorStatus,
} from "@command-go-pool/protocol-openai";

function events(sse: string): { event: string; data: Record<string, unknown> }[] {
  return sse
    .split("\n\n")
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n");
      const event = lines.find((line) => line.startsWith("event: "))?.slice(7) ?? "";
      const data = JSON.parse(lines.find((line) => line.startsWith("data: "))?.slice(6) ?? "{}") as Record<string, unknown>;
      return { event, data };
    });
}

describe("responses request conversion", () => {
  it("maps instructions and developer messages to the system prompt", () => {
    const body = responsesRequestSchema.parse({
      model: "flash",
      instructions: "top",
      input: [
        { type: "message", role: "developer", content: [{ type: "input_text", text: "dev" }] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
      ],
    });
    const n = responsesToNormalized(body, { flash: "deepseek/deepseek-v4-flash" });
    expect(n.model).toBe("deepseek/deepseek-v4-flash");
    expect(n.system).toBe("top\n\ndev");
    expect(n.messages.map((message) => message.role)).toEqual(["user"]);
  });

  it("accepts a plain string input", () => {
    const body = responsesRequestSchema.parse({ model: "m", input: "hello" });
    const n = responsesToNormalized(body, {});
    expect(n.messages[0]?.content).toEqual([{ type: "text", text: "hello" }]);
  });

  it("round-trips function calls and outputs", () => {
    const body = responsesRequestSchema.parse({
      model: "m",
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "pwd" }] },
        { type: "function_call", call_id: "call_1", name: "exec_command", arguments: '{"cmd":"pwd"}' },
        { type: "function_call_output", call_id: "call_1", output: "/tmp\n" },
      ],
    });
    const n = responsesToNormalized(body, {});
    expect(n.messages[1]).toEqual({ role: "assistant", content: [{ type: "tool-call", id: "call_1", name: "exec_command", arguments: { cmd: "pwd" } }] });
    expect(n.messages[2]).toEqual({ role: "tool", content: [{ type: "tool-result", id: "call_1", name: undefined, output: "/tmp\n" }] });
  });

  it("merges consecutive tool calls and flattens output arrays", () => {
    const body = responsesRequestSchema.parse({
      model: "m",
      input: [
        { type: "function_call", call_id: "c1", name: "a", arguments: "{}" },
        { type: "function_call", call_id: "c2", name: "b", arguments: "not json" },
        { type: "function_call_output", call_id: "c1", output: [{ type: "input_text", text: "one" }, { type: "input_image", image_url: "data:image/png;base64,xx" }] },
        { type: "custom_tool_call", call_id: "c3", name: "apply_patch", input: "*** Begin Patch" },
      ],
    });
    const n = responsesToNormalized(body, {});
    expect(n.messages[0]?.content).toHaveLength(2);
    expect(n.messages[0]?.content[1]).toEqual({ type: "tool-call", id: "c2", name: "b", arguments: "not json" });
    expect(n.messages[1]?.content[0]).toEqual({ type: "tool-result", id: "c1", name: undefined, output: "one\n[image]" });
    expect(n.messages[2]?.content[0]).toEqual({ type: "tool-call", id: "c3", name: "apply_patch", arguments: "*** Begin Patch" });
  });

  it("maps images and reasoning controls", () => {
    const body = responsesRequestSchema.parse({
      model: "m",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "see" }, { type: "input_image", image_url: "data:image/webp;base64,zzz" }],
        },
      ],
      reasoning: { effort: "high" },
      max_output_tokens: 2048,
      prompt_cache_key: "pck_1",
    });
    const n = responsesToNormalized(body, {});
    expect(n.messages[0]?.content[1]).toEqual({ type: "image", mediaType: "image/webp", base64: "zzz" });
    expect(n.reasoningEffort).toBe("high");
    expect(n.maxTokens).toBe(2048);
    expect(n.promptCacheKey).toBe("pck_1");
  });

  it("flattens flat, custom and namespace tools", () => {
    const body = responsesRequestSchema.parse({
      model: "m",
      input: "hi",
      tools: [
        { type: "function", name: "exec_command", description: "run", strict: false, parameters: { type: "object", properties: { cmd: { type: "string" } } } },
        { type: "custom", name: "apply_patch", format: { type: "grammar", syntax: "lark", definition: "x" } },
        { type: "namespace", name: "multi", tools: [{ type: "function", name: "inner", parameters: { type: "object" } }] },
      ],
    });
    const n = responsesToNormalized(body, {});
    expect(n.tools?.map((tool) => tool.name)).toEqual(["exec_command", "apply_patch", "inner"]);
    expect(n.tools?.[0]?.inputSchema).toMatchObject({ type: "object" });
    expect(n.toolChoice).toBeUndefined();
  });
});

describe("responses stream encoding", () => {
  function run(chunks: Parameters<typeof responsesStreamFrames>[3][]) {
    const state = responsesStreamState();
    let sse = responsesCreatedFrame("resp_1", "m", 1, state);
    for (const chunk of chunks) sse += responsesStreamFrames("resp_1", "m", 1, chunk, state);
    sse += responsesCompletedFrame("resp_1", "m", 1, state);
    return { state, sse, list: events(sse) };
  }

  it("encodes message text as added/delta/done then completed", () => {
    const { list } = run([
      { type: "text-delta", text: "hel" },
      { type: "text-delta", text: "lo" },
      { type: "finish", reason: "stop", usage: { inputTokens: 3, outputTokens: 2 } },
    ]);
    expect(list.map((row) => row.event)).toEqual([
      "response.created",
      "response.output_item.added",
      "response.content_part.added",
      "response.output_text.delta",
      "response.output_text.delta",
      "response.output_text.done",
      "response.content_part.done",
      "response.output_item.done",
      "response.completed",
    ]);
    const added = list[1]?.data.item as { content: unknown[] };
    expect(added.content).toEqual([]);
    const part = list[2]?.data.part as { type: string; text: string };
    expect(part).toEqual({ type: "output_text", text: "", annotations: [] });
    const done = list[7]?.data.item as { content: { text: string }[] };
    expect(done.content[0]?.text).toBe("hello");
    const completed = list[8]?.data.response as { output: unknown[]; usage: Record<string, unknown> };
    expect(completed.output).toHaveLength(1);
    expect(completed.usage).toMatchObject({ input_tokens: 3, output_tokens: 2, total_tokens: 5 });
  });

  it("encodes tool calls from deltas and final calls", () => {
    const { list } = run([
      { type: "tool-call-delta", id: "c1", name: "read_file", argumentsDelta: '{"path":' },
      { type: "tool-call-delta", id: "c1", name: "read_file", argumentsDelta: '"a.ts"}' },
      { type: "tool-call", id: "c1", name: "read_file", arguments: { path: "a.ts" } },
      { type: "finish", reason: "tool-calls" },
    ]);
    const names = list.map((row) => row.event);
    expect(names.filter((name) => name === "response.output_item.added")).toHaveLength(1);
    const done = list.find((row) => row.event === "response.output_item.done")?.data.item as { type: string; call_id: string; arguments: string };
    expect(done.type).toBe("function_call");
    expect(done.call_id).toBe("c1");
    expect(JSON.parse(done.arguments)).toEqual({ path: "a.ts" });
    const completed = list[list.length - 1]?.data.response as { output: { type: string }[] };
    expect(completed.output[0]?.type).toBe("function_call");
  });

  it("flushes partial tool calls on finish", () => {
    const { list } = run([
      { type: "tool-call-delta", id: "c9", name: "exec_command", argumentsDelta: '{"cmd":"ls"}' },
      { type: "finish", reason: "tool-calls" },
    ]);
    const done = list.filter((row) => row.event === "response.output_item.done");
    expect(done).toHaveLength(1);
    expect((done[0]?.data.item as { arguments: string }).arguments).toBe('{"cmd":"ls"}');
    expect(list[list.length - 1]?.event).toBe("response.completed");
  });

  it("closes an open message before emitting a tool call", () => {
    const { list } = run([
      { type: "text-delta", text: "checking" },
      { type: "tool-call", id: "c1", name: "exec_command", arguments: { cmd: "pwd" } },
      { type: "finish", reason: "tool-calls" },
    ]);
    const events = list.map((row) => row.event);
    expect(events.indexOf("response.output_item.done")).toBeLessThan(events.lastIndexOf("response.output_item.added"));
    const output = (list[list.length - 1]?.data.response as { output: { type: string }[] }).output;
    expect(output.map((item) => item.type)).toEqual(["message", "function_call"]);
  });

  it("encodes reasoning summaries", () => {
    const { list } = run([
      { type: "reasoning-delta", text: "think" },
      { type: "text-delta", text: "answer" },
      { type: "finish", reason: "stop" },
    ]);
    const events = list.map((row) => row.event);
    expect(events).toContain("response.reasoning_summary_part.added");
    expect(events).toContain("response.reasoning_summary_text.delta");
    expect(events).toContain("response.reasoning_summary_text.done");
    const output = (list[list.length - 1]?.data.response as { output: { type: string }[] }).output;
    expect(output.map((item) => item.type)).toEqual(["reasoning", "message"]);
  });

  it("emits response.failed on error chunks and stops", () => {
    const state = responsesStreamState();
    let sse = responsesCreatedFrame("resp_1", "m", 1, state);
    sse += responsesStreamFrames("resp_1", "m", 1, { type: "error", error: { code: "quota_exhausted", message: "no quota", retryable: false, failover: false } }, state);
    sse += responsesStreamFrames("resp_1", "m", 1, { type: "text-delta", text: "late" }, state);
    const list = events(sse);
    expect(list[list.length - 1]?.event).toBe("response.failed");
    expect((list[list.length - 1]?.data.response as { error: { code: string } }).error.code).toBe("insufficient_quota");
    expect(sse).not.toContain("late");
  });

  it("builds a non-streaming final response", () => {
    const final = responsesFinal("resp_1", "m", 1, "hi", "thought", [{ id: "c1", name: "read_file", arguments: '{"path":"a"}' }], {
      inputTokens: 5,
      outputTokens: 3,
      cacheReadTokens: 2,
    });
    expect(final.object).toBe("response");
    expect(final.status).toBe("completed");
    expect(final.output.map((item) => (item as { type: string }).type)).toEqual(["reasoning", "message", "function_call"]);
    expect(final.usage).toMatchObject({ input_tokens: 7, total_tokens: 10, output_tokens: 3 });
  });
});

describe("responses error mapping", () => {
  it("maps pool codes to responses codes and statuses", () => {
    expect(responsesErrorCode("quota_exhausted")).toBe("insufficient_quota");
    expect(responsesErrorCode("rate_limited")).toBe("rate_limit_exceeded");
    expect(responsesErrorCode("invalid_request")).toBe("invalid_prompt");
    expect(responsesErrorStatus("quota_exhausted")).toBe(429);
    expect(responsesErrorStatus("auth_failed")).toBe(401);
    expect(responsesErrorStatus("unsupported_model")).toBe(400);
    expect(responsesErrorStatus("upstream_5xx")).toBe(502);
    expect(responsesErrorCode("auth_failed")).toBe("invalid_api_key");
  });

  it("emits codex-compatible pre-stream payloads", () => {
    expect(responsesErrorPayload("quota_exhausted", "x")).toEqual({ message: "x", type: "usage_limit_reached", code: "insufficient_quota" });
    expect(responsesErrorPayload("rate_limited", "x").type).toBe("rate_limit_exceeded");
    expect(responsesErrorPayload("auth_failed", "x")).toEqual({ message: "x", type: "invalid_request_error", code: "invalid_api_key" });
    expect(responsesErrorPayload("unknown", "x").type).toBe("server_error");
  });
});
