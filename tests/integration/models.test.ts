import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withServer, poolHeaders } from "../helpers.js";

describe("model catalog APIs", () => {
  afterEach(() => {
    delete process.env.COMMAND_GO_POOL_HOME;
  });

  it("lists pool models, omits disabled ones from /v1/models, and rejects chat", async () => {
    const instance = await withServer({
      setup(_t, add, boot) {
        const id = add("Go #01");
        boot.runtime.pool.update(id, {
          models: ["deepseek/deepseek-v4-flash", "deepseek/deepseek-v4-pro"],
          status: "available",
        });
      },
    });

    const listed = await instance.app.inject({ method: "GET", url: "/api/models" });
    expect(listed.statusCode).toBe(200);
    const catalog = listed.json() as { models: Array<{ id: string; enabled: boolean }> };
    expect(catalog.models.some((m) => m.id === "deepseek/deepseek-v4-pro" && m.enabled)).toBe(true);

    const disable = await instance.app.inject({
      method: "PATCH",
      url: "/api/models",
      payload: { id: "deepseek/deepseek-v4-pro", enabled: false },
    });
    expect(disable.statusCode).toBe(200);

    const v1 = await instance.app.inject({ method: "GET", url: "/v1/models", headers: poolHeaders(instance) });
    const ids = (v1.json() as { data: Array<{ id: string }> }).data.map((row) => row.id);
    expect(ids).toContain("deepseek/deepseek-v4-flash");
    expect(ids).toContain("flash");
    expect(ids).not.toContain("deepseek/deepseek-v4-pro");
    expect(ids).not.toContain("pro");

    const chat = await instance.app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: poolHeaders(instance),
      payload: { model: "deepseek/deepseek-v4-pro", messages: [{ role: "user", content: "hi" }] },
    });
    expect(chat.statusCode).toBe(400);
    expect(chat.json()).toMatchObject({ error: { code: "unsupported_model" } });

    const aliasChat = await instance.app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: poolHeaders(instance),
      payload: { model: "pro", messages: [{ role: "user", content: "hi" }] },
    });
    expect(aliasChat.statusCode).toBe(400);

    const anthropic = await instance.app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: poolHeaders(instance),
      payload: { model: "deepseek/deepseek-v4-pro", max_tokens: 16, messages: [{ role: "user", content: "hi" }] },
    });
    expect(anthropic.statusCode).toBe(400);

    await instance.close();
  });

  it("writes enabled models to an OpenCode config file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cgp-oc-sync-"));
    const file = join(dir, "opencode.json");
    const instance = await withServer({
      setup(_t, add, boot) {
        const id = add("Go #01");
        boot.runtime.pool.update(id, {
          models: ["deepseek/deepseek-v4-flash"],
          status: "available",
        });
      },
    });
    const res = await instance.app.inject({
      method: "POST",
      url: "/api/setup/opencode",
      payload: { file, baseUrl: "http://127.0.0.1:8787/v1" },
    });
    expect(res.statusCode).toBe(200);
    const written = JSON.parse(readFileSync(file, "utf8")) as {
      provider: { "command-go-pool": { models: Record<string, { name: string }>; options?: { apiKey?: string } } };
    };
    expect(written.provider["command-go-pool"].models["deepseek/deepseek-v4-flash"]).toBeTruthy();
    expect(written.provider["command-go-pool"].options?.apiKey).toBe(instance.runtime.config.server.apiKey);
    await instance.close();
  });
});
