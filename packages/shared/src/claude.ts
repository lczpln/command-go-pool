import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const CLAUDE_FALLBACK_DEFAULTS = {
  sonnet: "deepseek/deepseek-v4-pro",
  opus: "deepseek/deepseek-v4-pro",
  haiku: "deepseek/deepseek-v4-flash",
} as const;

export interface ClaudeModelInput {
  id: string;
  aliasOf?: string;
}

export interface ClaudeModelDefaults {
  sonnet: string;
  opus: string;
  haiku: string;
}

export interface WriteClaudeOptions {
  origin: string;
  file: string;
  apiKey: string;
  models?: ClaudeModelInput[];
}

export function claudeSettingsPath(home: string): string {
  return join(home, "claude-settings.json");
}

export function pickClaudeModelDefaults(
  models: ClaudeModelInput[],
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

export function writeClaudeConfig(opts: WriteClaudeOptions): string {
  if (!opts.apiKey.trim()) {
    throw new Error("Pool API key is missing. Start the pool once so it can generate one, then re-run setup claude.");
  }
  mkdirSync(dirname(opts.file), { recursive: true });
  let current: Record<string, unknown> = {};
  if (existsSync(opts.file)) {
    const backup = `${opts.file}.bak.${Date.now()}`;
    copyFileSync(opts.file, backup);
    current = JSON.parse(readFileSync(opts.file, "utf8")) as Record<string, unknown>;
  }
  const env = { ...((current.env as Record<string, unknown> | undefined) ?? {}) };
  const defaults = pickClaudeModelDefaults(opts.models ?? [], {
    sonnet: typeof env.ANTHROPIC_DEFAULT_SONNET_MODEL === "string" ? env.ANTHROPIC_DEFAULT_SONNET_MODEL : undefined,
    opus: typeof env.ANTHROPIC_DEFAULT_OPUS_MODEL === "string" ? env.ANTHROPIC_DEFAULT_OPUS_MODEL : undefined,
    haiku: typeof env.ANTHROPIC_DEFAULT_HAIKU_MODEL === "string" ? env.ANTHROPIC_DEFAULT_HAIKU_MODEL : undefined,
  });
  env.ANTHROPIC_BASE_URL = opts.origin;
  env.ANTHROPIC_API_KEY = opts.apiKey;
  env.ANTHROPIC_DEFAULT_SONNET_MODEL = defaults.sonnet;
  env.ANTHROPIC_DEFAULT_OPUS_MODEL = defaults.opus;
  env.ANTHROPIC_DEFAULT_HAIKU_MODEL = defaults.haiku;
  current.env = env;
  writeFileSync(opts.file, `${JSON.stringify(current, null, 2)}\n`);
  return [
    `Updated ${opts.file}`,
    `Base URL: ${opts.origin}`,
    `Defaults: sonnet=${defaults.sonnet} opus=${defaults.opus} haiku=${defaults.haiku}`,
  ].join("\n");
}
