import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  listClientTargets,
  pickClaudeModelDefaults,
  syncConnectedClients,
  writeClaudeConfig,
} from "@command-go-pool/shared";

describe("client catalog sync", () => {
  it("reports OpenCode and Claude as disconnected when their files are missing", () => {
    const home = mkdtempSync(join(tmpdir(), "cgp-clients-missing-"));
    const clients = listClientTargets({
      home,
      paths: { opencode: join(home, "opencode.json"), claude: join(home, "claude-settings.json") },
    });
    expect(clients.map((client) => [client.id, client.connected])).toEqual([
      ["opencode", false],
      ["claude", false],
    ]);
  });

  it("syncs only connected clients and leaves missing files untouched", () => {
    const home = mkdtempSync(join(tmpdir(), "cgp-clients-sync-"));
    const opencode = join(home, "opencode.json");
    const claude = join(home, "claude-settings.json");
    writeFileSync(opencode, JSON.stringify({ provider: { anthropic: { name: "Anthropic" } } }));
    writeFileSync(
      claude,
      JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: "http://old.example",
          ANTHROPIC_API_KEY: "old",
          ANTHROPIC_DEFAULT_SONNET_MODEL: "deepseek/deepseek-v4-pro",
          KEEP_ME: "yes",
        },
      }),
    );
    const missing = join(home, "missing-claude.json");
    const result = syncConnectedClients({
      home,
      origin: "http://127.0.0.1:8787",
      apiKey: "cgp_sync",
      models: [{ id: "deepseek/deepseek-v4-flash" }, { id: "deepseek/deepseek-v4-pro" }],
      paths: { opencode, claude: missing },
    });
    expect(result.synced.map((client) => client.id)).toEqual(["opencode"]);
    const written = JSON.parse(readFileSync(opencode, "utf8")) as {
      provider: { "command-go-pool": { models: Record<string, unknown>; options?: { apiKey?: string } }; anthropic?: unknown };
    };
    expect(written.provider.anthropic).toBeTruthy();
    expect(written.provider["command-go-pool"].models["deepseek/deepseek-v4-flash"]).toBeTruthy();
    expect(written.provider["command-go-pool"].options?.apiKey).toBe("cgp_sync");
    expect(existsSync(missing)).toBe(false);
  });

  it("updates Claude defaults from enabled models and preserves extra env keys", () => {
    const home = mkdtempSync(join(tmpdir(), "cgp-claude-sync-"));
    const file = join(home, "claude-settings.json");
    writeFileSync(file, JSON.stringify({ env: { KEEP_ME: "yes", ANTHROPIC_DEFAULT_HAIKU_MODEL: "flash" } }));
    writeClaudeConfig({
      origin: "http://127.0.0.1:8787",
      file,
      apiKey: "cgp_claude",
      models: [
        { id: "deepseek/deepseek-v4-flash" },
        { id: "flash", aliasOf: "deepseek/deepseek-v4-flash" },
      ],
    });
    const written = JSON.parse(readFileSync(file, "utf8")) as {
      env: Record<string, string>;
    };
    expect(written.env.KEEP_ME).toBe("yes");
    expect(written.env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:8787");
    expect(written.env.ANTHROPIC_API_KEY).toBe("cgp_claude");
    expect(written.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("flash");
    expect(written.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("deepseek/deepseek-v4-flash");
  });

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
});
