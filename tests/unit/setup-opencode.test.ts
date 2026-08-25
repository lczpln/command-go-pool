import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAppConfig, writeOpenCodeConfig } from "@command-go-pool/shared";
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
    const message = await setupOpenCode("http://127.0.0.1:8787/v1", file, { fetchImpl, apiKey: "cgp_test" });
    const written = JSON.parse(readFileSync(file, "utf8")) as {
      provider: Record<
        string,
        {
          options?: { baseURL?: string; apiKey?: string };
          models?: Record<string, { name: string; reasoning?: boolean; interleaved?: { field: string } }>;
        }
      >;
    };
    expect(written.provider.anthropic).toBeTruthy();
    expect(written.provider["command-go-pool"]?.options?.baseURL).toBe("http://127.0.0.1:8787/v1");
    expect(written.provider["command-go-pool"]?.options?.apiKey).toBe("cgp_test");
    expect(written.provider["command-go-pool"]?.models?.["deepseek/deepseek-v4-flash"]?.name).toBe("DeepSeek V4 Flash");
    expect(written.provider["command-go-pool"]?.models?.["deepseek/deepseek-v4-flash"]?.reasoning).toBe(true);
    expect(written.provider["command-go-pool"]?.models?.["deepseek/deepseek-v4-flash"]?.interleaved).toEqual({
      field: "reasoning_content",
    });
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
    const message = await setupOpenCode("http://127.0.0.1:8787/v1", file, { fetchImpl, apiKey: "cgp_test" });
    const written = JSON.parse(readFileSync(file, "utf8")) as {
      provider: { "command-go-pool": { models: Record<string, unknown> } };
    };
    expect(written.provider["command-go-pool"].models["deepseek/deepseek-v4-pro"]).toMatchObject({
      reasoning: true,
      interleaved: { field: "reasoning_content" },
    });
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

  it("writes reasoning onto known Go models even when the caller only supplies ids", () => {
    const dir = mkdtempSync(join(tmpdir(), "cgp-oc-reason-"));
    const file = join(dir, "opencode.json");
    writeOpenCodeConfig({
      baseUrl: "http://127.0.0.1:8787/v1",
      file,
      models: [{ id: "deepseek/deepseek-v4-pro" }],
    });
    const written = JSON.parse(readFileSync(file, "utf8")) as {
      provider: { "command-go-pool": { models: Record<string, { reasoning?: boolean; interleaved?: { field: string } }> } };
    };
    expect(written.provider["command-go-pool"].models["deepseek/deepseek-v4-pro"]).toMatchObject({
      name: "DeepSeek V4 Pro",
      reasoning: true,
      interleaved: { field: "reasoning_content" },
      limit: { context: 1_000_000, output: 32_768 },
    });
    expect(written.provider["command-go-pool"].models.flash).toBeUndefined();
  });

  it("writes reasoning onto unknown models and context limits when supplied", () => {
    const dir = mkdtempSync(join(tmpdir(), "cgp-oc-reason-unknown-"));
    const file = join(dir, "opencode.json");
    writeOpenCodeConfig({
      baseUrl: "http://127.0.0.1:8787/v1",
      file,
      models: [{ id: "anthropic/claude-sonnet-5", contextWindow: 1_000_000, outputLimit: 64_000 }],
    });
    const written = JSON.parse(readFileSync(file, "utf8")) as {
      provider: {
        "command-go-pool": {
          models: Record<string, { reasoning?: boolean; interleaved?: { field: string }; limit?: { context: number; output: number } }>;
        };
      };
    };
    expect(written.provider["command-go-pool"].models["anthropic/claude-sonnet-5"]).toMatchObject({
      reasoning: true,
      interleaved: { field: "reasoning_content" },
      limit: { context: 1_000_000, output: 64_000 },
    });
    expect(written.provider["command-go-pool"].models["anthropic/claude-sonnet-5"].attachment).toBeUndefined();
  });

  it("keeps non-vision pool models text-only so opencode-eyesight can intercept images", () => {
    const dir = mkdtempSync(join(tmpdir(), "cgp-oc-vision-"));
    const file = join(dir, "opencode.json");
    writeOpenCodeConfig({
      baseUrl: "http://127.0.0.1:8787/v1",
      file,
      models: [{ id: "deepseek/deepseek-v4-flash" }, { id: "deepseek/deepseek-v4-flash-vision-exp" }],
    });
    const written = JSON.parse(readFileSync(file, "utf8")) as {
      provider: {
        "command-go-pool": {
          models: Record<string, { attachment?: boolean; modalities?: { input: string[] } }>;
        };
      };
    };
    expect(written.provider["command-go-pool"].models["deepseek/deepseek-v4-flash"].attachment).toBeUndefined();
    expect(written.provider["command-go-pool"].models["deepseek/deepseek-v4-flash"].modalities).toBeUndefined();
    expect(written.provider["command-go-pool"].models["deepseek/deepseek-v4-flash-vision-exp"].attachment).toBeUndefined();
    expect(written.provider["command-go-pool"].models["deepseek/deepseek-v4-flash-vision-exp"].modalities).toBeUndefined();
  });

  it("installs opencode-eyesight and the vision agent on connect, preferring MiMo", () => {
    const dir = mkdtempSync(join(tmpdir(), "cgp-oc-eyesight-"));
    const file = join(dir, "opencode.json");
    writeFileSync(
      file,
      JSON.stringify({
        plugin: ["@warp-dot-dev/opencode-warp", ["opencode-eyesight", { model: "opencode-go/mimo-v2.5" }]],
        agent: { build: { description: "keep me" } },
      }),
    );
    writeOpenCodeConfig({
      baseUrl: "http://127.0.0.1:8787/v1",
      file,
      models: [
        { id: "deepseek/deepseek-v4-flash" },
        { id: "xiaomi/mimo-v2.5" },
        { id: "google/gemini-3.5-flash-lite" },
      ],
    });
    const written = JSON.parse(readFileSync(file, "utf8")) as {
      plugin: unknown[];
      agent: {
        build?: unknown;
        vision?: { model?: string; tools?: Record<string, unknown>; permission?: Record<string, unknown> };
      };
      provider: {
        "command-go-pool": {
          models: Record<string, { attachment?: boolean; modalities?: { input: string[]; output: string[] } }>;
        };
      };
    };
    expect(written.plugin[0]).toBe("@warp-dot-dev/opencode-warp");
    expect(written.plugin[1]).toEqual(["opencode-eyesight", { model: "command-go-pool/xiaomi/mimo-v2.5" }]);
    expect(written.agent.build).toEqual({ description: "keep me" });
    expect(written.agent.vision).toMatchObject({
      model: "command-go-pool/xiaomi/mimo-v2.5",
      tools: { "*": false, read: true },
      permission: { "*": "deny", read: "allow" },
      options: {},
    });
    expect(written.provider["command-go-pool"].models["xiaomi/mimo-v2.5"]).toMatchObject({
      attachment: true,
      modalities: { input: ["text", "image"], output: ["text"] },
    });
    expect(written.provider["command-go-pool"].models["deepseek/deepseek-v4-flash"].attachment).toBeUndefined();
    expect(written.provider["command-go-pool"].models["deepseek/deepseek-v4-flash"].modalities).toBeUndefined();
    expect(written.provider["command-go-pool"].models["google/gemini-3.5-flash-lite"].attachment).toBeUndefined();
    expect(written.provider["command-go-pool"].models["google/gemini-3.5-flash-lite"].modalities).toBeUndefined();
  });

  it("does not declare image input on MiMo Pro or on the eyesight fallback model", () => {
    const dir = mkdtempSync(join(tmpdir(), "cgp-oc-eyesight-pro-"));
    const file = join(dir, "opencode.json");
    writeOpenCodeConfig({
      baseUrl: "http://127.0.0.1:8787/v1",
      file,
      models: [{ id: "xiaomi/mimo-v2.5-pro" }, { id: "deepseek/deepseek-v4-flash" }],
    });
    const written = JSON.parse(readFileSync(file, "utf8")) as {
      plugin: unknown[];
      provider: {
        "command-go-pool": {
          models: Record<string, { attachment?: boolean; modalities?: { input: string[] } }>;
        };
      };
    };
    expect(written.plugin).toEqual([
      ["opencode-eyesight", { model: "command-go-pool/xiaomi/mimo-v2.5-pro" }],
    ]);
    expect(written.provider["command-go-pool"].models["xiaomi/mimo-v2.5-pro"].attachment).toBeUndefined();
    expect(written.provider["command-go-pool"].models["xiaomi/mimo-v2.5-pro"].modalities).toBeUndefined();
    expect(written.provider["command-go-pool"].models["deepseek/deepseek-v4-flash"].attachment).toBeUndefined();
  });

  it("falls back to the first pool model when MiMo is not in the catalog", () => {
    const dir = mkdtempSync(join(tmpdir(), "cgp-oc-eyesight-fallback-"));
    const file = join(dir, "opencode.json");
    writeOpenCodeConfig({
      baseUrl: "http://127.0.0.1:8787/v1",
      file,
      models: [{ id: "deepseek/deepseek-v4-flash" }, { id: "deepseek/deepseek-v4-flash-vision-exp" }],
    });
    const written = JSON.parse(readFileSync(file, "utf8")) as { plugin: unknown[] };
    expect(written.plugin).toEqual([
      ["opencode-eyesight", { model: "command-go-pool/deepseek/deepseek-v4-flash" }],
    ]);
  });
});
