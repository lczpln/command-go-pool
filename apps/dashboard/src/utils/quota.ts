import type { QuotaWindow } from "../composables/usePool";

export type QuotaTone = "ok" | "warn" | "bad" | "empty";

export interface QuotaView {
  filled: number;
  remaining?: number;
  text: string;
  tone: QuotaTone;
  note?: string;
  reset?: string;
  estimated: boolean;
}

export function formatQuotaView(window?: QuotaWindow): QuotaView {
  if (!window || window.confidence === "unknown") {
    return {
      filled: 0,
      text: "—",
      tone: "empty",
      note: "Quota information unavailable",
      estimated: false,
    };
  }
  const remaining = remainingFraction(window);
  const estimated = window.confidence === "estimated" || window.source === "local-estimate";
  if (remaining === undefined) {
    if (typeof window.remaining === "number") {
      return {
        filled: 0,
        remaining: window.remaining,
        text: `${formatCredits(window.remaining)} cr`,
        tone: "ok",
        estimated,
      };
    }
    return {
      filled: 0,
      text: "—",
      tone: "empty",
      note: "Quota information unavailable",
      estimated: false,
    };
  }
  const prefix = estimated ? "~" : "";
  const reset = window.resetAt ? formatReset(window.resetAt) : undefined;
  if (remaining <= 0) {
    return {
      filled: 100,
      remaining: 0,
      text: "0%",
      tone: "bad",
      note: estimated ? "Estimated from local usage" : "Exhausted",
      reset,
      estimated,
    };
  }
  return {
    filled: Math.max(0, Math.min(100, remaining)),
    remaining,
    text: `${prefix}${Math.round(remaining)}%`,
    tone: remaining < 25 ? "warn" : "ok",
    note: estimated ? "Estimated from local usage" : undefined,
    reset,
    estimated,
  };
}

function remainingFraction(window: QuotaWindow): number | undefined {
  if (typeof window.remainingPercent === "number") return clamp(window.remainingPercent);
  if (typeof window.usedPercent === "number") return clamp(100 - window.usedPercent);
  if (typeof window.remaining === "number" && typeof window.total === "number" && window.total > 0) {
    return clamp((window.remaining / window.total) * 100);
  }
  if (typeof window.used === "number" && typeof window.total === "number" && window.total > 0) {
    return clamp((1 - window.used / window.total) * 100);
  }
  return undefined;
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}

function formatCredits(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}

export function formatReset(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms > 48 * 3600_000) {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  }
  return resetIn(iso);
}

export function resetIn(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "resetting";
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function segments(filled: number, count = 20): boolean[] {
  const n = Math.round((Math.max(0, Math.min(100, filled)) / 100) * count);
  return Array.from({ length: count }, (_, i) => i < n);
}
