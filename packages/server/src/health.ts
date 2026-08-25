import type { Runtime } from "./runtime.js";
import { emit } from "./runtime.js";
import { modelInventory, type AccountQuota, type QuotaWindow } from "@command-go-pool/shared";

export function createHealthTick(runtime: Runtime): () => Promise<void> {
  let tickRunning = false;
  return async () => {
    if (tickRunning) return;
    if (runtime.inflightGenerates > 0) return;
    tickRunning = true;
    const controller = new AbortController();
    runtime.healthAbort = controller;
    try {
      await runHealthTick(runtime, controller.signal);
    } finally {
      tickRunning = false;
      if (runtime.healthAbort === controller) runtime.healthAbort = undefined;
    }
  };
}

export function startHealthMonitor(runtime: Runtime): () => void {
  const tick = createHealthTick(runtime);
  const interval = setInterval(() => {
    void tick();
  }, runtime.config.quota.refreshIntervalSeconds * 1000);
  void tick();
  return () => {
    clearInterval(interval);
    runtime.healthAbort?.abort();
  };
}

async function runHealthTick(runtime: Runtime, signal: AbortSignal): Promise<void> {
  const recovered = runtime.pool.recoverExpired();
  for (const account of recovered) {
    if (signal.aborted) return;
    const cred = runtime.pool.credential(account.id);
    if (!cred) continue;
    try {
      const status = await runtime.transport.getAccountStatus(cred, signal);
      if (signal.aborted) return;
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
    } catch (error) {
      if (isAbortError(error) || signal.aborted) return;
      /* stay in cooldown until next tick */
    }
  }
  for (const account of runtime.pool.list()) {
    if (signal.aborted) return;
    if (!account.enabled || account.status === "disabled") continue;
    const cred = runtime.pool.credential(account.id);
    if (!cred) continue;
    try {
      const status = await runtime.transport.getAccountStatus(cred, signal);
      if (signal.aborted) return;
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
      if (isAbortError(error) || signal.aborted) return;
      runtime.log.warn({ accountId: account.id, err: error }, "quota refresh failed");
    }
  }
}

function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { name?: string }).name === "AbortError");
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
