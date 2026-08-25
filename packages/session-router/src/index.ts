import type { Account, NormalizedRequest, RoutingMode, Session } from "@command-go-pool/shared";
import { identifySession } from "@command-go-pool/shared";
import { scoreAccount } from "@command-go-pool/quota-engine";
import type { AccountPool } from "@command-go-pool/account-pool";
import type { SessionRepo } from "@command-go-pool/storage";

export interface RouteDecision {
  session: Session;
  account: Account;
  created: boolean;
  source: string;
}

export class SessionRouter {
  constructor(
    private readonly pool: AccountPool,
    private readonly sessions: SessionRepo,
    private readonly opts: { ttlMs: number; loadWeight: number; defaultMode: RoutingMode },
  ) {}

  identify(request: NormalizedRequest, headers: Record<string, string | undefined>) {
    return identifySession(request, headers);
  }

  route(
    request: NormalizedRequest,
    headers: Record<string, string | undefined>,
    exclude: Set<string> = new Set(),
  ): RouteDecision {
    const ident = this.identify(request, headers);
    const mode = (headers["x-command-go-routing"] as RoutingMode | undefined) ?? request.routingMode ?? this.opts.defaultMode;
    const existing = ident.sticky ? this.sessions.get(ident.id) : undefined;
    if (existing && ident.sticky && !this.expired(existing) && !exclude.has(existing.accountId)) {
      const bound = this.pool.get(existing.accountId);
      if (bound && this.pool.eligible(request.model).some((a) => a.id === bound.id)) {
        const session = { ...existing, lastRequestAt: new Date(), model: request.model };
        this.sessions.upsert(session);
        return { session, account: bound, created: false, source: ident.source };
      }
    }
    const account = this.select(request.model, mode, exclude);
    if (!account) throw new Error("No eligible Command Code accounts for this request");
    const now = new Date();
    const session: Session = existing
      ? {
          ...existing,
          accountId: account.id,
          model: request.model,
          lastRequestAt: now,
          migrations: existing.accountId === account.id ? existing.migrations : existing.migrations + 1,
          sticky: ident.sticky,
        }
      : {
          id: ident.id,
          accountId: account.id,
          model: request.model,
          createdAt: now,
          lastRequestAt: now,
          requests: 0,
          inputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          migrations: 0,
          sticky: ident.sticky,
        };
    const created = !existing;
    this.sessions.upsert(session);
    this.sessions.bind(session.id, account.id, created ? `new:${mode}` : "rebind");
    return { session, account, created, source: ident.source };
  }

  select(model: string, mode: RoutingMode, exclude: Set<string>): Account | undefined {
    const eligible = this.pool.eligible(model).filter((a) => !exclude.has(a.id));
    if (eligible.length === 0) return undefined;
    if (mode === "round-robin") return this.pool.nextRoundRobin(model);
    if (mode === "balanced") {
      return [...eligible].sort((a, b) => a.activeSessionCount - b.activeSessionCount || scoreAccount(b, { load: this.opts.loadWeight }) - scoreAccount(a, { load: this.opts.loadWeight }))[0];
    }
    if (mode === "most-available") {
      return [...eligible].sort((a, b) => scoreAccount(b, { load: 0 }) - scoreAccount(a, { load: 0 }))[0];
    }
    return [...eligible].sort((a, b) => scoreAccount(b, { load: this.opts.loadWeight }) - scoreAccount(a, { load: this.opts.loadWeight }))[0];
  }

  expireOld(): void {
    /* bindings remain; listActive filters by TTL */
  }

  private expired(session: Session): boolean {
    return Date.now() - session.lastRequestAt.getTime() > this.opts.ttlMs;
  }
}
