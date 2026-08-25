import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { displayNameForModel, OPENCODE_FALLBACK_MODELS } from "./models.js";

export interface OpenCodeModelInput {
  id: string;
  name?: string;
}

export interface WriteOpenCodeOptions {
  baseUrl: string;
  file: string;
  models: OpenCodeModelInput[];
  apiKey?: string;
}

export function writeOpenCodeConfig(opts: WriteOpenCodeOptions): string {
  mkdirSync(dirname(opts.file), { recursive: true });
  let current: Record<string, unknown> = {};
  if (existsSync(opts.file)) {
    const backup = `${opts.file}.bak.${Date.now()}`;
    copyFileSync(opts.file, backup);
    current = JSON.parse(readFileSync(opts.file, "utf8")) as Record<string, unknown>;
  }
  const provider = (current.provider as Record<string, unknown> | undefined) ?? {};
  const models: Record<string, { name: string }> = {};
  for (const model of opts.models) {
    models[model.id] = { name: model.name ?? displayNameForModel(model.id) };
  }
  provider["command-go-pool"] = {
    npm: "@ai-sdk/openai-compatible",
    name: "Command Go Pool",
    options: {
      baseURL: opts.baseUrl,
      apiKey: opts.apiKey ?? process.env.COMMAND_GO_POOL_API_KEY ?? "pool-managed",
    },
    models,
  };
  current.provider = provider;
  if (!current.$schema) current.$schema = "https://opencode.ai/config.json";
  writeFileSync(opts.file, `${JSON.stringify(current, null, 2)}\n`);
  return [
    `Updated ${opts.file}`,
    "Added provider: command-go-pool",
    `Base URL: ${opts.baseUrl}`,
    `Models: ${opts.models.map((m) => m.id).join(", ") || "(none)"}`,
    "Unrelated providers were left untouched.",
  ].join("\n");
}

export async function fetchPoolModels(
  baseUrl: string,
  apiKey?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ models: OpenCodeModelInput[]; warning?: string }> {
  const headers: Record<string, string> = {};
  const key = apiKey ?? process.env.COMMAND_GO_POOL_API_KEY;
  if (key) headers.authorization = `Bearer ${key}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/models`, { headers, signal: controller.signal });
    if (!res.ok) {
      return { models: OPENCODE_FALLBACK_MODELS, warning: `Pool returned HTTP ${res.status}; using fallback models.` };
    }
    const json = (await res.json()) as { data?: Array<{ id?: string }> };
    const models = (json.data ?? [])
      .map((row) => row.id)
      .filter((id): id is string => Boolean(id))
      .map((id) => ({ id, name: displayNameForModel(id) }));
    if (models.length === 0) {
      return { models: OPENCODE_FALLBACK_MODELS, warning: "Pool returned no models; using fallback models." };
    }
    return { models };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "network error";
    return { models: OPENCODE_FALLBACK_MODELS, warning: `Could not reach the pool (${reason}); using fallback models.` };
  } finally {
    clearTimeout(timer);
  }
}
