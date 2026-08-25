import type { Runtime } from "./runtime.js";
import { emit } from "./runtime.js";
import { modelInventory, type AccountQuota, type QuotaWindow } from "@command-go-pool/shared";

export function startHealthMonitor(runtime: Runtime): () => void {
  const tick = async () => {
    const recovered = runtime.pool.recoverExpired();
    for (const account of recovered) {
      const cred = runtime.pool.credential(account.id);
      if (!cred) continue;
      try {
        const status = await runtime.transport.getAccountStatus(cred);
        const current = runtime.pool.get(account.id);
        if (!current) continue;
        runtime.pool.replace({
          ...current,
          status: status.authenticated ? "available" : "auth_error",
          quota: mergeQuota(current.quota, status.quota),
          ...modelInventory(status.models),
          recentLatencyMs: status.latencyMs,
        });
        emit(runtime, {
          level: "info",
          category: "quota",
          type: "account.recovered",
          payload: { accountId: account.id, label: account.label },
        });
      } catch {
        /* stay in cooldown until next tick */
      }
    }
    for (const account of runtime.pool.list()) {
      if (!account.enabled || account.status === "disabled") continue;
      const cred = runtime.pool.credential(account.id);
      if (!cred) continue;
      try {
        const status = await runtime.transport.getAccountStatus(cred);
        const current = runtime.pool.get(account.id);
        if (!current) continue;
        const nextStatus = !status.authenticated
          ? "auth_error"
          : current.status === "auth_error"
            ? "available"
            : current.status;
        runtime.pool.replace({
          ...current,
          quota: mergeQuota(current.quota, status.quota),
          ...modelInventory(status.models),
          recentLatencyMs: status.latencyMs,
          status: nextStatus,
        });
      } catch (error) {
        runtime.log.warn({ accountId: account.id, err: error }, "quota refresh failed");
      }
    }
  };
  const interval = setInterval(() => {
    void tick();
  }, runtime.config.quota.refreshIntervalSeconds * 1000);
  void tick();
  return () => clearInterval(interval);
}

export function mergeQuota(previous: AccountQuota, incoming: AccountQuota): AccountQuota {
  return {
    fiveHour: mergeWindow(previous.fiveHour, incoming.fiveHour),
    weekly: mergeWindow(previous.weekly, incoming.weekly),
    monthly: mergeWindow(previous.monthly, incoming.monthly),
  };
}

function mergeWindow(previous?: QuotaWindow, incoming?: QuotaWindow): QuotaWindow | undefined {
  if (!incoming || incoming.confidence === "unknown") return previous ?? incoming;
  return incoming;
}
