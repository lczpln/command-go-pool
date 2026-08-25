import type { Account } from "./types.js";
import type { AppConfig } from "./config.js";

export type ModelPolicyConfig = Pick<AppConfig, "aliases" | "models">;

export interface CatalogEntry {
  id: string;
  enabled: boolean;
  accountIds: string[];
  aliasOf?: string;
}

export const OPENCODE_FALLBACK_MODELS: Array<{ id: string; name: string }> = [
  { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash" },
  { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro" },
  { id: "deepseek/deepseek-v4-flash-vision-exp", name: "DeepSeek V4 Flash Vision" },
];

const KNOWN_NAMES = new Map(OPENCODE_FALLBACK_MODELS.map((row) => [row.id, row.name]));

export function isModelEnabled(id: string, config: ModelPolicyConfig): boolean {
  const disabled = config.models?.disabled ?? [];
  if (disabled.includes(id)) return false;
  const canonical = config.aliases[id] ?? id;
  if (canonical !== id && disabled.includes(canonical)) return false;
  return true;
}

export function setModelEnabled(disabled: string[], id: string, enabled: boolean): string[] {
  const next = new Set(disabled);
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
          enabled: isModelEnabled(id, config),
          accountIds: [account.id],
        });
      }
    }
  }
  for (const id of config.models?.disabled ?? []) {
    if (!byId.has(id)) {
      byId.set(id, { id, enabled: false, accountIds: [] });
    }
  }
  for (const [alias, target] of Object.entries(config.aliases)) {
    if (!target) continue;
    const targetEntry = byId.get(target);
    if (!targetEntry && !(config.models?.disabled ?? []).includes(alias)) continue;
    byId.set(alias, {
      id: alias,
      enabled: isModelEnabled(alias, config),
      accountIds: targetEntry?.accountIds ?? [],
      aliasOf: target,
    });
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function exposedInferenceModels(
  ids: Iterable<string>,
  config: ModelPolicyConfig,
): Array<{ id: string; object: "model"; owned_by: string }> {
  const enabled = new Set<string>();
  for (const id of ids) {
    if (isModelEnabled(id, config)) enabled.add(id);
  }
  const out = [...enabled].map((id) => ({
    id,
    object: "model" as const,
    owned_by: id.split("/")[0] ?? "command-code",
  }));
  for (const [alias, target] of Object.entries(config.aliases)) {
    if (target && enabled.has(target) && isModelEnabled(alias, config)) {
      out.push({ id: alias, object: "model", owned_by: "alias" });
    }
  }
  return out;
}
