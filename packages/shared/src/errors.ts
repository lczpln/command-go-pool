import type { PoolErrorCode, PoolFailure, QuotaWindowName } from "./types.js";

export interface ErrorPolicy {
  code: PoolErrorCode;
  retryable: boolean;
  failover: boolean;
  accountStatus?: "cooldown" | "auth_error" | "upstream_error" | "quota_exhausted" | "available";
  cooldown?: boolean;
}

export const ERROR_POLICIES: Record<PoolErrorCode, ErrorPolicy> = {
  quota_exhausted: { code: "quota_exhausted", retryable: true, failover: true, accountStatus: "quota_exhausted", cooldown: true },
  rate_limited: { code: "rate_limited", retryable: true, failover: true, accountStatus: "cooldown", cooldown: true },
  auth_failed: { code: "auth_failed", retryable: true, failover: true, accountStatus: "auth_error" },
  insufficient_credit: { code: "insufficient_credit", retryable: true, failover: true, accountStatus: "quota_exhausted", cooldown: true },
  unsupported_model: { code: "unsupported_model", retryable: false, failover: true },
  network_error: { code: "network_error", retryable: true, failover: true, accountStatus: "upstream_error" },
  upstream_5xx: { code: "upstream_5xx", retryable: true, failover: true, accountStatus: "upstream_error" },
  timeout: { code: "timeout", retryable: true, failover: true, accountStatus: "upstream_error" },
  invalid_request: { code: "invalid_request", retryable: false, failover: false },
  client_cancelled: { code: "client_cancelled", retryable: false, failover: false },
  unknown: { code: "unknown", retryable: false, failover: true, accountStatus: "upstream_error" },
};

export function policyFor(code: PoolErrorCode): ErrorPolicy {
  return ERROR_POLICIES[code];
}

export function failure(code: PoolErrorCode, message: string, extra: Partial<PoolFailure> = {}): PoolFailure {
  const policy = policyFor(code);
  return {
    code,
    message,
    retryable: extra.retryable ?? policy.retryable,
    failover: extra.failover ?? policy.failover,
    cooldownUntil: extra.cooldownUntil,
    status: extra.status,
    window: extra.window,
  };
}

const WINDOW_RE = /(5[\s-]?hour|five[\s-]?hour|weekly|week|monthly|month)/i;
const RESET_RE = /resets?\s+(?:at|in)\s+([^.\n]+)/i;

export function classifyUpstreamError(input: {
  status?: number;
  bodyText?: string;
  name?: string;
  aborted?: boolean;
}): PoolFailure {
  const text = (input.bodyText ?? "").toLowerCase();
  if (input.aborted || input.name === "AbortError") {
    return failure("client_cancelled", "Request cancelled");
  }
  if (input.name === "TimeoutError" || text.includes("timeout")) {
    return failure("timeout", "Upstream timeout", { status: input.status });
  }
  if (input.status === 401 || text.includes("unauthorized") || text.includes("invalid 'authorization'")) {
    return failure("auth_failed", "Authentication failed", { status: 401 });
  }
  if (text.includes("insufficient credits") || text.includes("insufficient credit")) {
    return failure("insufficient_credit", "Insufficient credits", { status: input.status });
  }
  if (text.includes("usage limit") || text.includes("quota") || text.includes("rate limit reached your")) {
    const window = detectWindow(text);
    const cooldownUntil = parseResetTime(input.bodyText ?? "");
    return failure("quota_exhausted", input.bodyText?.slice(0, 280) || "Quota exhausted", {
      status: input.status,
      window,
      cooldownUntil,
    });
  }
  if (input.status === 429 || text.includes("rate_limit")) {
    return failure("rate_limited", "Rate limited", { status: 429, cooldownUntil: new Date(Date.now() + 30_000) });
  }
  if (text.includes("not supported") || text.includes("unsupported_model") || text.includes("model")) {
    if (text.includes("not supported") || text.includes("unknown model") || text.includes("unsupported")) {
      return failure("unsupported_model", input.bodyText?.slice(0, 280) || "Unsupported model", {
        status: input.status,
        failover: true,
        retryable: false,
      });
    }
  }
  if (text.includes("invalid prompt") || text.includes("validation error") || input.status === 400) {
    return failure("invalid_request", input.bodyText?.slice(0, 280) || "Invalid request", { status: input.status });
  }
  if ((input.status ?? 0) >= 500) {
    return failure("upstream_5xx", "Upstream server error", { status: input.status });
  }
  if (!input.status) {
    return failure("network_error", input.bodyText || "Network error");
  }
  return failure("unknown", input.bodyText?.slice(0, 280) || "Unknown upstream error", { status: input.status });
}

function detectWindow(text: string): QuotaWindowName | undefined {
  const match = text.match(WINDOW_RE);
  if (!match?.[1]) return undefined;
  const token = match[1].toLowerCase();
  if (token.includes("5") || token.includes("five")) return "fiveHour";
  if (token.includes("week")) return "weekly";
  if (token.includes("month")) return "monthly";
  return undefined;
}

export function parseResetTime(text: string, now = new Date()): Date | undefined {
  const match = text.match(RESET_RE);
  if (!match?.[1]) return undefined;
  const raw = match[1].trim();
  const inMatch = raw.match(/(\d+)\s*(h|hour|hours|m|min|minutes|d|day|days)/i);
  if (/^\d/.test(raw) && inMatch) {
    return addDuration(now, raw);
  }
  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) return new Date(parsed);
  const clock = raw.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (clock) {
    const next = new Date(now);
    let hour = Number(clock[1]);
    const minute = Number(clock[2]);
    const ap = clock[3]?.toLowerCase();
    if (ap === "pm" && hour < 12) hour += 12;
    if (ap === "am" && hour === 12) hour = 0;
    next.setHours(hour, minute, 0, 0);
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
    return next;
  }
  return addDuration(now, raw);
}

function addDuration(now: Date, raw: string): Date | undefined {
  let ms = 0;
  for (const part of raw.matchAll(/(\d+)\s*(d|h|m|days?|hours?|mins?|minutes?)/gi)) {
    const n = Number(part[1]);
    const unit = (part[2] ?? "m").toLowerCase();
    if (unit.startsWith("d")) ms += n * 86_400_000;
    else if (unit.startsWith("h")) ms += n * 3_600_000;
    else ms += n * 60_000;
  }
  return ms > 0 ? new Date(now.getTime() + ms) : undefined;
}
