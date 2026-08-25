import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAppConfig } from "@command-go-pool/shared";
import { setupClaude } from "../../packages/cli/src/setup.js";

describe("Claude setup", () => {
  it("writes a dedicated pool settings file and does not mention ~/.claude/settings.json as a target", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cgp-claude-"));
    const file = join(dir, "command-go-pool.json");
    const message = await setupClaude(
      parseAppConfig({ server: { host: "0.0.0.0", port: 8787, apiKey: "cgp_claude_secret" } }),
      file,
    );
    const written = JSON.parse(readFileSync(file, "utf8")) as {
      env: { ANTHROPIC_BASE_URL: string; ANTHROPIC_API_KEY: string; ANTHROPIC_AUTH_TOKEN: string };
    };
    expect(written.env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:8787");
    expect(written.env.ANTHROPIC_API_KEY).toBe("cgp_claude_secret");
    expect(written.env.ANTHROPIC_AUTH_TOKEN).toBe("cgp_claude_secret");
    expect(message).toContain(`Wrote ${file}`);
    expect(message).toContain("does not modify ~/.claude/settings.json");
    expect(message).toContain(`claude --settings ${file}`);
    expect(message).not.toContain("ANTHROPIC_API_KEY=cgp_claude_secret");
  });

  it("writes pool-managed when no pool API key is set", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cgp-claude-"));
    const file = join(dir, "command-go-pool.json");
    await setupClaude(parseAppConfig({ server: { host: "127.0.0.1", port: 8787 } }), file);
    const written = JSON.parse(readFileSync(file, "utf8")) as {
      env: { ANTHROPIC_API_KEY: string; ANTHROPIC_AUTH_TOKEN: string };
    };
    expect(written.env.ANTHROPIC_API_KEY).toBe("pool-managed");
    expect(written.env.ANTHROPIC_AUTH_TOKEN).toBe("pool-managed");
  });
});
