import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

    const lock = await instance.app.inject({
      method: "PATCH",
      url: "/api/models",
      payload: { id: "xiaomi/mimo-v2.5", enabled: false },
    });
    expect(lock.statusCode).toBe(400);
    expect(lock.json()).toMatchObject({ error: "Required for OpenCode vision" });

    const v1 = await instance.app.inject({ method: "GET", url: "/v1/models", headers: poolHeaders(instance) });
    const inference = (v1.json() as { data: Array<{ id: string; reasoning?: boolean }> }).data;
    const ids = inference.map((row) => row.id);
    const byId = Object.fromEntries(inference.map((row) => [row.id, row]));
    expect(ids).toContain("deepseek/deepseek-v4-flash");
    expect(ids).not.toContain("flash");
    expect(ids).not.toContain("deepseek/deepseek-v4-pro");
    expect(ids).not.toContain("pro");
    expect(byId["deepseek/deepseek-v4-flash"]?.reasoning).toBe(true);
    expect(byId.flash).toBeUndefined();

    const chat = await instance.app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: poolHeaders(instance),
      payload: { model: "deepseek/deepseek-v4-pro", messages: [{ role: "user", content: "hi" }] },
    });
    expect(chat.statusCode).toBe(400);
    expect(chat.json()).toMatchObject({ error: { code: "unsupported_model" } });

    const anthropic = await instance.app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: poolHeaders(instance),
      payload: { model: "deepseek/deepseek-v4-pro", max_tokens: 16, messages: [{ role: "user", content: "hi" }] },
    });
    expect(anthropic.statusCode).toBe(400);

    await instance.close();
  });

  it("writes enabled canonical models to an OpenCode config file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cgp-oc-sync-"));
    const file = join(dir, "opencode.json");
    const instance = await withServer({
      setup(_t, add, boot) {
        const id = add("Go #01");
        boot.runtime.pool.update(id, {
          models: ["deepseek/deepseek-v4-flash", "deepseek/deepseek-v4-pro", "deepseek/deepseek-v4-flash-vision-exp"],
          status: "available",
        });
        boot.runtime.config.models = { disabled: ["deepseek/deepseek-v4-pro"] };
      },
    });
    const res = await instance.app.inject({
      method: "POST",
      url: "/api/setup/opencode",
      payload: { file, baseUrl: "http://127.0.0.1:8787/v1" },
    });
    expect(res.statusCode).toBe(200);
    const written = JSON.parse(readFileSync(file, "utf8")) as {
      provider: {
        "command-go-pool": {
          models: Record<string, { name: string; reasoning?: boolean; interleaved?: { field: string } }>;
          options?: { apiKey?: string };
        };
      };
    };
    const ids = Object.keys(written.provider["command-go-pool"].models);
    expect(ids).toEqual(["deepseek/deepseek-v4-flash", "deepseek/deepseek-v4-flash-vision-exp"]);
    expect(written.provider["command-go-pool"].models["deepseek/deepseek-v4-flash"]).toMatchObject({
      name: "DeepSeek V4 Flash",
      reasoning: true,
      interleaved: { field: "reasoning_content" },
      limit: { context: 1_000_000, output: 32_768 },
    });
    expect(written.provider["command-go-pool"].models["deepseek/deepseek-v4-flash"].attachment).toBeUndefined();
    expect(written.provider["command-go-pool"].models["deepseek/deepseek-v4-flash-vision-exp"].attachment).toBeUndefined();
    expect(written.provider["command-go-pool"].options?.apiKey).toBe(instance.runtime.config.server.apiKey);
    await instance.close();
  });

  it("syncs enabled models to every connected client", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cgp-clients-sync-"));
    const opencode = join(dir, "opencode.json");
    const claude = join(dir, "command-go-pool.json");
    writeFileSync(opencode, "{}");
    writeFileSync(claude, JSON.stringify({ env: { KEEP_ME: "yes" } }));
    const instance = await withServer({
      setup(_t, add, boot) {
        const id = add("Go #01");
        boot.runtime.pool.update(id, {
          models: ["deepseek/deepseek-v4-flash", "deepseek/deepseek-v4-pro"],
          status: "available",
        });
      },
    });
    await instance.app.inject({ method: "POST", url: "/api/clients/opencode/connect", payload: { file: opencode } });
    await instance.app.inject({ method: "POST", url: "/api/clients/claude/connect", payload: { file: claude } });

    const res = await instance.app.inject({ method: "POST", url: "/api/clients/sync" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; message: string; clients: Array<{ id: string; synced: boolean }> };
    expect(body.ok).toBe(true);
    expect(body.message).toContain("OpenCode");
    expect(body.message).toContain("Claude Code");
    expect(body.clients.filter((client) => client.synced).map((client) => client.id).sort()).toEqual(["claude", "opencode"]);

    const oc = JSON.parse(readFileSync(opencode, "utf8")) as {
      provider: {
        "command-go-pool": {
          models: Record<string, { reasoning?: boolean; interleaved?: { field: string } }>;
          options?: { baseURL?: string };
        };
      };
    };
    expect(oc.provider["command-go-pool"].options?.baseURL).toBe(
      `http://127.0.0.1:${instance.runtime.config.server.port}/v1`,
    );
    expect(oc.provider["command-go-pool"].models["deepseek/deepseek-v4-pro"]).toMatchObject({
      reasoning: true,
      interleaved: { field: "reasoning_content" },
      limit: { context: 1_000_000, output: 32_768 },
    });
    expect(oc.provider["command-go-pool"].models.flash).toBeUndefined();
    expect(oc.provider["command-go-pool"].models.pro).toBeUndefined();

    const cc = JSON.parse(readFileSync(claude, "utf8")) as { env: Record<string, string> };
    expect(cc.env.KEEP_ME).toBe("yes");
    expect(cc.env.ANTHROPIC_BASE_URL).toBe(`http://127.0.0.1:${instance.runtime.config.server.port}`);
    expect(cc.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("deepseek/deepseek-v4-flash");
    expect(cc.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("deepseek/deepseek-v4-pro");
    await instance.close();
  });

  it("syncs reasoning and Command Code context windows for every enabled model", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cgp-oc-catalog-"));
    const file = join(dir, "opencode.json");
    const instance = await withServer({
      setup(_t, add, boot) {
        const id = add("Go #01");
        boot.runtime.pool.update(id, {
          models: ["anthropic/claude-sonnet-5", "deepseek/deepseek-v4-flash"],
          modelCatalog: [
            {
              id: "anthropic/claude-sonnet-5",
              name: "Claude Sonnet 5",
              reasoning: true,
              contextWindow: 1_000_000,
              outputLimit: 64_000,
            },
            {
              id: "deepseek/deepseek-v4-flash",
              name: "DeepSeek V4 Flash",
              reasoning: true,
              contextWindow: 1_000_000,
            },
          ],
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
      provider: {
        "command-go-pool": {
          models: Record<string, { reasoning?: boolean; limit?: { context: number; output: number } }>;
        };
      };
    };
    expect(written.provider["command-go-pool"].models["anthropic/claude-sonnet-5"]).toMatchObject({
      reasoning: true,
      limit: { context: 1_000_000, output: 64_000 },
    });
    expect(written.provider["command-go-pool"].models["anthropic/claude-sonnet-5"].attachment).toBeUndefined();
    const v1 = await instance.app.inject({ method: "GET", url: "/v1/models", headers: poolHeaders(instance) });
    const byId = Object.fromEntries(
      (v1.json() as { data: Array<{ id: string; reasoning?: boolean; vision?: boolean; context_window?: number }> }).data.map((row) => [row.id, row]),
    );
    expect(byId["anthropic/claude-sonnet-5"]).toMatchObject({ reasoning: true, context_window: 1_000_000 });
    expect(byId["anthropic/claude-sonnet-5"]?.vision).toBeUndefined();
    await instance.close();
  });

  it("does not invent client configs when none are connected", async () => {
    const instance = await withServer();
    const res = await instance.app.inject({ method: "POST", url: "/api/clients/sync" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: false,
      message: expect.stringContaining("No connected clients"),
    });
    await instance.close();
  });
});
