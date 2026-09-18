import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { clientApiKey } from "../pool-key.js";
import type { AppConfig } from "../config.js";
import type { OpenCodeModelInput } from "../opencode.js";
import { fetchPoolModels } from "../opencode.js";
import { backupFile, binaryOnPath, connectedFile, poolOpenAiUrl, resolveHome } from "./paths.js";
import type { ClientAdapter, ClientWriteResult, ConnectOptions, DetectEnv } from "./types.js";

export const CODEX_PROVIDER_ID = "command-go-pool";
export const CODEX_FALLBACK_MODEL = "deepseek/deepseek-v4-flash";

export function defaultCodexHome(env?: DetectEnv): string {
  return env?.env?.CODEX_HOME ?? process.env.CODEX_HOME ?? join(resolveHome(env), ".codex");
}

export function defaultCodexFile(env?: DetectEnv): string {
  return join(defaultCodexHome(env), "config.toml");
}

export function pickCodexModel(models: OpenCodeModelInput[], current?: string): string {
  const enabled = new Set(models.map((model) => model.id));
  if (current && (enabled.size === 0 || enabled.has(current))) return current;
  const canonical = models.filter((model) => !model.aliasOf).map((model) => model.id);
  const pool = canonical.length ? canonical : [...enabled];
  return (
    pool.find((id) => /pro/i.test(id) && !/vision/i.test(id)) ??
    pool.find((id) => /flash/i.test(id) && !/vision/i.test(id)) ??
    pool[0] ??
    CODEX_FALLBACK_MODEL
  );
}

export function upsertCodexToml(
  existing: string,
  opts: { model: string; baseUrl: string; apiKey: string },
): string {
  const normalized = existing.replace(/\r\n/g, "\n");
  const { preamble, rest } = splitPreamble(normalized);
  let nextPreamble = setTopLevelString(preamble, "model", opts.model);
  nextPreamble = setTopLevelString(nextPreamble, "model_provider", CODEX_PROVIDER_ID);
  const body = [
    `name = "Command Go Pool"`,
    `base_url = ${tomlString(opts.baseUrl)}`,
    `wire_api = "responses"`,
    `requires_openai_auth = false`,
    `supports_websockets = false`,
    `stream_idle_timeout_ms = 600000`,
    `experimental_bearer_token = ${tomlString(opts.apiKey)}`,
  ].join("\n");
  return upsertTable(`${nextPreamble}${rest}`, `model_providers.${CODEX_PROVIDER_ID}`, body);
}

export function removeCodexProvider(existing: string): string {
  const normalized = existing.replace(/\r\n/g, "\n");
  const { preamble, rest } = splitPreamble(normalized);
  let nextPreamble = preamble;
  if (/^model_provider\s*=\s*["']command-go-pool["']\s*$/m.test(nextPreamble)) {
    nextPreamble = setTopLevelString(nextPreamble, "model_provider", "openai");
  }
  return removeTable(`${nextPreamble}${rest}`, `model_providers.${CODEX_PROVIDER_ID}`);
}

function writeCodexFile(file: string, baseUrl: string, apiKey?: string, models?: OpenCodeModelInput[]): void {
  mkdirSync(dirname(file), { recursive: true });
  const previous = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (previous) backupFile(file);
  const currentModel = readTopLevelString(previous, "model");
  const next = upsertCodexToml(previous, {
    model: pickCodexModel(models ?? [], currentModel),
    baseUrl,
    apiKey: clientApiKey(apiKey),
  });
  writeFileSync(file, next.endsWith("\n") ? next : `${next}\n`);
}

export const codexAdapter: ClientAdapter = {
  id: "codex",
  name: "Codex Desktop",
  protocol: "openai",
  detect(env?: DetectEnv) {
    const home = defaultCodexHome(env);
    const configPath = defaultCodexFile(env);
    return {
      id: "codex",
      name: "Codex Desktop",
      protocol: "openai",
      installed: binaryOnPath("codex", env) || existsSync(home) || existsSync(configPath),
      configPath,
      howToRun: "Restart Codex Desktop after connect. Provider settings live in ~/.codex/config.toml.",
    };
  },
  connect(config: AppConfig, opts: ConnectOptions = {}): ClientWriteResult {
    const file = opts.file ?? defaultCodexFile({ homedir: opts.homedir });
    writeCodexFile(file, poolOpenAiUrl(config), opts.apiKey ?? config.server.apiKey, opts.models);
    return {
      id: "codex",
      ok: true,
      file,
      message: [
        `Wrote ${file}`,
        "Codex Desktop reads only the user-level ~/.codex/config.toml (not a project .codex/config.toml).",
        "",
        "Restart Codex Desktop, then pick Command Go Pool / the written model.",
      ].join("\n"),
    };
  },
  disconnect(config: AppConfig, opts: ConnectOptions = {}): ClientWriteResult {
    const file = opts.file ?? connectedFile(config, "codex", defaultCodexFile({ homedir: opts.homedir }));
    if (!existsSync(file)) {
      return { id: "codex", ok: true, file, message: `No Codex config at ${file}` };
    }
    backupFile(file);
    const next = removeCodexProvider(readFileSync(file, "utf8"));
    writeFileSync(file, next.endsWith("\n") ? next : `${next}\n`);
    return { id: "codex", ok: true, file, message: `Removed Command Go Pool provider from ${file}` };
  },
  writeKey(config: AppConfig, opts: ConnectOptions = {}): ClientWriteResult {
    const file = opts.file ?? connectedFile(config, "codex", defaultCodexFile({ homedir: opts.homedir }));
    writeCodexFile(file, poolOpenAiUrl(config), opts.apiKey ?? config.server.apiKey, opts.models);
    return { id: "codex", ok: true, file, message: `Updated pool API key in ${file}` };
  },
};

export async function connectCodexWithModels(
  config: AppConfig,
  opts: ConnectOptions = {},
): Promise<ClientWriteResult> {
  if (opts.models?.length) return codexAdapter.connect(config, opts);
  const fetched = await fetchPoolModels(poolOpenAiUrl(config), opts.apiKey ?? config.server.apiKey, opts.fetchImpl);
  const result = codexAdapter.connect(config, { ...opts, models: fetched.models });
  if (fetched.warning) return { ...result, message: `${result.message}\n${fetched.warning}` };
  return result;
}

function splitPreamble(text: string): { preamble: string; rest: string } {
  const idx = text.search(/^\[/m);
  if (idx < 0) return { preamble: text, rest: "" };
  return { preamble: text.slice(0, idx), rest: text.slice(idx) };
}

function setTopLevelString(preamble: string, key: string, value: string): string {
  const line = `${key} = ${tomlString(value)}`;
  const re = new RegExp(`^${escapeRegExp(key)}\\s*=\\s*.*$`, "m");
  if (re.test(preamble)) return preamble.replace(re, line);
  if (!preamble.trim()) return `${line}\n`;
  return preamble.endsWith("\n") ? `${line}\n${preamble}` : `${line}\n${preamble}\n`;
}

function readTopLevelString(text: string, key: string): string | undefined {
  const { preamble } = splitPreamble(text.replace(/\r\n/g, "\n"));
  const match = preamble.match(new RegExp(`^${escapeRegExp(key)}\\s*=\\s*(.*)$`, "m"));
  if (!match) return undefined;
  const raw = match[1]?.trim() ?? "";
  const quoted = raw.match(/^"(.*)"$/) ?? raw.match(/^'(.*)'$/);
  return quoted ? quoted[1] : raw || undefined;
}

function upsertTable(text: string, name: string, body: string): string {
  const block = `[${name}]\n${body}\n`;
  const re = tableRegex(name);
  if (re.test(text)) return text.replace(re, block);
  const trimmed = text.replace(/\s*$/, "");
  return trimmed ? `${trimmed}\n\n${block}` : block;
}

function removeTable(text: string, name: string): string {
  return text.replace(tableRegex(name), "").replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "");
}

function tableRegex(name: string): RegExp {
  return new RegExp(`^\\[${escapeRegExp(name)}\\][^\\[]*(?=^\\[|\\s*$)`, "m");
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
