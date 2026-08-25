import { afterEach, describe, expect, it } from "vitest";
import { withServer } from "../helpers.js";
import type { QuotaWindow } from "@command-go-pool/shared";

const fiveHour: QuotaWindow = {
  usedPercent: 25,
  remainingPercent: 75,
  resetAt: new Date("2026-09-01T12:00:00.000Z"),
  source: "upstream",
  confidence: "exact",
};

const weekly: QuotaWindow = {
  usedPercent: 40,
  remainingPercent: 60,
  resetAt: new Date("2026-09-07T12:00:00.000Z"),
  source: "upstream",
  confidence: "exact",
};

describe("client usage API", () => {
  afterEach(() => {
    delete process.env.COMMAND_GO_POOL_HOME;
  });

  it("serves OpenCode and Claude Code usage shapes from pool quota", async () => {
    const instance = await withServer({
      setup(_transport, add, server) {
        const id = add("Alpha");
        server.runtime.pool.update(id, { quota: { fiveHour, weekly } });
      },
    });
    const opencode = await instance.app.inject({ method: "GET", url: "/v1/usage" });
    expect(opencode.statusCode).toBe(200);
    expect(opencode.json()).toMatchObject({
      object: "usage",
      usage: {
        rolling: { status: "ok", percent: 25 },
        weekly: { status: "ok", percent: 40 },
        monthly: { status: "unavailable" },
      },
    });
    expect(opencode.headers["anthropic-ratelimit-unified-5h-utilization"]).toBe("0.25");

    const claude = await instance.app.inject({ method: "GET", url: "/api/oauth/usage" });
    expect(claude.statusCode).toBe(200);
    expect(claude.json()).toMatchObject({
      five_hour: { utilization: 25, resets_at: "2026-09-01T12:00:00.000Z" },
      seven_day: { utilization: 40 },
    });

    const admin = await instance.app.inject({ method: "GET", url: "/api/usage" });
    expect((admin.json() as { windows: { fiveHour: { usedPercent: number } } }).windows.fiveHour.usedPercent).toBe(25);
    await instance.close();
  });

  it("short-circuits Claude Code quota probes without hitting generate", async () => {
    const instance = await withServer({
      setup(_transport, add, server) {
        const id = add("Alpha");
        server.runtime.pool.update(id, { quota: { fiveHour, weekly } });
      },
    });
    const res = await instance.app.inject({
      method: "POST",
      url: "/v1/messages",
      payload: {
        model: "deepseek/deepseek-v4-flash",
        max_tokens: 1,
        messages: [{ role: "user", content: "quota" }],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["anthropic-ratelimit-unified-5h-utilization"]).toBe("0.25");
    expect(res.headers["anthropic-ratelimit-unified-7d-utilization"]).toBe("0.4");
    expect(instance.transport.lastRequest).toBeUndefined();
    expect((res.json() as { content: Array<{ text: string }> }).content[0]?.text).toBe(".");
    await instance.close();
  });

  it("still generates a real request that mentions quota", async () => {
    const instance = await withServer({
      setup(_transport, add) {
        add("Alpha");
      },
    });
    const res = await instance.app.inject({
      method: "POST",
      url: "/v1/messages",
      payload: {
        model: "deepseek/deepseek-v4-flash",
        max_tokens: 32,
        messages: [{ role: "user", content: "quota" }],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(instance.transport.lastRequest?.messages[0]?.content[0]).toMatchObject({ type: "text", text: "quota" });
    await instance.close();
  });

  it("omits rate-limit headers when windows are unknown", async () => {
    const instance = await withServer({
      setup(_transport, add) {
        add("Alpha");
      },
    });
    const res = await instance.app.inject({
      method: "POST",
      url: "/v1/messages",
      payload: {
        model: "deepseek/deepseek-v4-flash",
        max_tokens: 16,
        messages: [{ role: "user", content: "hi" }],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["anthropic-ratelimit-unified-5h-utilization"]).toBeUndefined();
    await instance.close();
  });
});
