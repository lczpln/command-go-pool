import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withServer } from "../helpers.js";
import { isPoolApiKeyFormat } from "@command-go-pool/shared";

describe("client and pool key APIs", () => {
  afterEach(() => {
    delete process.env.COMMAND_GO_POOL_HOME;
  });

  it("lists CLIs and connect/disconnect OpenCode", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cgp-api-oc-"));
    const file = join(dir, "opencode.json");
    const instance = await withServer();
    const listed = await instance.app.inject({ method: "GET", url: "/api/clients" });
    expect(listed.statusCode).toBe(200);
    const ids = (listed.json() as { clients: Array<{ id: string }> }).clients.map((row) => row.id);
    expect(ids).toContain("opencode");
    expect(ids).toContain("claude");

    const connected = await instance.app.inject({
      method: "POST",
      url: "/api/clients/opencode/connect",
      payload: { file },
    });
    expect(connected.statusCode).toBe(200);
    const written = JSON.parse(readFileSync(file, "utf8")) as { provider: { "command-go-pool": { options: { apiKey: string } } } };
    expect(written.provider["command-go-pool"].options.apiKey).toBe("pool-managed");

    const disconnected = await instance.app.inject({ method: "POST", url: "/api/clients/opencode/disconnect" });
    expect(disconnected.statusCode).toBe(200);
    const after = JSON.parse(readFileSync(file, "utf8")) as { provider: Record<string, unknown> };
    expect(after.provider["command-go-pool"]).toBeUndefined();
    await instance.close();
  });

  it("propagates a generated pool key to connected CLIs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cgp-api-rotate-"));
    const opencode = join(dir, "opencode.json");
    const claude = join(dir, "command-go-pool.json");
    const instance = await withServer();
    await instance.app.inject({ method: "POST", url: "/api/clients/opencode/connect", payload: { file: opencode } });
    await instance.app.inject({ method: "POST", url: "/api/clients/claude/connect", payload: { file: claude } });
    const rotated = await instance.app.inject({ method: "POST", url: "/api/key/rotate" });
    expect(rotated.statusCode).toBe(200);
    const body = rotated.json() as { apiKey: string; updated: Array<{ id: string }>; config: { server: { apiKey?: string } } };
    expect(isPoolApiKeyFormat(body.apiKey)).toBe(true);
    expect(body.updated.map((row) => row.id).sort()).toEqual(["claude", "opencode"]);
    expect(body.config.server.apiKey).toBe("[set]");
    const oc = JSON.parse(readFileSync(opencode, "utf8")) as { provider: { "command-go-pool": { options: { apiKey: string } } } };
    const cc = JSON.parse(readFileSync(claude, "utf8")) as { env: { ANTHROPIC_API_KEY: string; ANTHROPIC_AUTH_TOKEN: string } };
    expect(oc.provider["command-go-pool"].options.apiKey).toBe(body.apiKey);
    expect(cc.env.ANTHROPIC_API_KEY).toBe(body.apiKey);
    expect(cc.env.ANTHROPIC_AUTH_TOKEN).toBe(body.apiKey);
    await instance.close();
  });

  it("syncs enabled models to connected CLIs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cgp-api-sync-"));
    const opencode = join(dir, "opencode.json");
    const claude = join(dir, "command-go-pool.json");
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
    const synced = await instance.app.inject({ method: "POST", url: "/api/clients/sync" });
    expect(synced.statusCode).toBe(200);
    expect(synced.json()).toMatchObject({ ok: true, message: expect.stringContaining("OpenCode") });
    const oc = JSON.parse(readFileSync(opencode, "utf8")) as { provider: { "command-go-pool": { models: Record<string, unknown> } } };
    expect(oc.provider["command-go-pool"].models["deepseek/deepseek-v4-pro"]).toBeTruthy();
    await instance.close();
  });
});
