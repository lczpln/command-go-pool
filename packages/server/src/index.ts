import { createLogger, EventBus } from "@command-go-pool/observability";
import { AccountPool } from "@command-go-pool/account-pool";
import { SessionRouter } from "@command-go-pool/session-router";
import { HttpAlphaTransport, MockTransport } from "@command-go-pool/transport-commandcode";
import {
  QueuedAccountRepo,
  QueuedEventRepo,
  QueuedSessionRepo,
  QueuedUsageRepo,
  SecretStore,
  loadConfig,
  openSqliteBridge,
  reviveAccount,
  type SessionBinding,
} from "@command-go-pool/storage";
import { type Account, type AppConfig, type CommandCodeTransport, type PoolEvent, type Session } from "@command-go-pool/shared";
import { buildApp } from "./app.js";
import { startHealthMonitor } from "./health.js";
import { syncSessionLoad, type Runtime } from "./runtime.js";

export interface BootOptions {
  config?: AppConfig;
  transport?: CommandCodeTransport;
  home?: string;
}

export async function boot(options: BootOptions = {}) {
  const loaded = loadConfig(options.home);
  const config = options.config ?? loaded;
  if (!config.server.apiKey?.trim() && loaded.server.apiKey?.trim()) {
    config.server.apiKey = loaded.server.apiKey.trim();
  }
  const poolApiKeyGenerated = false;
  const log = createLogger();
  const bridge = await openSqliteBridge(options.home);
  const secrets = SecretStore.open(options.home);
  const accountRows = ((await bridge.call("accounts.list")) as Account[]).map(reviveAccount);
  const sessions = new QueuedSessionRepo(bridge);
  const snapshot = (await bridge.call("sessions.snapshot", [config.routing.sessionTtlHours * 3600_000])) as {
    sessions: Session[];
    bindings: Record<string, SessionBinding[]>;
  };
  sessions.hydrate(snapshot);
  const usage = new QueuedUsageRepo(bridge);
  const events = new QueuedEventRepo(bridge);
  events.hydrate(((await bridge.call("events.list", [200])) as PoolEvent[]) ?? []);
  const pool = new AccountPool(new QueuedAccountRepo(bridge), secrets, accountRows);
  const router = new SessionRouter(pool, sessions, {
    ttlMs: config.routing.sessionTtlHours * 3600_000,
    loadWeight: config.routing.loadWeight,
    defaultMode: config.routing.mode,
  });
  const transport =
    options.transport ??
    (process.env.COMMAND_GO_POOL_MOCK === "1"
      ? new MockTransport()
      : new HttpAlphaTransport({
          apiBase: config.transport.apiBase,
          cliVersion: config.transport.cliVersion,
          timeoutMs: config.transport.timeoutMs,
          idleTimeoutMs: config.transport.idleTimeoutMs,
        }));
  const runtime: Runtime = {
    config,
    log,
    pool,
    router,
    transport,
    sessions,
    usage,
    events,
    bus: new EventBus(),
    startedAt: Date.now(),
    inflightGenerates: 0,
    inflightByAccount: new Map(),
    shutdown: new AbortController(),
  };
  syncSessionLoad(runtime);
  const app = await buildApp(runtime);
  let stopHealth: (() => void) | undefined;
  let closed = false;
  return {
    runtime,
    app,
    poolApiKeyGenerated,
    async listen() {
      await app.listen({ host: config.server.host, port: config.server.port });
      stopHealth = startHealthMonitor(runtime);
    },
    async close() {
      if (closed) return;
      closed = true;
      stopHealth?.();
      runtime.shutdown.abort();
      await raceTimeout(app.close(), 5_000);
      try {
        await runtime.transport.close?.();
      } catch {
        /* ignore */
      }
      await raceTimeout(bridge.close(), 5_000);
    },
  };
}

function raceTimeout(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    promise.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      },
    );
  });
}

export type { Runtime } from "./runtime.js";
export { overview, beginGenerate, endGenerate, syncSessionLoad } from "./runtime.js";
export { mergeQuota, createHealthTick } from "./health.js";
export { publicConfig } from "./app.js";
export {
  DASHBOARD_COOKIE,
  LoginLimiter,
  dashboardPassword,
  signDashboardCookie,
  verifyDashboardCookie,
} from "./dashboard-auth.js";
