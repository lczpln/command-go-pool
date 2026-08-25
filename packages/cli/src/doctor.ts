import { existsSync } from "node:fs";
import { dataHome, loadConfig, paths } from "@command-go-pool/storage";
import type { AccountPool } from "@command-go-pool/account-pool";

export async function doctor(pool: AccountPool): Promise<number> {
  const home = dataHome();
  const p = paths(home);
  const checks: { ok: boolean; name: string; detail: string }[] = [];
  checks.push({ ok: existsSync(home), name: "data directory", detail: home });
  checks.push({ ok: existsSync(p.db), name: "sqlite", detail: p.db });
  checks.push({ ok: existsSync(p.config), name: "config", detail: p.config });
  checks.push({ ok: existsSync(p.secrets) || pool.list().length === 0, name: "secret store", detail: p.secrets });
  const keySet = existsSync(p.config) && Boolean(loadConfig(home).server.apiKey?.trim());
  checks.push({ ok: true, name: "pool API key", detail: keySet ? "set" : "unset (optional)" });
  const accounts = pool.list();
  checks.push({ ok: accounts.length > 0, name: "accounts", detail: `${accounts.length} configured` });
  const authOk = accounts.filter((a) => a.status !== "auth_error");
  checks.push({ ok: authOk.length > 0 || accounts.length === 0, name: "auth", detail: `${authOk.length} without auth_error` });
  let failed = 0;
  for (const check of checks) {
    console.log(`${check.ok ? "✓" : "✗"} ${check.name.padEnd(16)} ${check.detail}`);
    if (!check.ok) failed += 1;
  }
  return failed === 0 ? 0 : 1;
}
