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
import type { Runtime } from "./runtime.js";

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
  };
  const app = await buildApp(runtime);
  let stopHealth: (() => void) | undefined;
  return {
    runtime,
    app,
    poolApiKeyGenerated,
    async listen() {
      await app.listen({ host: config.server.host, port: config.server.port });
      stopHealth = startHealthMonitor(runtime);
    },
    async close() {
      stopHealth?.();
      await bridge.close();
      await app.close();
    },
  };
}

export type { Runtime } from "./runtime.js";
export { overview, beginGenerate, endGenerate } from "./runtime.js";
export { mergeQuota, createHealthTick } from "./health.js";
export { publicConfig } from "./app.js";
