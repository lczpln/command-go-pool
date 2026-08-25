import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fetchPoolModels, writeOpenCodeConfig, type AppConfig } from "@command-go-pool/shared";

export async function setupOpenCode(
  baseUrl = "http://127.0.0.1:8787/v1",
  file = process.env.OPENCODE_CONFIG ?? join(homedir(), ".config/opencode/opencode.json"),
  opts: { fetchImpl?: typeof fetch; apiKey?: string } = {},
): Promise<string> {
  const fetched = await fetchPoolModels(baseUrl, opts.apiKey, opts.fetchImpl);
  const lines = [
    writeOpenCodeConfig({
      baseUrl,
      file,
      models: fetched.models,
      apiKey: opts.apiKey ?? process.env.COMMAND_GO_POOL_API_KEY,
    }),
  ];
  if (fetched.warning) lines.push(fetched.warning);
  return lines.join("\n");
}

export function setupOpenCodeFromConfig(
  config: AppConfig,
  opts: { file?: string; fetchImpl?: typeof fetch } = {},
): Promise<string> {
  const host = config.server.host === "0.0.0.0" || config.server.host === "::" ? "127.0.0.1" : config.server.host;
  const baseUrl = `http://${host}:${config.server.port}/v1`;
  return setupOpenCode(baseUrl, opts.file, { fetchImpl: opts.fetchImpl, apiKey: config.server.apiKey });
}

export function setupClaude(baseUrl = "http://127.0.0.1:8787"): string {
  const file = join(homedir(), ".command-go-pool/claude-settings.json");
  mkdirSync(dirname(file), { recursive: true });
  const settings = {
    env: {
      ANTHROPIC_BASE_URL: baseUrl,
      ANTHROPIC_API_KEY: process.env.COMMAND_GO_POOL_API_KEY ?? "pool-managed",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "deepseek/deepseek-v4-pro",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "deepseek/deepseek-v4-pro",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "deepseek/deepseek-v4-flash",
    },
  };
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  return [
    `Wrote ${file}`,
    "This file only sets ANTHROPIC_* for the pool. It does not modify your global Claude environment.",
    "",
    "Run:",
    `  claude --settings ${file}`,
    "",
    "Claude Code /usage reads rate-limit headers on POST /v1/messages.",
    `Quota JSON: GET ${baseUrl}/api/oauth/usage  and  GET ${baseUrl}/v1/usage`,
    "",
    "Manual equivalent:",
    `  ANTHROPIC_BASE_URL=${baseUrl}`,
    "  ANTHROPIC_API_KEY=<your COMMAND_GO_POOL_API_KEY or pool-managed>",
  ].join("\n");
}
