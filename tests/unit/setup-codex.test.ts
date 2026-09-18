import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAppConfig } from "@command-go-pool/shared";
import { setupCodex } from "../../packages/cli/src/setup.js";

describe("Codex setup", () => {
  it("writes a Responses provider into user-level config.toml", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cgp-codex-"));
    const file = join(dir, "config.toml");
    writeFileSync(file, 'model = "gpt-5"\n\n[projects."/tmp/app"]\ntrust_level = "trusted"\n');
    const message = await setupCodex(
      parseAppConfig({ server: { host: "0.0.0.0", port: 8787, apiKey: "cgp_codex_secret" } }),
      file,
    );
    const written = readFileSync(file, "utf8");
    expect(written).toContain('model_provider = "command-go-pool"');
    expect(written).toContain("[model_providers.command-go-pool]");
    expect(written).toContain('base_url = "http://127.0.0.1:8787/v1"');
    expect(written).toContain('wire_api = "responses"');
    expect(written).toContain('experimental_bearer_token = "cgp_codex_secret"');
    expect(written).toContain('trust_level = "trusted"');
    expect(message).toContain(`Wrote ${file}`);
  });

  it("writes pool-managed when no pool API key is set", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cgp-codex-"));
    const file = join(dir, "config.toml");
    await setupCodex(parseAppConfig({ server: { host: "127.0.0.1", port: 8787 } }), file);
    expect(readFileSync(file, "utf8")).toContain('experimental_bearer_token = "pool-managed"');
  });
});
