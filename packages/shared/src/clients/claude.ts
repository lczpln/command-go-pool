import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { clientApiKey } from "../pool-key.js";
import type { AppConfig } from "../config.js";
import type { OpenCodeModelInput } from "../opencode.js";
import { backupFile, binaryOnPath, connectedFile, poolOrigin, resolveHome } from "./paths.js";
import type { ClientAdapter, ClientWriteResult, ConnectOptions, DetectEnv } from "./types.js";

export const CLAUDE_FALLBACK_DEFAULTS = {
  sonnet: "deepseek/deepseek-v4-pro",
  opus: "deepseek/deepseek-v4-pro",
  haiku: "deepseek/deepseek-v4-flash",
} as const;

export interface ClaudeModelDefaults {
  sonnet: string;
  opus: string;
  haiku: string;
}

export function pickClaudeModelDefaults(
  models: OpenCodeModelInput[],
  current?: Partial<ClaudeModelDefaults>,
): ClaudeModelDefaults {
  const ids = models.map((model) => model.id);
  const enabled = new Set(ids);
  const canonical = models.filter((model) => !model.aliasOf).map((model) => model.id);
  const pool = canonical.length ? canonical : ids;
  const keep = (id: string | undefined) => Boolean(id && enabled.has(id));
  const haiku =
    (keep(current?.haiku) ? current!.haiku! : undefined) ??
    pool.find((id) => /flash/i.test(id) && !/vision/i.test(id)) ??
    pool.find((id) => /flash/i.test(id)) ??
    pool[0] ??
    CLAUDE_FALLBACK_DEFAULTS.haiku;
  const pro =
    (keep(current?.sonnet) ? current!.sonnet! : undefined) ??
    pool.find((id) => /pro/i.test(id)) ??
    pool.find((id) => id !== haiku) ??
    pool[0] ??
    CLAUDE_FALLBACK_DEFAULTS.sonnet;
  const opus = (keep(current?.opus) ? current!.opus! : undefined) ?? pro;
  return { sonnet: pro, opus, haiku };
}

export function defaultClaudeDir(env?: DetectEnv): string {
  return env?.env?.CLAUDE_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR ?? join(resolveHome(env), ".claude");
}

export function defaultClaudeFile(env?: DetectEnv): string {
  return join(defaultClaudeDir(env), "command-go-pool.json");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function writeClaudeFile(file: string, baseUrl: string, apiKey?: string, models?: OpenCodeModelInput[]): void {
  mkdirSync(dirname(file), { recursive: true });
  let current: Record<string, unknown> = {};
  if (existsSync(file)) {
    backupFile(file);
    current = asRecord(JSON.parse(readFileSync(file, "utf8")));
  }
  const envBlock = asRecord(current.env);
  const defaults = pickClaudeModelDefaults(models ?? [], {
    sonnet: typeof envBlock.ANTHROPIC_DEFAULT_SONNET_MODEL === "string" ? envBlock.ANTHROPIC_DEFAULT_SONNET_MODEL : undefined,
    opus: typeof envBlock.ANTHROPIC_DEFAULT_OPUS_MODEL === "string" ? envBlock.ANTHROPIC_DEFAULT_OPUS_MODEL : undefined,
    haiku: typeof envBlock.ANTHROPIC_DEFAULT_HAIKU_MODEL === "string" ? envBlock.ANTHROPIC_DEFAULT_HAIKU_MODEL : undefined,
  });
  envBlock.ANTHROPIC_BASE_URL = baseUrl;
  envBlock.ANTHROPIC_API_KEY = clientApiKey(apiKey);
  envBlock.ANTHROPIC_AUTH_TOKEN = envBlock.ANTHROPIC_API_KEY;
  envBlock.ANTHROPIC_DEFAULT_SONNET_MODEL = defaults.sonnet;
  envBlock.ANTHROPIC_DEFAULT_OPUS_MODEL = defaults.opus;
  envBlock.ANTHROPIC_DEFAULT_HAIKU_MODEL = defaults.haiku;
  current.env = envBlock;
  writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`);
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
    writeClaudeFile(file, poolOrigin(config), opts.apiKey ?? config.server.apiKey, opts.models);
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
    envBlock.ANTHROPIC_AUTH_TOKEN = apiKey;
    envBlock.ANTHROPIC_BASE_URL = typeof envBlock.ANTHROPIC_BASE_URL === "string" ? envBlock.ANTHROPIC_BASE_URL : baseUrl;
    current.env = envBlock;
    writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`);
    return { id: "claude", ok: true, file, message: `Updated pool API key in ${file}` };
  },
};
