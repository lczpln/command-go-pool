import type { Account, AccountCredential, AccountStatus, ProxyFailure } from "@command-go-proxy/shared";
import { policyFor } from "@command-go-proxy/shared";
import { remainingNormalized } from "@command-go-proxy/quota-engine";

const UNHEALTHY: AccountStatus[] = ["disabled", "auth_error", "quota_exhausted", "cooldown", "upstream_error"];

export function isEligible(account: Account, model?: string, now = Date.now()): boolean {
  if (!account.enabled) return false;
  if (account.status === "disabled" || account.status === "auth_error") return false;
  if (account.status === "quota_exhausted" || account.status === "cooldown") {
    if (account.cooldownUntil && account.cooldownUntil.getTime() <= now) return true;
    return false;
  }
  if (account.cooldownUntil && account.cooldownUntil.getTime() > now) return false;
  if (model && account.models && account.models.length > 0 && !account.models.includes(model)) return false;
  return true;
}

export function applyFailure(account: Account, failure: ProxyFailure, now = new Date()): Account {
  const policy = policyFor(failure.code);
  const next: Account = { ...account, lastFailureAt: now };
  if (policy.accountStatus) next.status = policy.accountStatus;
  if (policy.cooldown || failure.cooldownUntil) {
    next.status = failure.code === "quota_exhausted" || failure.code === "insufficient_credit" ? "quota_exhausted" : "cooldown";
    next.cooldownUntil = failure.cooldownUntil ?? new Date(now.getTime() + 30 * 60_000);
    next.cooldownReason = failure.message;
  }
  if (failure.code === "auth_failed") {
    next.status = "auth_error";
  }
  const rate = account.recentErrorRate ?? 0;
  next.recentErrorRate = Math.min(1, rate * 0.7 + 0.3);
  next.healthScore = Math.max(0, account.healthScore - 0.15);
  return next;
}

export function applySuccess(account: Account, now = new Date()): Account {
  return {
    ...account,
    status: account.activeSessionCount > 0 ? "active" : "available",
    lastSuccessAt: now,
    lastFailureAt: account.lastFailureAt,
    cooldownUntil: undefined,
    cooldownReason: undefined,
    recentErrorRate: (account.recentErrorRate ?? 0) * 0.5,
    healthScore: Math.min(1, account.healthScore + 0.05),
  };
}

export function maybeRecover(account: Account, now = Date.now()): Account | undefined {
  if (account.status === "disabled" || account.status === "auth_error") return undefined;
  if (!account.cooldownUntil) return undefined;
  if (account.cooldownUntil.getTime() > now) return undefined;
  return {
    ...account,
    status: "available",
    cooldownUntil: undefined,
    cooldownReason: undefined,
    healthScore: Math.min(1, account.healthScore + 0.2),
  };
}

export function exhausted(account: Account): boolean {
  const windows = [account.quota.fiveHour, account.quota.weekly, account.quota.monthly];
  return windows.some((w) => {
    const rem = remainingNormalized(w);
    return rem !== undefined && rem <= 0;
  });
}

export { UNHEALTHY };
