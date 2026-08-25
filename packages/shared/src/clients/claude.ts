import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { clientApiKey } from "../pool-key.js";
import type { AppConfig } from "../config.js";
import { backupFile, binaryOnPath, connectedFile, poolOrigin, resolveHome } from "./paths.js";
import type { ClientAdapter, ClientWriteResult, ConnectOptions, DetectEnv } from "./types.js";

const CLAUDE_ENV = {
  ANTHROPIC_DEFAULT_SONNET_MODEL: "deepseek/deepseek-v4-pro",
  ANTHROPIC_DEFAULT_OPUS_MODEL: "deepseek/deepseek-v4-pro",
  ANTHROPIC_DEFAULT_HAIKU_MODEL: "deepseek/deepseek-v4-flash",
} as const;

export function defaultClaudeDir(env?: DetectEnv): string {
  return env?.env?.CLAUDE_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR ?? join(resolveHome(env), ".claude");
}

export function defaultClaudeFile(env?: DetectEnv): string {
  return join(defaultClaudeDir(env), "command-go-pool.json");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function claudeSettings(baseUrl: string, apiKey?: string): Record<string, unknown> {
  return {
    env: {
      ANTHROPIC_BASE_URL: baseUrl,
      ANTHROPIC_API_KEY: clientApiKey(apiKey),
      ...CLAUDE_ENV,
    },
  };
}

function writeClaudeFile(file: string, baseUrl: string, apiKey?: string): void {
  mkdirSync(dirname(file), { recursive: true });
  if (existsSync(file)) backupFile(file);
  writeFileSync(file, `${JSON.stringify(claudeSettings(baseUrl, apiKey), null, 2)}\n`);
}

export const claudeAdapter: ClientAdapter = {
  id: "claude",
  name: "Claude Code",
  protocol: "anthropic",
  detect(env?: DetectEnv) {
    const dir = defaultClaudeDir(env);
    const configPath = defaultClaudeFile(env);
    return {
      id: "claude",
      name: "Claude Code",
      protocol: "anthropic",
      installed: binaryOnPath("claude", env) || existsSync(dir) || existsSync(join(resolveHome(env), ".claude.json")),
      configPath,
      howToRun: `claude --settings ${configPath}`,
    };
  },
  connect(config: AppConfig, opts: ConnectOptions = {}): ClientWriteResult {
    const file = opts.file ?? defaultClaudeFile({ homedir: opts.homedir });
    writeClaudeFile(file, poolOrigin(config), opts.apiKey ?? config.server.apiKey);
    return {
      id: "claude",
      ok: true,
      file,
      message: [
        `Wrote ${file}`,
        "This file only sets ANTHROPIC_* for the pool. It does not modify ~/.claude/settings.json.",
        "",
        "Run:",
        `  claude --settings ${file}`,
      ].join("\n"),
    };
  },
  disconnect(config: AppConfig, opts: ConnectOptions = {}): ClientWriteResult {
    const file = opts.file ?? connectedFile(config, "claude", defaultClaudeFile({ homedir: opts.homedir }));
    if (!existsSync(file)) {
      return { id: "claude", ok: true, file, message: `No Claude pool settings at ${file}` };
    }
    backupFile(file);
    unlinkSync(file);
    return { id: "claude", ok: true, file, message: `Removed ${file}` };
  },
  writeKey(config: AppConfig, opts: ConnectOptions = {}): ClientWriteResult {
    const file = opts.file ?? connectedFile(config, "claude", defaultClaudeFile({ homedir: opts.homedir }));
    const apiKey = clientApiKey(opts.apiKey ?? config.server.apiKey);
    const baseUrl = poolOrigin(config);
    if (!existsSync(file)) {
      writeClaudeFile(file, baseUrl, apiKey);
      return { id: "claude", ok: true, file, message: `Wrote ${file} with pool API key` };
    }
    backupFile(file);
    const current = asRecord(JSON.parse(readFileSync(file, "utf8")));
    const envBlock = asRecord(current.env);
    envBlock.ANTHROPIC_API_KEY = apiKey;
    envBlock.ANTHROPIC_BASE_URL = typeof envBlock.ANTHROPIC_BASE_URL === "string" ? envBlock.ANTHROPIC_BASE_URL : baseUrl;
    current.env = envBlock;
    writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`);
    return { id: "claude", ok: true, file, message: `Updated pool API key in ${file}` };
  },
};
