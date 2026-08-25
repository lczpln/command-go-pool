import { EventBus } from "@command-go-pool/observability";
import type { Logger } from "pino";
import type {
  Account,
  AppConfig,
  CommandCodeTransport,
  NormalizedChunk,
  NormalizedRequest,
  PoolEvent,
  Session,
  TokenUsage,
} from "@command-go-pool/shared";
import { isLoopbackHost } from "@command-go-pool/shared";
import type { AccountPool } from "@command-go-pool/account-pool";
import type { SessionRouter } from "@command-go-pool/session-router";
import type { EventRepo, SessionRepo, UsageStore } from "@command-go-pool/storage";
import { aggregatePool } from "@command-go-pool/quota-engine";

export interface Runtime {
  config: AppConfig;
  log: Logger;
  pool: AccountPool;
  router: SessionRouter;
  transport: CommandCodeTransport;
  sessions: Pick<SessionRepo, "get" | "upsert" | "bind" | "listActive" | "bindings">;
  usage: UsageStore;
  events: Pick<EventRepo, "append" | "list">;
  bus: EventBus;
  startedAt: number;
  inflightGenerates: number;
  healthAbort?: AbortController;
}

export function emit(runtime: Runtime, partial: Omit<PoolEvent, "id" | "at">): PoolEvent {
  const stored = runtime.events.append({ ...partial, at: new Date() });
  runtime.bus.emitEvent(stored);
  runtime.log.info({ event: stored.type, ...stored.payload });
  return stored;
}

export function executeRequest(
  runtime: Runtime,
  request: NormalizedRequest,
  headers: Record<string, string | undefined>,
  signal?: AbortSignal,
): { stream: AsyncIterable<NormalizedChunk>; session: Session; account: Account } {
  const exclude = new Set<string>();
  const first = runtime.router.route(request, headers, exclude);
  if (first.created) {
    runtime.pool.bumpSessions(first.account.id, 1);
    emit(runtime, {
      level: "info",
      category: "routing",
      type: "session.started",
      payload: { sessionId: first.session.id, accountId: first.account.id, model: request.model },
    });
  }
  const stream = pump(runtime, request, headers, signal, first.session, first.account, exclude);
  return { stream, session: first.session, account: first.account };
}

async function* pump(
  runtime: Runtime,
  request: NormalizedRequest,
  headers: Record<string, string | undefined>,
  signal: AbortSignal | undefined,
  initialSession: Session,
  initialAccount: Account,
  exclude: Set<string>,
): AsyncIterable<NormalizedChunk> {
  let session = initialSession;
  let account = initialAccount;
  const max = runtime.config.routing.maxFailoversPerRequest;
  for (let attempt = 0; attempt <= max; attempt++) {
    if (attempt > 0) {
      const decision = runtime.router.route(request, headers, exclude);
      session = decision.session;
      account = decision.account;
    }
    const cred = runtime.pool.credential(account.id);
    if (!cred) {
      exclude.add(account.id);
      continue;
    }
    const started = Date.now();
    let ttft: number | undefined;
    let usage: TokenUsage | undefined;
    let errorChunk: Extract<NormalizedChunk, { type: "error" }> | undefined;
    beginGenerate(runtime);
    try {
      for await (const chunk of runtime.transport.generate(cred, request, signal)) {
        if (chunk.type === "error") {
          errorChunk = chunk;
          break;
        }
        if (!ttft && (chunk.type === "text-delta" || chunk.type === "reasoning-delta" || chunk.type === "tool-call-delta")) {
          ttft = Date.now() - started;
        }
        if (chunk.type === "usage" || chunk.type === "finish") usage = chunk.usage ?? usage;
        yield chunk;
        if (chunk.type === "finish") {
          finishSuccess(runtime, account, session, request, usage, Date.now() - started, ttft);
          return;
        }
      }
    } catch (error) {
      errorChunk = {
        type: "error",
        error: {
          code: signal?.aborted ? "client_cancelled" : "network_error",
          message: error instanceof Error ? error.message : "Network error",
          retryable: !signal?.aborted,
          failover: !signal?.aborted,
        },
      };
    } finally {
      endGenerate(runtime);
    }
    if (!errorChunk) return;
    const err = errorChunk.error;
    runtime.pool.markFailure(account.id, err);
    emit(runtime, {
      level: err.code === "auth_failed" ? "error" : "warning",
      category: err.code === "auth_failed" ? "authentication" : err.failover ? "quota" : "system",
      type: err.code === "quota_exhausted" ? "account.cooldown" : "pool.error",
      payload: { accountId: account.id, code: err.code, message: err.message, sessionId: session.id },
    });
    runtime.usage.record({
      accountId: account.id,
      sessionId: session.id,
      model: request.model,
      error: err.code,
      latencyMs: Date.now() - started,
    });
    if (!err.failover || attempt >= max) {
      yield errorChunk;
      return;
    }
    exclude.add(account.id);
    const next = runtime.router.select(request.model, runtime.config.routing.mode, exclude);
    if (!next) {
      yield errorChunk;
      return;
    }
    emit(runtime, {
      level: "warning",
      category: "routing",
      type: "session.migrated",
      payload: { sessionId: session.id, from: account.id, to: next.id, reason: err.code },
    });
  }
}

export function beginGenerate(runtime: Runtime): void {
  runtime.inflightGenerates += 1;
  runtime.healthAbort?.abort();
}

export function endGenerate(runtime: Runtime): void {
  runtime.inflightGenerates = Math.max(0, runtime.inflightGenerates - 1);
}

function finishSuccess(
  runtime: Runtime,
  account: Account,
  session: Session,
  request: NormalizedRequest,
  usage: TokenUsage | undefined,
  latencyMs: number,
  ttft?: number,
) {
  runtime.pool.markSuccess(account.id);
  runtime.sessions.upsert({
    ...session,
    requests: session.requests + 1,
    lastRequestAt: new Date(),
    inputTokens: session.inputTokens + (usage?.inputTokens ?? 0),
    cacheReadTokens: session.cacheReadTokens + (usage?.cacheReadTokens ?? 0),
    cacheWriteTokens: session.cacheWriteTokens + (usage?.cacheWriteTokens ?? 0),
    outputTokens: session.outputTokens + (usage?.outputTokens ?? 0),
    reasoningTokens: session.reasoningTokens + (usage?.reasoningTokens ?? 0),
    estimatedCost: (session.estimatedCost ?? 0) + (usage?.estimatedCost ?? 0),
  });
  runtime.usage.record({
    accountId: account.id,
    sessionId: session.id,
    model: request.model,
    inputTokens: usage?.inputTokens,
    cacheReadTokens: usage?.cacheReadTokens,
    cacheWriteTokens: usage?.cacheWriteTokens,
    outputTokens: usage?.outputTokens,
    reasoningTokens: usage?.reasoningTokens,
    estimatedCost: usage?.estimatedCost,
    latencyMs,
    ttftMs: ttft,
  });
  emit(runtime, {
    level: "info",
    category: "system",
    type: "usage.updated",
    payload: { accountId: account.id, sessionId: session.id },
  });
}

export function overview(runtime: Runtime) {
  const accounts = runtime.pool.list();
  const ttl = runtime.config.routing.sessionTtlHours * 3600_000;
  const sessions = runtime.sessions.listActive(ttl);
  return {
    name: "Command Go Pool",
    status: "running",
    bind: {
      host: runtime.config.server.host,
      port: runtime.config.server.port,
      loopback: isLoopbackHost(runtime.config.server.host),
    },
    accounts: accounts.length,
    available: accounts.filter((a) => a.enabled && (a.status === "available" || a.status === "active")).length,
    cooldown: accounts.filter((a) => a.status === "cooldown" || a.status === "quota_exhausted").length,
    sessions: sessions.length,
    pool: aggregatePool(accounts),
    paid: accounts.reduce((s, a) => s + (a.monthlySubscriptionCost ?? 0), 0),
    uptimeMs: Date.now() - runtime.startedAt,
  };
}
