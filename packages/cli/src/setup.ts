import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fetchProxyModels, writeOpenCodeConfig } from "@command-go-proxy/shared";

export async function setupOpenCode(
  baseUrl = "http://127.0.0.1:8787/v1",
  file = process.env.OPENCODE_CONFIG ?? join(homedir(), ".config/opencode/opencode.json"),
  opts: { fetchImpl?: typeof fetch; apiKey?: string } = {},
): Promise<string> {
  const fetched = await fetchProxyModels(baseUrl, opts.apiKey, opts.fetchImpl);
  const lines = [
    writeOpenCodeConfig({
      baseUrl,
      file,
      models: fetched.models,
      apiKey: opts.apiKey ?? process.env.COMMAND_GO_PROXY_API_KEY,
    }),
  ];
  if (fetched.warning) lines.push(fetched.warning);
  return lines.join("\n");
}

export function setupClaude(baseUrl = "http://127.0.0.1:8787"): string {
  const file = join(homedir(), ".command-go-proxy/claude-settings.json");
  mkdirSync(dirname(file), { recursive: true });
  const settings = {
    env: {
      ANTHROPIC_BASE_URL: baseUrl,
      ANTHROPIC_API_KEY: process.env.COMMAND_GO_PROXY_API_KEY ?? "proxy-managed",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "deepseek/deepseek-v4-pro",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "deepseek/deepseek-v4-pro",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "deepseek/deepseek-v4-flash",
    },
  };
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  return [
    `Wrote ${file}`,
    "This file only sets ANTHROPIC_* for the proxy. It does not modify your global Claude environment.",
    "",
    "Run:",
    `  claude --settings ${file}`,
    "",
    "Manual equivalent:",
    `  ANTHROPIC_BASE_URL=${baseUrl}`,
    "  ANTHROPIC_API_KEY=<your COMMAND_GO_PROXY_API_KEY or proxy-managed>",
  ].join("\n");
}
