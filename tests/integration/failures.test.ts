import { afterEach, describe, expect, it } from "vitest";
import { failure } from "@command-go-pool/shared";
import { withServer, poolHeaders } from "../helpers.js";

describe("inference error paths", () => {
  afterEach(() => {
    delete process.env.COMMAND_GO_POOL_HOME;
  });

  it("forwards vision image parts to the transport", async () => {
    const instance = await withServer({
      setup(transport, add) {
        add("Go #01");
      },
    });
    const res = await instance.app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: poolHeaders(instance),
      payload: {
        model: "deepseek/deepseek-v4-flash-vision-exp",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "describe" },
              { type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
            ],
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(instance.transport.lastRequest?.messages[0]?.content.some((p) => p.type === "image")).toBe(true);
    await instance.close();
  });

  it("failovers 429 onto a healthy account", async () => {
    const instance = await withServer({
      setup(transport, add) {
        const a = add("limited");
        const b = add("healthy");
        transport.set(a, { chunks: [{ type: "error", error: failure("rate_limited", "429") }] });
        transport.set(b, {
          chunks: [
            { type: "text-delta", text: "recovered" },
            { type: "finish", reason: "stop", usage: { outputTokens: 1 } },
          ],
        });
      },
    });
    const res = await instance.app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: poolHeaders(instance),
      payload: { model: "deepseek/deepseek-v4-flash", messages: [{ role: "user", content: "hi" }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().choices[0].message.content).toBe("recovered");
    await instance.close();
  });

  it("maps quota exhaustion into cooldown then retries", async () => {
    const instance = await withServer({
      setup(transport, add) {
        const a = add("exhausted");
        const b = add("next");
        transport.set(a, { chunks: [{ type: "error", error: failure("quota_exhausted", "5h quota exhausted", { window: "fiveHour" }) }] });
        transport.set(b, {
          chunks: [
            { type: "text-delta", text: "ok" },
            { type: "finish", reason: "stop" },
          ],
        });
      },
    });
    const res = await instance.app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: poolHeaders(instance, { "x-command-go-session": "ses_q" }),
      payload: { model: "deepseek/deepseek-v4-flash", messages: [{ role: "user", content: "hi" }] },
    });
    expect(res.statusCode).toBe(200);
    const exhausted = instance.runtime.pool.list().find((a) => a.label === "exhausted");
    expect(exhausted?.status).toBe("quota_exhausted");
    expect(instance.runtime.events.list(20).some((e) => e.type === "session.migrated")).toBe(true);
    await instance.close();
  });

  it("does not failover invalid_request", async () => {
    const instance = await withServer({
      setup(transport, add) {
        const a = add("bad");
        add("other");
        transport.set(a, { chunks: [{ type: "error", error: failure("invalid_request", "Invalid prompt") }] });
      },
    });
    const res = await instance.app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: poolHeaders(instance),
      payload: { model: "deepseek/deepseek-v4-flash", messages: [{ role: "user", content: "hi" }] },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(instance.runtime.events.list(20).some((e) => e.type === "session.migrated")).toBe(false);
    await instance.close();
  });

  it("survives malformed upstream NDJSON by skipping junk lines", async () => {
    const instance = await withServer({
      setup(transport, add) {
        add("Go #01");
      },
    });
    const { parseNdjsonLine } = await import("@command-go-pool/transport-commandcode");
    expect(parseNdjsonLine("not-json")).toBeUndefined();
    expect(parseNdjsonLine("{")).toBeUndefined();
    expect(parseNdjsonLine('{"type":"text-delta","text":"ok"}')).toMatchObject({ type: "text-delta", text: "ok" });
    await instance.close();
  });

  it("returns 5xx classification for injected upstream errors", async () => {
    const instance = await withServer({
      setup(transport, add) {
        const a = add("boom");
        const b = add("ok");
        transport.set(a, { chunks: [{ type: "error", error: failure("upstream_5xx", "bad gateway") }] });
        transport.set(b, {
          chunks: [
            { type: "text-delta", text: "fine" },
            { type: "finish", reason: "stop" },
          ],
        });
      },
    });
    const res = await instance.app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: poolHeaders(instance),
      payload: { model: "deepseek/deepseek-v4-flash", messages: [{ role: "user", content: "hi" }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().choices[0].message.content).toBe("fine");
    await instance.close();
  });

  it("times out an idle account and failovers", async () => {
    const instance = await withServer({
      setup(transport, add) {
        const a = add("slow");
        const b = add("fast");
        transport.set(a, { chunks: [{ type: "error", error: failure("timeout", "idle timeout") }] });
        transport.set(b, {
          chunks: [
            { type: "text-delta", text: "fast" },
            { type: "finish", reason: "stop" },
          ],
        });
      },
    });
    const res = await instance.app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: poolHeaders(instance),
      payload: { model: "deepseek/deepseek-v4-flash", messages: [{ role: "user", content: "hi" }] },
    });
    expect(res.json().choices[0].message.content).toBe("fast");
    await instance.close();
  });

  it("auth failure disables the account and failovers", async () => {
    const instance = await withServer({
      setup(transport, add) {
        const a = add("dead");
        const b = add("live");
        transport.set(a, { failAuth: true });
        transport.set(b, {
          chunks: [
            { type: "text-delta", text: "live" },
            { type: "finish", reason: "stop" },
          ],
        });
      },
    });
    const res = await instance.app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: poolHeaders(instance),
      payload: { model: "deepseek/deepseek-v4-flash", messages: [{ role: "user", content: "hi" }] },
    });
    expect(res.json().choices[0].message.content).toBe("live");
    expect(instance.runtime.pool.list().find((a) => a.label === "dead")?.status).toBe("auth_error");
    await instance.close();
  });
});
