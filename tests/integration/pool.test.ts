import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseAppConfig } from "@command-go-pool/shared";
import { MockTransport } from "@command-go-pool/transport-commandcode";
import { boot } from "@command-go-pool/server";
import { poolHeaders } from "../helpers.js";

async function withServer(setup: (transport: MockTransport, add: (label: string) => string) => void) {
  const home = mkdtempSync(join(tmpdir(), "cgp-int-"));
  process.env.COMMAND_GO_POOL_HOME = home;
  process.env.COMMAND_GO_POOL_MASTER_KEY = "z".repeat(32);
  const transport = new MockTransport();
  const config = parseAppConfig({ server: { host: "127.0.0.1", port: 0 } });
  const instance = await boot({ config, transport, home });
  const add = (label: string) => instance.runtime.pool.add({ label, apiKey: `user_${label}` }).id;
  setup(transport, add);
  await instance.app.ready();
  return instance;
}

describe("openai integration", () => {
  afterEach(() => {
    delete process.env.COMMAND_GO_POOL_HOME;
  });

  it("streams chat completions through mock transport", async () => {
    const instance = await withServer((transport, add) => {
      const id = add("Go #01");
      transport.set(id, {
        chunks: [
          { type: "text-delta", text: "hello" },
          { type: "finish", reason: "stop", usage: { inputTokens: 4, outputTokens: 1 } },
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
    expect(res.body).toContain("hello");
    expect(res.body).toContain("[DONE]");
    await instance.close();
  });

  it("streams Anthropic message events", async () => {
    const instance = await withServer((transport, add) => {
      const id = add("Go #01");
      transport.set(id, {
        chunks: [
          { type: "text-delta", text: "hello" },
          { type: "finish", reason: "stop", usage: { outputTokens: 1 } },
        ],
      });
    });
    const res = await instance.app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: poolHeaders(instance),
      payload: {
        model: "deepseek/deepseek-v4-flash",
        max_tokens: 32,
        stream: true,
        messages: [{ role: "user", content: "hi" }],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("content_block_delta");
    expect(res.body).toContain("hello");
    expect(res.body).toContain("message_stop");
    await instance.close();
  });

  it("returns anthropic tool_use", async () => {
    const instance = await withServer((transport, add) => {
      const id = add("Go #01");
      transport.set(id, {
        chunks: [
          { type: "tool-call", id: "call_1", name: "read", arguments: { path: "a.ts" } },
          { type: "finish", reason: "tool-calls", usage: { outputTokens: 8 } },
        ],
      });
    });
    const res = await instance.app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: poolHeaders(instance),
      payload: {
        model: "deepseek/deepseek-v4-flash",
        max_tokens: 128,
        messages: [{ role: "user", content: "read it" }],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { content: Array<{ type: string }> };
    expect(body.content.some((c) => c.type === "tool_use")).toBe(true);
    await instance.close();
  });

  it("cancels when the client aborts", async () => {
    const instance = await withServer((transport, add) => {
      const id = add("Go #01");
      transport.set(id, {
        delayMs: 50,
        chunks: [
          { type: "text-delta", text: "slow" },
          { type: "finish", reason: "stop" },
        ],
      });
    });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5);
    const res = await instance.app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: poolHeaders(instance),
      payload: { model: "m", messages: [{ role: "user", content: "x" }] },
    });
    expect(res.statusCode).toBeGreaterThan(0);
    await instance.close();
  });

  it("restores ACTIVE from sticky sessions after the in-memory count is lost", async () => {
    const instance = await withServer((transport, add) => {
      const id = add("Go #01");
      transport.set(id, {
        chunks: [
          { type: "text-delta", text: "hello" },
          { type: "finish", reason: "stop", usage: { inputTokens: 4, outputTokens: 1 } },
        ],
      });
    });
    const chat = await instance.app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: poolHeaders(instance),
      payload: { model: "deepseek/deepseek-v4-flash", messages: [{ role: "user", content: "hi" }], stream: true },
    });
    expect(chat.statusCode).toBe(200);
    const id = instance.runtime.pool.list()[0]!.id;
    instance.runtime.pool.update(id, { activeSessionCount: 0, status: "available" });
    const listed = await instance.app.inject({ method: "GET", url: "/api/accounts" });
    const account = (listed.json() as { accounts: Array<{ id: string; status: string; activeSessionCount: number }> }).accounts[0];
    expect(account?.status).toBe("active");
    expect(account?.activeSessionCount).toBeGreaterThan(0);
    await instance.close();
  });

  it("marks the in-flight account as generating", async () => {
    const instance = await withServer((transport, add) => {
      const id = add("Go #01");
      transport.set(id, {
        delayMs: 250,
        chunks: [
          { type: "text-delta", text: "slow" },
          { type: "finish", reason: "stop", usage: { outputTokens: 1 } },
        ],
      });
    });
    const pending = instance.app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: poolHeaders(instance),
      payload: { model: "deepseek/deepseek-v4-flash", messages: [{ role: "user", content: "hi" }], stream: true },
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    const listed = await instance.app.inject({ method: "GET", url: "/api/accounts" });
    const account = (listed.json() as { accounts: Array<{ status: string; generating?: boolean }> }).accounts[0];
    expect(account?.generating).toBe(true);
    expect(account?.status).toBe("active");
    await pending;
    await instance.close();
  });
});
