import { createLogger, EventBus } from "@command-go-proxy/observability";
import { AccountPool } from "@command-go-proxy/account-pool";
import { SessionRouter } from "@command-go-proxy/session-router";
import { HttpAlphaTransport, MockTransport } from "@command-go-proxy/transport-commandcode";
import { AccountRepo, EventRepo, SessionRepo, UsageRepo, openDatabase, SecretStore, loadConfig } from "@command-go-proxy/storage";
import type { AppConfig, CommandCodeTransport } from "@command-go-proxy/shared";
import { buildApp } from "./app.js";
import { startHealthMonitor } from "./health.js";
import type { Runtime } from "./runtime.js";

export interface BootOptions {
  config?: AppConfig;
  transport?: CommandCodeTransport;
  home?: string;
}

export async function boot(options: BootOptions = {}) {
  const config = options.config ?? loadConfig(options.home);
  const log = createLogger();
  const db = openDatabase(options.home);
  const secrets = SecretStore.open(options.home);
  const pool = new AccountPool(new AccountRepo(db), secrets);
  const sessions = new SessionRepo(db);
  const usage = new UsageRepo(db);
  const events = new EventRepo(db);
  const router = new SessionRouter(pool, sessions, {
    ttlMs: config.routing.sessionTtlHours * 3600_000,
    loadWeight: config.routing.loadWeight,
    defaultMode: config.routing.mode,
  });
  const transport =
    options.transport ??
    (process.env.COMMAND_GO_PROXY_MOCK === "1"
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
  };
  const app = await buildApp(runtime);
  let stopHealth: (() => void) | undefined;
  return {
    runtime,
    app,
    async listen() {
      await app.listen({ host: config.server.host, port: config.server.port });
      stopHealth = startHealthMonitor(runtime);
    },
    async close() {
      stopHealth?.();
      await app.close();
      db.close();
    },
  };
}

export type { Runtime } from "./runtime.js";
export { overview } from "./runtime.js";
export { mergeQuota } from "./health.js";
export { publicConfig } from "./app.js";
