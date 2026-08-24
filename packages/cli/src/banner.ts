import { PROXY_NAME, PROXY_VERSION } from "@command-go-proxy/shared";
import type { Account } from "@command-go-proxy/shared";
import { aggregatePool } from "@command-go-proxy/quota-engine";

export function meter(ratio: number, width = 10): string {
  const filled = Math.round(Math.max(0, Math.min(1, ratio)) * width);
  return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
}

export function startupBanner(input: {
  accounts: Account[];
  api: string;
  dashboard: string;
  sessions: number;
  models: number;
}): string {
  const pool = aggregatePool(input.accounts);
  const available = input.accounts.filter((a) => a.enabled && (a.status === "available" || a.status === "active")).length;
  const cooldown = input.accounts.filter((a) => a.status === "cooldown" || a.status === "quota_exhausted").length;
  const line = (label: string, pct?: number, estimated?: boolean) => {
    if (pct === undefined) return `${label.padEnd(10)} Unavailable`;
    return `${label.padEnd(10)}${meter(pct / 100)}${estimated ? " ~" : "  "}${Math.round(pct)}% available`;
  };
  return [
    `\n${PROXY_NAME} v${PROXY_VERSION}`,
    "",
    `✓ Database loaded`,
    `✓ ${input.accounts.length} accounts loaded`,
    `✓ ${available} accounts available`,
    `✓ ${cooldown} account${cooldown === 1 ? "" : "s"} cooling down`,
    `✓ ${input.models} models available`,
    "",
    "API",
    input.api,
    "",
    "Dashboard",
    input.dashboard,
    "",
    "Routing",
    "sticky + quota aware",
    "",
    "Pool status",
    line("5h", pool.fiveHour?.remainingPercent, pool.fiveHour?.confidence === "estimated"),
    line("Weekly", pool.weekly?.remainingPercent, pool.weekly?.confidence === "estimated"),
    line("Monthly", pool.monthly?.remainingPercent, pool.monthly?.confidence === "estimated"),
    "",
    `Active sessions`,
    String(input.sessions),
    "",
    "Press Ctrl+C to stop.",
    "",
  ].join("\n");
}

export function compactStatus(input: { accounts: Account[]; api: string; dashboard: string; sessions: number }): string {
  const pool = aggregatePool(input.accounts);
  const available = input.accounts.filter((a) => a.enabled && (a.status === "available" || a.status === "active")).length;
  const cooldown = input.accounts.filter((a) => a.status === "cooldown" || a.status === "quota_exhausted").length;
  const line = (label: string, pct?: number, estimated?: boolean) => {
    if (pct === undefined) return `${label.padEnd(10)} Unavailable`;
    return `${label.padEnd(10)}${meter(pct / 100)}${estimated ? " ~" : "  "}${Math.round(pct)}% available`;
  };
  return [
    `${PROXY_NAME}`,
    "",
    `API        ${input.api}`,
    `Dashboard  ${input.dashboard}`,
    "",
    `Accounts   ${input.accounts.length}`,
    `Available  ${available}`,
    `Cooldown   ${cooldown}`,
    `Sessions   ${input.sessions}`,
    "",
    "Pool status",
    line("5h", pool.fiveHour?.remainingPercent, pool.fiveHour?.confidence === "estimated"),
    line("Weekly", pool.weekly?.remainingPercent, pool.weekly?.confidence === "estimated"),
    line("Monthly", pool.monthly?.remainingPercent, pool.monthly?.confidence === "estimated"),
  ].join("\n");
}
