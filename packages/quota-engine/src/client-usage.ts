import type { QuotaWindow } from "@command-go-pool/shared";

export type ClientQuota = {
  fiveHour?: QuotaWindow;
  weekly?: QuotaWindow;
  monthly?: QuotaWindow;
};

export type RateLimitStatus = "allowed" | "allowed_warning" | "rejected";

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function usedRatio(window?: QuotaWindow): number | undefined {
  if (!window || window.confidence === "unknown") return undefined;
  if (typeof window.usedPercent === "number") return clamp01(window.usedPercent / 100);
  if (typeof window.remainingPercent === "number") return clamp01(1 - window.remainingPercent / 100);
  if (typeof window.used === "number" && typeof window.total === "number" && window.total > 0) {
    return clamp01(window.used / window.total);
  }
  if (typeof window.remaining === "number" && typeof window.total === "number" && window.total > 0) {
    return clamp01(1 - window.remaining / window.total);
  }
  return undefined;
}

function round4(n: number): string {
  return (Math.round(n * 10_000) / 10_000).toString();
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function rateLimitStatus(ratio: number): RateLimitStatus {
  if (ratio >= 1) return "rejected";
  if (ratio >= 0.8) return "allowed_warning";
  return "allowed";
}

function resetUnix(window?: QuotaWindow): number | undefined {
  const ms = window?.resetAt?.getTime();
  if (!ms) return undefined;
  return Math.floor(ms / 1000);
}

function resetIso(window?: QuotaWindow): string | null {
  return window?.resetAt ? window.resetAt.toISOString() : null;
}

function severity(ratio: number): "normal" | "warning" | "critical" {
  if (ratio >= 0.9) return "critical";
  if (ratio >= 0.75) return "warning";
  return "normal";
}

export function clientUsageHeaders(quota: ClientQuota, now = Date.now()): Record<string, string> {
  const headers: Record<string, string> = {};
  const five = usedRatio(quota.fiveHour);
  const week = usedRatio(quota.weekly);
  const statuses: RateLimitStatus[] = [];

  if (five !== undefined) {
    const status = rateLimitStatus(five);
    statuses.push(status);
    headers["anthropic-ratelimit-unified-5h-utilization"] = round4(five);
    headers["anthropic-ratelimit-unified-5h-status"] = status;
    const reset = resetUnix(quota.fiveHour);
    if (reset) headers["anthropic-ratelimit-unified-5h-reset"] = String(reset);
  }
  if (week !== undefined) {
    const status = rateLimitStatus(week);
    statuses.push(status);
    headers["anthropic-ratelimit-unified-7d-utilization"] = round4(week);
    headers["anthropic-ratelimit-unified-7d-status"] = status;
    const reset = resetUnix(quota.weekly);
    if (reset) headers["anthropic-ratelimit-unified-7d-reset"] = String(reset);
  }

  if (statuses.length === 0) return headers;

  headers["anthropic-ratelimit-unified-status"] = statuses.includes("rejected")
    ? "rejected"
    : statuses.includes("allowed_warning")
      ? "allowed_warning"
      : "allowed";
  const fiveVal = five ?? -1;
  const weekVal = week ?? -1;
  headers["anthropic-ratelimit-unified-representative-claim"] = fiveVal >= weekVal ? "five_hour" : "seven_day";

  const primary = five ?? week;
  const primaryWindow = five !== undefined ? quota.fiveHour : quota.weekly;
  if (primary !== undefined) {
    headers["x-ratelimit-limit-requests"] = "100";
    headers["x-ratelimit-remaining-requests"] = String(Math.max(0, Math.round((1 - primary) * 100)));
    const reset = resetUnix(primaryWindow);
    if (reset) headers["x-ratelimit-reset-requests"] = String(Math.max(0, reset - Math.floor(now / 1000)));
  }

  const names = Object.keys(headers);
  if (names.length) headers["access-control-expose-headers"] = names.join(", ");
  return headers;
}

type OauthBucket = { utilization: number; resets_at: string | null };

function oauthBucket(window?: QuotaWindow): OauthBucket | null {
  const ratio = usedRatio(window);
  if (ratio === undefined) return null;
  return { utilization: round1(ratio * 100), resets_at: resetIso(window) };
}

export function claudeOauthUsage(quota: ClientQuota) {
  const five = oauthBucket(quota.fiveHour);
  const week = oauthBucket(quota.weekly);
  const monthRatio = usedRatio(quota.monthly);
  const limits: Array<Record<string, unknown>> = [];
  if (five) {
    limits.push({
      kind: "session",
      group: "session",
      percent: Math.round(five.utilization),
      severity: severity(five.utilization / 100),
      resets_at: five.resets_at,
      scope: null,
      is_active: true,
    });
  }
  if (week) {
    limits.push({
      kind: "weekly_all",
      group: "weekly",
      percent: Math.round(week.utilization),
      severity: severity(week.utilization / 100),
      resets_at: week.resets_at,
      scope: null,
      is_active: true,
    });
  }
  return {
    five_hour: five,
    seven_day: week,
    seven_day_opus: null,
    seven_day_sonnet: null,
    extra_usage:
      monthRatio === undefined
        ? { is_enabled: false, monthly_limit: null, used_credits: null, utilization: null }
        : {
            is_enabled: true,
            monthly_limit: quota.monthly?.total ?? null,
            used_credits:
              quota.monthly?.used ??
              (quota.monthly?.total !== undefined ? quota.monthly.total * monthRatio : null),
            utilization: round1(monthRatio * 100),
          },
    limits,
  };
}

export type OpenCodeUsageWindow =
  | { status: "ok"; percent: number; resetsAt: string | null }
  | { status: "unavailable" };

function openCodeWindow(window?: QuotaWindow): OpenCodeUsageWindow {
  const ratio = usedRatio(window);
  if (ratio === undefined) return { status: "unavailable" };
  return { status: "ok", percent: round1(ratio * 100), resetsAt: resetIso(window) };
}

export function openCodeUsage(quota: ClientQuota) {
  return {
    object: "usage",
    usage: {
      rolling: openCodeWindow(quota.fiveHour),
      weekly: openCodeWindow(quota.weekly),
      monthly: openCodeWindow(quota.monthly),
    },
  };
}
