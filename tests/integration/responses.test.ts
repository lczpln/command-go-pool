import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseAppConfig } from "@command-go-pool/shared";
import { MockTransport } from "@command-go-pool/transport-commandcode";
import { boot } from "@command-go-pool/server";
import { poolHeaders } from "../helpers.js";

async function withServer(setup: (transport: MockTransport, add: (label: string) => string) => void, config?: Record<string, unknown>) {
  const home = mkdtempSync(join(tmpdir(), "cgp-resp-"));
  process.env.COMMAND_GO_POOL_HOME = home;
  process.env.COMMAND_GO_POOL_MASTER_KEY = "z".repeat(32);
  const transport = new MockTransport();
  const parsed = parseAppConfig({ ...config, server: { host: "127.0.0.1", port: 0 } });
  const instance = await boot({ config: parsed, transport, home });
  const add = (label: string) => instance.runtime.pool.add({ label, apiKey: `user_${label}` }).id;
  setup(transport, add);
  await instance.app.ready();
  return { ...instance, transport };
}

describe("responses integration", () => {
  afterEach(() => {
    delete process.env.COMMAND_GO_POOL_HOME;
  });

  it("streams a response with created, output and completed events", async () => {
    const instance = await withServer((transport, add) => {
      const id = add("Go #01");
      transport.set(id, {
        chunks: [
          { type: "text-delta", text: "hello" },
          { type: "usage", usage: { inputTokens: 4, outputTokens: 2 } },
          { type: "finish", reason: "stop", usage: { inputTokens: 4, outputTokens: 2 } },
        ],
      });
    });
    const res = await instance.app.inject({
      method: "POST",
      url: "/v1/responses",
      headers: poolHeaders(instance),
      payload: {
        model: "deepseek/deepseek-v4-flash",
        instructions: "You are a coding agent.",
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
        tools: [{ type: "function", name: "exec_command", description: "run", parameters: { type: "object", properties: {} } }],
        tool_choice: "auto",
        parallel_tool_calls: true,
        store: false,
        stream: true,
        prompt_cache_key: "pck_abc",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.body).toContain("event: response.created");
    expect(res.body).toContain("event: response.output_text.delta");
    expect(res.body).toContain("event: response.completed");
    const last = res.body.slice(res.body.lastIndexOf("event: response.completed"));
    expect(last).toContain('"total_tokens":6');
    expect(instance.transport.lastRequest?.system).toBe("You are a coding agent.");
    expect(instance.transport.lastRequest?.messages[0]?.content[0]).toEqual({ type: "text", text: "hi" });
    expect(instance.transport.lastRequest?.promptCacheKey).toBe("pck_abc");
    await instance.close();
  });

  it("streams a tool call that reuses the upstream call id", async () => {
    const instance = await withServer((transport, add) => {
      const id = add("Go #01");
      transport.set(id, {
        chunks: [
          { type: "tool-call-delta", id: "call_x", name: "exec_command", argumentsDelta: '{"cmd":' },
          { type: "tool-call-delta", id: "call_x", name: "exec_command", argumentsDelta: '"pwd"}' },
          { type: "tool-call", id: "call_x", name: "exec_command", arguments: { cmd: "pwd" } },
          { type: "finish", reason: "tool-calls" },
        ],
      });
    });
    const res = await instance.app.inject({
      method: "POST",
      url: "/v1/responses",
      headers: poolHeaders(instance),
      payload: { model: "deepseek/deepseek-v4-flash", input: "run pwd", stream: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('"type":"function_call"');
    expect(res.body).toContain('"call_id":"call_x"');
    expect(res.body).toContain("response.completed");
    await instance.close();
  });

  it("routes a full tool-loop turn with function_call_output in the input", async () => {
    const instance = await withServer((transport, add) => {
      const id = add("Go #01");
      transport.set(id, {
        chunks: [
          { type: "text-delta", text: "done" },
          { type: "finish", reason: "stop", usage: { outputTokens: 1 } },
        ],
      });
    });
    const res = await instance.app.inject({
      method: "POST",
      url: "/v1/responses",
      headers: poolHeaders(instance, { "conversation_id": "thread_123" }),
      payload: {
        model: "deepseek/deepseek-v4-flash",
        input: [
          { type: "message", role: "user", content: [{ type: "input_text", text: "pwd" }] },
          { type: "function_call", call_id: "call_1", name: "exec_command", arguments: '{"cmd":"pwd"}' },
          { type: "function_call_output", call_id: "call_1", output: "/tmp\n" },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const request = instance.transport.lastRequest;
    expect(request?.messages.map((message) => message.role)).toEqual(["user", "assistant", "tool"]);
    expect(request?.sessionHint).toBe("thread_123");
    await instance.close();
  });

  it("returns a non-streaming response object", async () => {
    const instance = await withServer((transport, add) => {
      const id = add("Go #01");
      transport.set(id, {
        chunks: [
          { type: "reasoning-delta", text: "hmm" },
          { type: "text-delta", text: "answer" },
          { type: "finish", reason: "stop", usage: { inputTokens: 2, outputTokens: 3 } },
        ],
      });
    });
    const res = await instance.app.inject({
      method: "POST",
      url: "/v1/responses",
      headers: poolHeaders(instance),
      payload: { model: "deepseek/deepseek-v4-flash", input: "hi", stream: false },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { object: string; status: string; output: { type: string; content?: { text: string }[] }[]; usage: { total_tokens: number } };
    expect(body.object).toBe("response");
    expect(body.status).toBe("completed");
    expect(body.output.map((item) => item.type)).toEqual(["reasoning", "message"]);
    expect(body.usage.total_tokens).toBe(5);
    await instance.close();
  });

  it("maps upstream failures to codex-compatible HTTP errors", async () => {
    const instance = await withServer((transport, add) => {
      const id = add("Go #01");
      transport.set(id, { failAuth: true });
    });
    const res = await instance.app.inject({
      method: "POST",
      url: "/v1/responses",
      headers: poolHeaders(instance),
      payload: { model: "deepseek/deepseek-v4-flash", input: "hi", stream: true },
    });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { error: { type: string; code: string } };
    expect(body.error).toEqual({ message: "Authentication failed", type: "invalid_request_error", code: "invalid_api_key" });
    await instance.close();
  });

  it("rejects requests for disabled models", async () => {
    const instance = await withServer(
      (transport, add) => {
        add("Go #01");
      },
      { models: { disabled: ["deepseek/deepseek-v4-flash"] } },
    );
    const res = await instance.app.inject({
      method: "POST",
      url: "/v1/responses",
      headers: poolHeaders(instance),
      payload: { model: "deepseek/deepseek-v4-flash", input: "hi", stream: true },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: "invalid_prompt", type: "invalid_request_error" } });
    await instance.close();
  });

  it("keeps chat completions working", async () => {
    const instance = await withServer((transport, add) => {
      const id = add("Go #01");
      transport.set(id, {
        chunks: [
          { type: "text-delta", text: "hello" },
          { type: "finish", reason: "stop" },
        ],
      });
    });
    const res = await instance.app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: poolHeaders(instance),
      payload: { model: "deepseek/deepseek-v4-flash", messages: [{ role: "user", content: "hi" }], stream: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("[DONE]");
    await instance.close();
  });
});
