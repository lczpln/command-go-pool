import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { applyEnvOverrides, parseAppConfig, type AppConfig } from "@command-go-pool/shared";
import { ensureHome, paths } from "./paths.js";

export function loadConfig(home?: string): AppConfig {
  const dir = ensureHome(home);
  const file = paths(dir).config;
  let raw: unknown = {};
  if (existsSync(file)) {
    raw = parseYaml(readFileSync(file, "utf8")) ?? {};
  }
  return applyEnvOverrides(parseAppConfig(raw));
}

export function saveConfig(config: AppConfig, home?: string): void {
  const dir = ensureHome(home);
  const file = paths(dir).config;
  writeFileSync(file, stringifyYaml(config), { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    /* ignore */
  }
}

export { dataHome, ensureHome, paths, existsConfig } from "./paths.js";
export { SecretStore } from "./secrets.js";
export { openDatabase } from "./db.js";
export { AccountRepo, SessionRepo, UsageRepo, EventRepo } from "./repos.js";
