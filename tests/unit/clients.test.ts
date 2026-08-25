import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseAppConfig,
  connectClient,
  disconnectClient,
  rotatePoolApiKey,
  generatePoolApiKey,
  isPoolApiKeyFormat,
  claudeAdapter,
  opencodeAdapter,
  pickClaudeModelDefaults,
  syncConnectedClients,
} from "@command-go-pool/shared";

describe("pool API key", () => {
  it("generates a unique cgp_ key", () => {
    const first = generatePoolApiKey();
    const second = generatePoolApiKey();
    expect(isPoolApiKeyFormat(first)).toBe(true);
    expect(isPoolApiKeyFormat(second)).toBe(true);
    expect(first).not.toBe(second);
  });
});

describe("client adapters", () => {
  it("connects OpenCode without requiring a pool key and keeps other providers", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cgp-clients-oc-"));
    const file = join(dir, "opencode.json");
    writeFileSync(file, JSON.stringify({ provider: { anthropic: { name: "Anthropic" } } }));
    const config = parseAppConfig({ server: { host: "0.0.0.0", port: 8787 } });
    const { config: next, result } = await connectClient("opencode", config, {
      file,
      models: [{ id: "deepseek/deepseek-v4-flash" }],
    });
    const written = JSON.parse(readFileSync(file, "utf8")) as {
      provider: { anthropic?: unknown; "command-go-pool"?: { options?: { apiKey?: string; baseURL?: string } } };
    };
    expect(result.ok).toBe(true);
    expect(next.clients.connected.opencode?.file).toBe(file);
    expect(written.provider.anthropic).toBeTruthy();
    expect(written.provider["command-go-pool"]?.options?.baseURL).toBe("http://127.0.0.1:8787/v1");
    expect(written.provider["command-go-pool"]?.options?.apiKey).toBe("pool-managed");
  });

  it("writes Claude settings to a dedicated file, not settings.json", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cgp-clients-claude-"));
    const file = join(dir, "command-go-pool.json");
    const config = parseAppConfig({});
    const { result } = await connectClient("claude", config, { file });
    const written = JSON.parse(readFileSync(file, "utf8")) as { env: Record<string, string> };
    expect(result.message).toContain("does not modify ~/.claude/settings.json");
    expect(written.env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:8787");
    expect(written.env.ANTHROPIC_API_KEY).toBe("pool-managed");
    expect(existsSync(join(dir, "settings.json"))).toBe(false);
  });

  it("rotates the pool key into every connected CLI", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cgp-clients-rotate-"));
    const opencode = join(dir, "opencode.json");
    const claude = join(dir, "command-go-pool.json");
    let config = parseAppConfig({});
    config = (await connectClient("opencode", config, { file: opencode, models: [{ id: "deepseek/deepseek-v4-flash" }] })).config;
    config = (await connectClient("claude", config, { file: claude })).config;
    const rotated = rotatePoolApiKey(config);
    expect(isPoolApiKeyFormat(rotated.apiKey)).toBe(true);
    expect(rotated.updated).toHaveLength(2);
    const oc = JSON.parse(readFileSync(opencode, "utf8")) as { provider: { "command-go-pool": { options: { apiKey: string } } } };
    const cc = JSON.parse(readFileSync(claude, "utf8")) as { env: { ANTHROPIC_API_KEY: string } };
    expect(oc.provider["command-go-pool"].options.apiKey).toBe(rotated.apiKey);
    expect(cc.env.ANTHROPIC_API_KEY).toBe(rotated.apiKey);
  });

  it("disconnects OpenCode and Claude without leaving pool config behind", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cgp-clients-dc-"));
    const opencode = join(dir, "opencode.json");
    const claude = join(dir, "command-go-pool.json");
    writeFileSync(opencode, JSON.stringify({ provider: { anthropic: { name: "Anthropic" } } }));
    let config = parseAppConfig({});
    config = (await connectClient("opencode", config, { file: opencode, models: [{ id: "x" }] })).config;
    config = (await connectClient("claude", config, { file: claude })).config;
    config = disconnectClient("opencode", config, { file: opencode }).config;
    config = disconnectClient("claude", config, { file: claude }).config;
    const oc = JSON.parse(readFileSync(opencode, "utf8")) as { provider: Record<string, unknown> };
    expect(oc.provider.anthropic).toBeTruthy();
    expect(oc.provider["command-go-pool"]).toBeUndefined();
    expect(existsSync(claude)).toBe(false);
    expect(config.clients.connected.opencode).toBeUndefined();
    expect(config.clients.connected.claude).toBeUndefined();
  });

  it("detects OpenCode from a config dir without a binary", () => {
    const dir = mkdtempSync(join(tmpdir(), "cgp-detect-oc-"));
    writeFileSync(join(dir, "opencode.json"), "{}");
    const detected = opencodeAdapter.detect({ homedir: join(dir, "home"), env: { OPENCODE_CONFIG: join(dir, "opencode.json"), PATH: "" } });
    expect(detected.installed).toBe(true);
    expect(detected.configPath).toBe(join(dir, "opencode.json"));
  });

  it("detects Claude Code from ~/.claude without touching settings.json", () => {
    const home = mkdtempSync(join(tmpdir(), "cgp-detect-claude-"));
    writeFileSync(join(home, ".keep"), "");
    const claudeDir = join(home, ".claude");
    writeFileSync(join(home, ".claude.json"), "{}");
    const detected = claudeAdapter.detect({ homedir: home, path: "", env: { HOME: home, PATH: "" } });
    expect(detected.installed).toBe(true);
    expect(detected.configPath).toBe(join(claudeDir, "command-go-pool.json"));
  });
});

describe("client catalog sync", () => {
  it("picks haiku/sonnet/opus from the enabled catalog", () => {
    expect(
      pickClaudeModelDefaults([
        { id: "deepseek/deepseek-v4-flash" },
        { id: "deepseek/deepseek-v4-pro" },
        { id: "pro", aliasOf: "deepseek/deepseek-v4-pro" },
      ]),
    ).toEqual({
      sonnet: "deepseek/deepseek-v4-pro",
      opus: "deepseek/deepseek-v4-pro",
      haiku: "deepseek/deepseek-v4-flash",
    });
  });

  it("syncs enabled models only to connected clients", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cgp-clients-sync-"));
    const opencode = join(dir, "opencode.json");
    const claude = join(dir, "command-go-pool.json");
    writeFileSync(opencode, JSON.stringify({ provider: { anthropic: { name: "Anthropic" } } }));
    writeFileSync(claude, JSON.stringify({ env: { KEEP_ME: "yes", ANTHROPIC_DEFAULT_HAIKU_MODEL: "flash" } }));
    let config = parseAppConfig({ server: { host: "127.0.0.1", port: 8787, apiKey: "cgp_sync" } });
    config = (await connectClient("opencode", config, { file: opencode, models: [{ id: "deepseek/deepseek-v4-flash" }] })).config;
    const skipped = await syncConnectedClients(config, {
      models: [{ id: "deepseek/deepseek-v4-flash" }, { id: "deepseek/deepseek-v4-pro" }],
      apiKey: "cgp_sync",
    });
    expect(skipped.map((row) => row.id)).toEqual(["opencode"]);
    expect(JSON.parse(readFileSync(claude, "utf8")).env.KEEP_ME).toBe("yes");
    const oc = JSON.parse(readFileSync(opencode, "utf8")) as {
      provider: { "command-go-pool": { models: Record<string, unknown> }; anthropic?: unknown };
    };
    expect(oc.provider.anthropic).toBeTruthy();
    expect(oc.provider["command-go-pool"].models["deepseek/deepseek-v4-pro"]).toBeTruthy();

    config = (
      await connectClient("claude", config, {
        file: claude,
        models: [
          { id: "deepseek/deepseek-v4-flash" },
          { id: "flash", aliasOf: "deepseek/deepseek-v4-flash" },
        ],
        apiKey: "cgp_sync",
      })
    ).config;
    const both = await syncConnectedClients(config, {
      models: [
        { id: "deepseek/deepseek-v4-flash" },
        { id: "flash", aliasOf: "deepseek/deepseek-v4-flash" },
      ],
      apiKey: "cgp_sync",
    });
    expect(both.map((row) => row.id).sort()).toEqual(["claude", "opencode"]);
    const cc = JSON.parse(readFileSync(claude, "utf8")) as { env: Record<string, string> };
    expect(cc.env.KEEP_ME).toBe("yes");
    expect(cc.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("flash");
    expect(cc.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("deepseek/deepseek-v4-flash");
  });
});
