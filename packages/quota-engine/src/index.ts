import type { Account, AccountQuota, QuotaWindow, QuotaWindowName } from "@command-go-proxy/shared";

export interface PlanCaps {
  id: string;
  monthlyCost: number;
  monthlyCredits: number;
  fiveHour: number;
  weekly: number;
}

export const PLAN_CATALOG: PlanCaps[] = [
  { id: "go", monthlyCost: 1, monthlyCredits: 10, fiveHour: 3, weekly: 6 },
  { id: "goat", monthlyCost: 10, monthlyCredits: 70, fiveHour: 14, weekly: 35 },
  { id: "pro", monthlyCost: 20, monthlyCredits: 80, fiveHour: 16, weekly: 40 },
  { id: "max10", monthlyCost: 100, monthlyCredits: 150, fiveHour: 45, weekly: 90 },
  { id: "max20", monthlyCost: 200, monthlyCredits: 300, fiveHour: 90, weekly: 180 },
  { id: "team_pro", monthlyCost: 40, monthlyCredits: 40, fiveHour: 12, weekly: 24 },
];

export function planById(planId?: string): PlanCaps | undefined {
  if (!planId) return undefined;
  const key = planId.toLowerCase().replace(/[^a-z0-9]/g, "");
  const ranked = [...PLAN_CATALOG].sort((a, b) => token(b).length - token(a).length);
  const exact = ranked.find((p) => token(p) === key);
  if (exact) return exact;
  return ranked.find((p) => key.includes(token(p)));
}

function token(plan: PlanCaps): string {
  return plan.id.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function planByWindowCaps(fiveHour?: number, weekly?: number): PlanCaps | undefined {
  if (fiveHour === undefined && weekly === undefined) return undefined;
  const matches = PLAN_CATALOG.filter((plan) => {
    const fiveOk = fiveHour === undefined || Math.abs(plan.fiveHour - fiveHour) < 0.05;
    const weekOk = weekly === undefined || Math.abs(plan.weekly - weekly) < 0.05;
    return fiveOk && weekOk;
  });
  return matches.length === 1 ? matches[0] : undefined;
}

export function remainingNormalized(window?: QuotaWindow): number | undefined {
  if (!window || window.confidence === "unknown") return undefined;
  if (typeof window.remainingPercent === "number") return clamp01(window.remainingPercent / 100);
  if (typeof window.usedPercent === "number") return clamp01(1 - window.usedPercent / 100);
  if (typeof window.remaining === "number" && typeof window.total === "number" && window.total > 0) {
    return clamp01(window.remaining / window.total);
  }
  if (typeof window.used === "number" && typeof window.total === "number" && window.total > 0) {
    return clamp01(1 - window.used / window.total);
  }
  return undefined;
}

export function quotaScore(quota: AccountQuota): number {
  const parts = [quota.fiveHour, quota.weekly, quota.monthly]
    .map(remainingNormalized)
    .filter((n): n is number => n !== undefined);
  if (parts.length === 0) return 0.5;
  return Math.min(...parts);
}

export function scoreAccount(
  account: Account,
  weights: { load: number } = { load: 0.04 },
): number {
  const q = quotaScore(account.quota);
  const loadPenalty = account.activeSessionCount * weights.load;
  const latencyPenalty = normalizeLatency(account.recentLatencyMs);
  const errorPenalty = account.recentErrorRate ?? 0;
  return q - loadPenalty - latencyPenalty - errorPenalty;
}

function normalizeLatency(ms?: number): number {
  if (!ms || ms <= 0) return 0;
  return Math.min(ms / 10_000, 0.3);
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function windowPercent(window?: QuotaWindow): { used?: number; available?: number; estimated: boolean; unknown: boolean } {
  if (!window || window.confidence === "unknown") {
    return { estimated: false, unknown: true };
  }
  const used = window.usedPercent ?? (window.remainingPercent !== undefined ? 100 - window.remainingPercent : undefined);
  const available = window.remainingPercent ?? (used !== undefined ? 100 - used : undefined);
  return {
    used,
    available,
    estimated: window.confidence === "estimated" || window.source === "local-estimate",
    unknown: false,
  };
}

export interface PoolQuota {
  fiveHour?: QuotaWindow;
  weekly?: QuotaWindow;
  monthly?: QuotaWindow;
  estimatedCreditsAvailable?: number;
}

export function aggregatePool(accounts: Account[]): PoolQuota {
  const enabled = accounts.filter((a) => a.enabled && a.status !== "disabled");
  return {
    fiveHour: mixWindow(enabled.map((a) => a.quota.fiveHour)),
    weekly: mixWindow(enabled.map((a) => a.quota.weekly)),
    monthly: mixWindow(enabled.map((a) => a.quota.monthly)),
    estimatedCreditsAvailable: sumRemaining(enabled),
  };
}

function mixWindow(windows: (QuotaWindow | undefined)[]): QuotaWindow | undefined {
  const known = windows.filter((w): w is QuotaWindow => !!w && w.confidence !== "unknown");
  if (known.length === 0) return { source: "unknown", confidence: "unknown" };
  const exact = known.filter((w) => w.confidence === "exact" && typeof remainingNormalized(w) === "number");
  const usable = exact.length > 0 ? exact : known.filter((w) => typeof remainingNormalized(w) === "number");
  if (usable.length === 0) {
    const withRemaining = known.filter((w) => typeof w.remaining === "number");
    if (withRemaining.length === 0) return { source: "unknown", confidence: "unknown" };
    const remainingSum = withRemaining.reduce((s, w) => s + (w.remaining ?? 0), 0);
    const estimated = withRemaining.some((w) => w.confidence !== "exact");
    const resets = withRemaining.map((w) => w.resetAt?.getTime()).filter((n): n is number => typeof n === "number");
    return {
      remaining: remainingSum,
      resetAt: resets.length ? new Date(Math.min(...resets)) : undefined,
      source: estimated ? "local-estimate" : "upstream",
      confidence: estimated ? "estimated" : "exact",
    };
  }
  const remaining = usable.reduce((s, w) => s + (remainingNormalized(w) ?? 0), 0) / usable.length;
  const usedSum = usable.reduce((s, w) => s + (w.used ?? 0), 0);
  const remainingSum = usable.reduce((s, w) => s + (w.remaining ?? 0), 0);
  const totalSum = usable.reduce((s, w) => s + (w.total ?? 0), 0);
  const estimated = usable.some((w) => w.confidence !== "exact");
  const resets = usable.map((w) => w.resetAt?.getTime()).filter((n): n is number => typeof n === "number");
  return {
    used: totalSum > 0 ? usedSum : undefined,
    remaining: remainingSum || undefined,
    total: totalSum || undefined,
    remainingPercent: remaining * 100,
    usedPercent: (1 - remaining) * 100,
    resetAt: resets.length ? new Date(Math.min(...resets)) : undefined,
    source: estimated ? "local-estimate" : "upstream",
    confidence: estimated ? "estimated" : "exact",
  };
}

function sumRemaining(accounts: Account[]): number | undefined {
  let sum = 0;
  let any = false;
  for (const account of accounts) {
    const monthly = account.quota.monthly;
    if (monthly?.confidence === "unknown") continue;
    if (typeof monthly?.remaining === "number") {
      sum += monthly.remaining;
      any = true;
    }
  }
  return any ? sum : undefined;
}

export function applyLocalUsage(window: QuotaWindow | undefined, cost: number, name: QuotaWindowName): QuotaWindow {
  if (!cost) return window ?? { source: "unknown", confidence: "unknown" };
  if (!window || window.confidence === "unknown") {
    return {
      used: cost,
      source: "local-estimate",
      confidence: "estimated",
    };
  }
  if (window.confidence === "exact") return window;
  const used = (window.used ?? 0) + cost;
  const total = window.total;
  const remaining = total !== undefined ? Math.max(0, total - used) : window.remaining !== undefined ? Math.max(0, window.remaining - cost) : undefined;
  return {
    ...window,
    used,
    remaining,
    usedPercent: total ? (used / total) * 100 : window.usedPercent,
    remainingPercent: total ? (remaining! / total) * 100 : window.remainingPercent,
    source: "local-estimate",
    confidence: "estimated",
  };
}

export function subsidyMultiplier(paid: number, consumed: number): number | undefined {
  if (paid <= 0 || consumed < 0) return undefined;
  if (consumed === 0) return 0;
  return consumed / paid;
}
