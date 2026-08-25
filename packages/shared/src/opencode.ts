import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { displayNameForModel, isRequiredVisionModel, OPENCODE_FALLBACK_MODELS, traitsForModel } from "./models.js";

export function openCodeConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.OPENCODE_CONFIG ?? join(homedir(), ".config/opencode/opencode.json");
}

export interface OpenCodeModelInput {
  id: string;
  name?: string;
  aliasOf?: string;
  reasoning?: boolean;
  vision?: boolean;
  contextWindow?: number;
  outputLimit?: number;
}

export interface WriteOpenCodeOptions {
  baseUrl: string;
  file: string;
  models: OpenCodeModelInput[];
  apiKey?: string;
}

type OpenCodeModelEntry = {
  name: string;
  reasoning?: boolean;
  interleaved?: { field: "reasoning_content" };
  limit?: { context: number; output: number };
};

export const OPENCODE_PROVIDER_ID = "command-go-pool";
export const OPENCODE_EYESIGHT_PLUGIN = "opencode-eyesight";

const OPENCODE_VISION_AGENT = {
  tools: { "*": false, read: true },
  permission: { "*": "deny", read: "allow" },
  options: {},
};

export function pickOpenCodeVisionModel(models: OpenCodeModelInput[]): string | undefined {
  const usable = models.filter((model) => !model.aliasOf);
  if (usable.length === 0) return undefined;
  const preferred = usable.find((model) => isRequiredVisionModel(model.id));
  const id = preferred?.id ?? usable[0]?.id;
  return id ? `${OPENCODE_PROVIDER_ID}/${id}` : undefined;
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
  const models: Record<string, OpenCodeModelEntry> = {};
  for (const model of opts.models) {
    if (model.aliasOf) continue;
    models[model.id] = opencodeModelEntry(model);
  }
  provider[OPENCODE_PROVIDER_ID] = {
    npm: "@ai-sdk/openai-compatible",
    name: "Command Go Pool",
    options: {
      baseURL: opts.baseUrl,
      apiKey: opts.apiKey ?? process.env.COMMAND_GO_POOL_API_KEY,
    },
    models,
  };
  current.provider = provider;
  if (!current.$schema) current.$schema = "https://opencode.ai/config.json";
  const visionModel = pickOpenCodeVisionModel(opts.models);
  if (visionModel) {
    current.plugin = upsertEyesightPlugin(current.plugin, visionModel);
    current.agent = upsertVisionAgent(current.agent, visionModel);
  }
  writeFileSync(opts.file, `${JSON.stringify(current, null, 2)}\n`);
  return [
    `Updated ${opts.file}`,
    `Added provider: ${OPENCODE_PROVIDER_ID}`,
    `Base URL: ${opts.baseUrl}`,
    `Models: ${opts.models.map((m) => m.id).join(", ") || "(none)"}`,
    ...(visionModel
      ? [`Installed plugin: ${OPENCODE_EYESIGHT_PLUGIN} (${visionModel})`, "Configured agent: vision"]
      : []),
    "Unrelated providers were left untouched.",
    "Pool usage: GET /v1/usage",
  ].join("\n");
}

function upsertEyesightPlugin(existing: unknown, model: string): unknown[] {
  const plugins = Array.isArray(existing) ? [...existing] : [];
  const entry: [string, { model: string }] = [OPENCODE_EYESIGHT_PLUGIN, { model }];
  const index = plugins.findIndex(isEyesightPlugin);
  if (index >= 0) plugins[index] = entry;
  else plugins.push(entry);
  return plugins;
}

function isEyesightPlugin(item: unknown): boolean {
  if (item === OPENCODE_EYESIGHT_PLUGIN) return true;
  if (Array.isArray(item) && item[0] === OPENCODE_EYESIGHT_PLUGIN) return true;
  return Boolean(item && typeof item === "object" && (item as { package?: string }).package === OPENCODE_EYESIGHT_PLUGIN);
}

function upsertVisionAgent(existing: unknown, model: string): Record<string, unknown> {
  const agent = existing && typeof existing === "object" && !Array.isArray(existing) ? { ...(existing as Record<string, unknown>) } : {};
  const current = asRecord(agent.vision);
  agent.vision = {
    ...current,
    model,
    tools: { ...asRecord(current.tools), ...OPENCODE_VISION_AGENT.tools },
    permission: { ...asRecord(current.permission), ...OPENCODE_VISION_AGENT.permission },
    options: current.options && typeof current.options === "object" ? current.options : OPENCODE_VISION_AGENT.options,
  };
  return agent;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const DEFAULT_OUTPUT_LIMIT = 32_768;

export function opencodeModelEntry(model: OpenCodeModelInput): OpenCodeModelEntry {
  const traits = traitsForModel(model.id);
  const reasoning = model.reasoning ?? traits.reasoning ?? true;
  const context = model.contextWindow ?? traits.contextWindow;
  const output = model.outputLimit ?? traits.outputLimit ?? (context ? Math.min(context, DEFAULT_OUTPUT_LIMIT) : undefined);
  return {
    name: model.name ?? displayNameForModel(model.id),
    ...(reasoning ? { reasoning: true, interleaved: { field: "reasoning_content" as const } } : {}),
    ...(context ? { limit: { context, output: output ?? context } } : {}),
  };
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
    const json = (await res.json()) as { data?: Array<{ id?: string; reasoning?: boolean; context_window?: number }> };
    const models: OpenCodeModelInput[] = [];
    for (const row of json.data ?? []) {
      const id = row.id;
      if (!id) continue;
      const traits = traitsForModel(id);
      models.push({
        id,
        name: displayNameForModel(id),
        reasoning: row.reasoning ?? traits.reasoning,
        contextWindow: row.context_window ?? traits.contextWindow,
      });
    }
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
