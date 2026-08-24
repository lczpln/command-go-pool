import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export function setupOpenCode(baseUrl = "http://127.0.0.1:8787/v1", file = process.env.OPENCODE_CONFIG ?? join(homedir(), ".config/opencode/opencode.json")): string {
  mkdirSync(dirname(file), { recursive: true });
  let current: Record<string, unknown> = {};
  if (existsSync(file)) {
    const backup = `${file}.bak.${Date.now()}`;
    copyFileSync(file, backup);
    current = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  }
  const provider = (current.provider as Record<string, unknown> | undefined) ?? {};
  if (provider.commandcode && typeof provider.commandcode === "object") {
    /* keep unrelated keys */
  }
  provider["command-go-pool"] = {
    npm: "@ai-sdk/openai-compatible",
    name: "Command Go Pool",
    options: {
      baseURL: baseUrl,
      apiKey: process.env.COMMAND_GO_PROXY_API_KEY ?? "proxy-managed",
    },
    models: {
      "deepseek/deepseek-v4-flash": { name: "DeepSeek V4 Flash" },
      "deepseek/deepseek-v4-pro": { name: "DeepSeek V4 Pro" },
      "deepseek/deepseek-v4-flash-vision-exp": { name: "DeepSeek V4 Flash Vision" },
    },
  };
  current.provider = provider;
  if (!current.$schema) current.$schema = "https://opencode.ai/config.json";
  writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`);
  return [
    `Updated ${file}`,
    "Added provider: command-go-pool",
    `Base URL: ${baseUrl}`,
    "Unrelated providers were left untouched.",
  ].join("\n");
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
