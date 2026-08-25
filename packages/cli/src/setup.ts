import {
  clientHost,
  fetchPoolModels,
  writeClaudeConfig,
  writeOpenCodeConfig,
  claudeSettingsPath,
  openCodeConfigPath,
  type AppConfig,
} from "@command-go-pool/shared";
import { dataHome } from "@command-go-pool/storage";

function clientOrigin(config: AppConfig): string {
  return `http://${clientHost(config.server.host)}:${config.server.port}`;
}

export async function setupOpenCode(
  baseUrl = "http://127.0.0.1:8787/v1",
  file = openCodeConfigPath(),
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

export function setupClaude(config: AppConfig, file = claudeSettingsPath(dataHome())): string {
  const origin = clientOrigin(config);
  const apiKey = config.server.apiKey?.trim() || process.env.COMMAND_GO_POOL_API_KEY;
  if (!apiKey) {
    throw new Error("Pool API key is missing. Start the pool once so it can generate one, then re-run setup claude.");
  }
  const written = writeClaudeConfig({ origin, file, apiKey });
  return [
    written,
    "This file only sets ANTHROPIC_* for the pool. It does not modify your global Claude environment.",
    "",
    "Run:",
    `  claude --settings ${file}`,
    "",
    "Claude Code /usage reads rate-limit headers on POST /v1/messages.",
    `Quota JSON: GET ${origin}/api/oauth/usage  and  GET ${origin}/v1/usage`,
    "",
    "Manual equivalent:",
    `  ANTHROPIC_BASE_URL=${origin}`,
    `  ANTHROPIC_API_KEY=${apiKey}`,
  ].join("\n");
}
