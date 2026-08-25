import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { clientHost, fetchPoolModels, writeOpenCodeConfig, type AppConfig } from "@command-go-pool/shared";

function clientOrigin(config: AppConfig): string {
  return `http://${clientHost(config.server.host)}:${config.server.port}`;
}

export async function setupOpenCode(
  baseUrl = "http://127.0.0.1:8787/v1",
  file = process.env.OPENCODE_CONFIG ?? join(homedir(), ".config/opencode/opencode.json"),
  opts: { fetchImpl?: typeof fetch; apiKey?: string } = {},
): Promise<string> {
  const apiKey = opts.apiKey ?? process.env.COMMAND_GO_POOL_API_KEY;
  const fetched = await fetchPoolModels(baseUrl, apiKey, opts.fetchImpl);
  const lines = [
    writeOpenCodeConfig({
      baseUrl,
      file,
      models: fetched.models,
      apiKey,
    }),
  ];
  if (fetched.warning) lines.push(fetched.warning);
  return lines.join("\n");
}

export function setupOpenCodeFromConfig(
  config: AppConfig,
  opts: { file?: string; fetchImpl?: typeof fetch } = {},
): Promise<string> {
  return setupOpenCode(`${clientOrigin(config)}/v1`, opts.file, { fetchImpl: opts.fetchImpl, apiKey: config.server.apiKey });
}

export function setupClaude(
  config: AppConfig,
  file = join(homedir(), ".command-go-pool/claude-settings.json"),
): string {
  const baseUrl = clientOrigin(config);
  const apiKey = config.server.apiKey?.trim() || process.env.COMMAND_GO_POOL_API_KEY;
  if (!apiKey) {
    throw new Error("Pool API key is missing. Start the pool once so it can generate one, then re-run setup claude.");
  }
  mkdirSync(dirname(file), { recursive: true });
  const settings = {
    env: {
      ANTHROPIC_BASE_URL: baseUrl,
      ANTHROPIC_API_KEY: apiKey,
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
    `  ANTHROPIC_API_KEY=${apiKey}`,
  ].join("\n");
}
