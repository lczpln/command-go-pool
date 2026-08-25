import type { Account, ModelInfo } from "./types.js";
import type { AppConfig } from "./config.js";

export type ModelPolicyConfig = Pick<AppConfig, "aliases" | "models">;

export interface CatalogEntry {
  id: string;
  enabled: boolean;
  accountIds: string[];
  aliasOf?: string;
  locked?: boolean;
  lockReason?: string;
}

export interface ModelTraits {
  reasoning?: boolean;
  vision?: boolean;
  contextWindow?: number;
  outputLimit?: number;
}

export const OPENCODE_FALLBACK_MODELS: Array<{
  id: string;
  name: string;
  reasoning?: boolean;
  vision?: boolean;
  contextWindow?: number;
}> = [
  { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", reasoning: true, contextWindow: 1_000_000 },
  { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro", reasoning: true, contextWindow: 1_000_000 },
  { id: "deepseek/deepseek-v4-flash-vision-exp", name: "DeepSeek V4 Flash Vision", reasoning: true, contextWindow: 1_000_000 },
];

const KNOWN_NAMES = new Map(OPENCODE_FALLBACK_MODELS.map((row) => [row.id, row.name]));

const KNOWN_TRAITS = new Map<string, ModelTraits>(
  OPENCODE_FALLBACK_MODELS.map((row) => [
    row.id,
    { reasoning: row.reasoning, vision: row.vision, contextWindow: row.contextWindow },
  ]),
);

export const OPENCODE_VISION_PREFERRED_MODELS = ["xiaomi/mimo-v2.5"];
export const OPENCODE_VISION_LOCK_REASON = "Required for OpenCode vision";

export function isRequiredVisionModel(id: string): boolean {
  const n = id.toLowerCase();
  const leaf = n.split("/").pop() ?? n;
  return OPENCODE_VISION_PREFERRED_MODELS.some((preferred) => {
    const p = preferred.toLowerCase();
    const pLeaf = p.split("/").pop() ?? p;
    return n === p || leaf === p || leaf === pLeaf;
  });
}

export function traitsForModel(id: string): ModelTraits {
  const known = KNOWN_TRAITS.get(id);
  return {
    reasoning: true,
    ...(known?.contextWindow ? { contextWindow: known.contextWindow } : {}),
    ...(known?.outputLimit ? { outputLimit: known.outputLimit } : {}),
  };
}

export function modelInventory(models: ModelInfo[]): Pick<Account, "models" | "modelCatalog"> {
  return { models: models.map((model) => model.id), modelCatalog: models };
}

export function catalogMeta(accounts: Array<Pick<Account, "modelCatalog">>): Map<string, ModelTraits> {
  const meta = new Map<string, ModelTraits>();
  for (const account of accounts) {
    for (const model of account.modelCatalog ?? []) {
      const prev = meta.get(model.id) ?? {};
      meta.set(model.id, {
        reasoning: model.reasoning ?? prev.reasoning,
        vision: model.vision ?? prev.vision,
        contextWindow: model.contextWindow ?? prev.contextWindow,
        outputLimit: model.outputLimit ?? prev.outputLimit,
      });
    }
  }
  return meta;
}

export function isModelEnabled(id: string, config: ModelPolicyConfig): boolean {
  if (isRequiredVisionModel(id) || isRequiredVisionModel(config.aliases[id] ?? id)) return true;
  const disabled = config.models?.disabled ?? [];
  if (disabled.includes(id)) return false;
  const canonical = config.aliases[id] ?? id;
  if (canonical !== id && disabled.includes(canonical)) return false;
  return true;
}

export function setModelEnabled(disabled: string[], id: string, enabled: boolean): string[] {
  const next = new Set(disabled.filter((item) => !isRequiredVisionModel(item)));
  if (isRequiredVisionModel(id)) return [...next].sort();
  if (enabled) next.delete(id);
  else next.add(id);
  return [...next].sort();
}

export function displayNameForModel(id: string): string {
  const known = KNOWN_NAMES.get(id);
  if (known) return known;
  const leaf = id.split("/").pop() ?? id;
  return leaf
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => {
      if (/^v\d/i.test(part) || /^\d/.test(part)) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

export function catalogModels(
  accounts: Array<Pick<Account, "id" | "models">>,
  config: ModelPolicyConfig,
): CatalogEntry[] {
  const byId = new Map<string, CatalogEntry>();
  for (const account of accounts) {
    for (const id of account.models ?? []) {
      const existing = byId.get(id);
      if (existing) existing.accountIds.push(account.id);
      else {
        byId.set(id, {
          id,
          ...catalogFlags(id, isModelEnabled(id, config)),
          accountIds: [account.id],
        });
      }
    }
  }
  for (const id of config.models?.disabled ?? []) {
    if (!byId.has(id)) {
      byId.set(id, { id, ...catalogFlags(id, false), accountIds: [] });
    }
  }
  for (const [alias, target] of Object.entries(config.aliases)) {
    if (!target) continue;
    const targetEntry = byId.get(target);
    if (!targetEntry && !(config.models?.disabled ?? []).includes(alias)) continue;
    byId.set(alias, {
      id: alias,
      ...catalogFlags(alias, isModelEnabled(alias, config)),
      accountIds: targetEntry?.accountIds ?? [],
      aliasOf: target,
    });
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function exposedInferenceModels(
  ids: Iterable<string>,
  config: ModelPolicyConfig,
  meta?: Map<string, ModelTraits>,
): Array<{ id: string; object: "model"; owned_by: string; reasoning?: boolean; context_window?: number }> {
  const enabled = new Set<string>();
  for (const id of ids) {
    if (isModelEnabled(id, config)) enabled.add(id);
  }
  const out = [...enabled].map((id) => listedModel(id, id.split("/")[0] ?? "command-code", config, meta));
  for (const [alias, target] of Object.entries(config.aliases)) {
    if (target && enabled.has(target) && isModelEnabled(alias, config)) {
      out.push(listedModel(alias, "alias", config, meta, target));
    }
  }
  return out;
}

export function enabledSyncModels(
  accounts: Array<Pick<Account, "id" | "models" | "modelCatalog">>,
  config: ModelPolicyConfig,
): Array<{ id: string; reasoning?: boolean; contextWindow?: number; outputLimit?: number }> {
  const meta = catalogMeta(accounts);
  return catalogModels(accounts, config)
    .filter((model) => model.enabled && !model.aliasOf)
    .map((model) => {
      const live = meta.get(model.id);
      const traits = traitsForModel(model.id);
      return {
        id: model.id,
        reasoning: live?.reasoning ?? traits.reasoning,
        contextWindow: live?.contextWindow ?? traits.contextWindow,
        outputLimit: live?.outputLimit ?? traits.outputLimit,
      };
    });
}

function catalogFlags(id: string, enabled: boolean): Pick<CatalogEntry, "enabled" | "locked" | "lockReason"> {
  if (!isRequiredVisionModel(id)) return { enabled };
  return { enabled: true, locked: true, lockReason: OPENCODE_VISION_LOCK_REASON };
}

function listedModel(
  id: string,
  ownedBy: string,
  config: ModelPolicyConfig,
  meta?: Map<string, ModelTraits>,
  target?: string,
): { id: string; object: "model"; owned_by: string; reasoning?: boolean; context_window?: number } {
  const canonical = target ?? config.aliases[id] ?? id;
  const live = meta?.get(id) ?? meta?.get(canonical);
  const traits = traitsForModel(canonical);
  const reasoning = typeof live?.reasoning === "boolean" ? live.reasoning : (traits.reasoning ?? true);
  const context = live?.contextWindow ?? traits.contextWindow;
  return {
    id,
    object: "model",
    owned_by: ownedBy,
    ...(reasoning ? { reasoning: true } : {}),
    ...(context ? { context_window: context } : {}),
  };
}
