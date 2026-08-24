import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { setupOpenCode } from "../../packages/cli/src/setup.js";

describe("OpenCode setup", () => {
  it("adds the local provider, keeps unrelated providers, and writes a backup", () => {
    const dir = mkdtempSync(join(tmpdir(), "cgp-oc-"));
    const file = join(dir, "opencode.json");
    writeFileSync(
      file,
      JSON.stringify({
        provider: {
          anthropic: { npm: "@ai-sdk/anthropic", name: "Anthropic" },
        },
      }),
    );
    const message = setupOpenCode("http://127.0.0.1:8787/v1", file);
    const written = JSON.parse(readFileSync(file, "utf8")) as {
      provider: Record<string, { options?: { baseURL?: string } }>;
    };
    expect(written.provider.anthropic).toBeTruthy();
    expect(written.provider["command-go-pool"]?.options?.baseURL).toBe("http://127.0.0.1:8787/v1");
    expect(message).toContain("Unrelated providers were left untouched");
    expect(message).toContain("Added provider: command-go-pool");
    expect(readdirSync(dir).some((name) => name.startsWith("opencode.json.bak."))).toBe(true);
  });
});
