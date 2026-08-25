import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { clientApiKey } from "../pool-key.js";
import { fetchPoolModels, writeOpenCodeConfig, type OpenCodeModelInput } from "../opencode.js";
import { OPENCODE_FALLBACK_MODELS } from "../models.js";
import type { AppConfig } from "../config.js";
import { backupFile, binaryOnPath, connectedFile, poolOpenAiUrl, resolveHome } from "./paths.js";
import type { ClientAdapter, ClientWriteResult, ConnectOptions, DetectEnv } from "./types.js";

export function defaultOpenCodeFile(env?: DetectEnv): string {
  return env?.env?.OPENCODE_CONFIG ?? process.env.OPENCODE_CONFIG ?? join(resolveHome(env), ".config/opencode/opencode.json");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readJson(file: string): Record<string, unknown> {
  if (!existsSync(file)) return {};
  return asRecord(JSON.parse(readFileSync(file, "utf8")));
}

export const opencodeAdapter: ClientAdapter = {
  id: "opencode",
  name: "OpenCode",
  protocol: "openai",
  detect(env?: DetectEnv) {
    const configPath = defaultOpenCodeFile(env);
    const dir = join(resolveHome(env), ".config/opencode");
    return {
      id: "opencode",
      name: "OpenCode",
      protocol: "openai",
      installed: binaryOnPath("opencode", env) || existsSync(configPath) || existsSync(dir),
      configPath,
    };
  },
  connect(config: AppConfig, opts: ConnectOptions = {}): ClientWriteResult {
    const file = opts.file ?? defaultOpenCodeFile({ homedir: opts.homedir, env: process.env });
    const models = opts.models?.length ? opts.models : OPENCODE_FALLBACK_MODELS;
    const message = writeOpenCodeConfig({
      baseUrl: poolOpenAiUrl(config),
      file,
      models,
      apiKey: clientApiKey(opts.apiKey ?? config.server.apiKey),
    });
    return { id: "opencode", ok: true, file, message };
  },
  disconnect(config: AppConfig, opts: ConnectOptions = {}): ClientWriteResult {
    const file = opts.file ?? connectedFile(config, "opencode", defaultOpenCodeFile({ homedir: opts.homedir }));
    if (!existsSync(file)) {
      return { id: "opencode", ok: true, file, message: `No OpenCode config at ${file}` };
    }
    backupFile(file);
    const current = readJson(file);
    const provider = asRecord(current.provider);
    delete provider["command-go-pool"];
    current.provider = provider;
    writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`);
    return {
      id: "opencode",
      ok: true,
      file,
      message: `Removed provider command-go-pool from ${file}`,
    };
  },
  writeKey(config: AppConfig, opts: ConnectOptions = {}): ClientWriteResult {
    const file = opts.file ?? connectedFile(config, "opencode", defaultOpenCodeFile({ homedir: opts.homedir }));
    const apiKey = clientApiKey(opts.apiKey ?? config.server.apiKey);
    if (!existsSync(file)) {
      mkdirSync(dirname(file), { recursive: true });
      writeOpenCodeConfig({
        baseUrl: poolOpenAiUrl(config),
        file,
        models: OPENCODE_FALLBACK_MODELS,
        apiKey,
      });
      return { id: "opencode", ok: true, file, message: `Wrote ${file} with pool API key` };
    }
    backupFile(file);
    const current = readJson(file);
    const provider = asRecord(current.provider);
    const ours = asRecord(provider["command-go-pool"]);
    const options = asRecord(ours.options);
    options.apiKey = apiKey;
    ours.options = options;
    provider["command-go-pool"] = ours;
    current.provider = provider;
    writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`);
    return { id: "opencode", ok: true, file, message: `Updated pool API key in ${file}` };
  },
};

export async function connectOpenCodeWithModels(
  config: AppConfig,
  opts: ConnectOptions = {},
): Promise<ClientWriteResult> {
  if (opts.models?.length) return opencodeAdapter.connect(config, opts);
  const fetched = await fetchPoolModels(poolOpenAiUrl(config), opts.apiKey ?? config.server.apiKey, opts.fetchImpl);
  const result = opencodeAdapter.connect(config, { ...opts, models: fetched.models });
  if (fetched.warning) {
    return { ...result, message: `${result.message}\n${fetched.warning}` };
  }
  return result;
}
