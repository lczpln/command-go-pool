import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAppConfig } from "@command-go-pool/shared";
import { setupClaude } from "../../packages/cli/src/setup.js";

describe("Claude setup", () => {
  it("writes the saved pool API key into ANTHROPIC_API_KEY", () => {
    const dir = mkdtempSync(join(tmpdir(), "cgp-claude-"));
    const file = join(dir, "claude-settings.json");
    const message = setupClaude(
      parseAppConfig({ server: { host: "0.0.0.0", port: 8787, apiKey: "cgp_claude_secret" } }),
      file,
    );
    const written = JSON.parse(readFileSync(file, "utf8")) as { env: { ANTHROPIC_BASE_URL: string; ANTHROPIC_API_KEY: string } };
    expect(written.env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:8787");
    expect(written.env.ANTHROPIC_API_KEY).toBe("cgp_claude_secret");
    expect(message).toContain("ANTHROPIC_API_KEY=cgp_claude_secret");
    expect(message).not.toContain("pool-managed");
  });
});
