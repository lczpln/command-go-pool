import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAppConfig } from "@command-go-pool/shared";
import { setupOpenCode, setupOpenCodeFromConfig } from "../../packages/cli/src/setup.js";

describe("OpenCode setup", () => {
  it("adds the local provider, keeps unrelated providers, and writes a backup", async () => {
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
    const fetchImpl = async () =>
      new Response(JSON.stringify({ object: "list", data: [{ id: "deepseek/deepseek-v4-flash" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const message = await setupOpenCode("http://127.0.0.1:8787/v1", file, { fetchImpl });
    const written = JSON.parse(readFileSync(file, "utf8")) as {
      provider: Record<string, { options?: { baseURL?: string }; models?: Record<string, { name: string }> }>;
    };
    expect(written.provider.anthropic).toBeTruthy();
    expect(written.provider["command-go-pool"]?.options?.baseURL).toBe("http://127.0.0.1:8787/v1");
    expect(written.provider["command-go-pool"]?.models?.["deepseek/deepseek-v4-flash"]?.name).toBe("DeepSeek V4 Flash");
    expect(message).toContain("Unrelated providers were left untouched");
    expect(message).toContain("Added provider: command-go-pool");
    expect(readdirSync(dir).some((name) => name.startsWith("opencode.json.bak."))).toBe(true);
  });

  it("falls back to the default Go models when the pool is unreachable", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cgp-oc-down-"));
    const file = join(dir, "opencode.json");
    const fetchImpl = async () => {
      throw new Error("ECONNREFUSED");
    };
    const message = await setupOpenCode("http://127.0.0.1:8787/v1", file, { fetchImpl });
    const written = JSON.parse(readFileSync(file, "utf8")) as {
      provider: { "command-go-pool": { models: Record<string, unknown> } };
    };
    expect(written.provider["command-go-pool"].models["deepseek/deepseek-v4-pro"]).toBeTruthy();
    expect(message).toContain("using fallback models");
  });

  it("sends the saved pool API key when fetching models and writes it into opencode.json", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cgp-oc-key-"));
    const file = join(dir, "opencode.json");
    let auth: string | undefined;
    const fetchImpl: typeof fetch = async (_url, init) => {
      const headers = new Headers(init?.headers);
      auth = headers.get("authorization") ?? undefined;
      return new Response(JSON.stringify({ object: "list", data: [{ id: "deepseek/deepseek-v4-flash" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const message = await setupOpenCodeFromConfig(
      parseAppConfig({ server: { host: "0.0.0.0", port: 8787, apiKey: "pool-secret" } }),
      { file, fetchImpl },
    );
    const written = JSON.parse(readFileSync(file, "utf8")) as {
      provider: { "command-go-pool": { options?: { baseURL?: string; apiKey?: string } } };
    };
    expect(auth).toBe("Bearer pool-secret");
    expect(written.provider["command-go-pool"].options?.apiKey).toBe("pool-secret");
    expect(written.provider["command-go-pool"].options?.baseURL).toBe("http://127.0.0.1:8787/v1");
    expect(message).not.toContain("HTTP 401");
  });
});
