import type { Account, AccountQuota, PoolEvent, Session } from "@command-go-pool/shared";
import type { SqliteBridge } from "./sqlite-bridge.js";
import type { UsageFilter, UsageGroup, UsageRecord, UsageStore } from "./repos.js";

export type SessionBinding = { accountId: string; reason: string | null; at: number };

export class QueuedAccountRepo {
  constructor(private readonly bridge: SqliteBridge) {}

  list(): Account[] {
    return [];
  }

  upsert(account: Account): void {
    this.bridge.enqueue("accounts.upsert", [account]);
  }

  remove(id: string): void {
    this.bridge.enqueue("accounts.remove", [id]);
  }
}

export class QueuedSessionRepo {
  private readonly sessions = new Map<string, Session>();
  private readonly bound = new Map<string, SessionBinding[]>();

  constructor(private readonly bridge: SqliteBridge) {}

  hydrate(snapshot: { sessions: Session[]; bindings: Record<string, SessionBinding[]> }): void {
    this.sessions.clear();
    this.bound.clear();
    for (const session of snapshot.sessions) this.sessions.set(session.id, reviveSession(session));
    for (const [id, rows] of Object.entries(snapshot.bindings)) this.bound.set(id, rows);
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  listActive(ttlMs: number): Session[] {
    const cutoff = Date.now() - ttlMs;
    return [...this.sessions.values()]
      .filter((session) => session.lastRequestAt.getTime() >= cutoff)
      .sort((a, b) => b.lastRequestAt.getTime() - a.lastRequestAt.getTime());
  }

  upsert(session: Session): void {
    this.sessions.set(session.id, session);
    this.bridge.enqueue("sessions.upsert", [session]);
  }

  bind(sessionId: string, accountId: string, reason: string): void {
    const row = { accountId, reason, at: Date.now() };
    const current = this.bound.get(sessionId) ?? [];
    current.push(row);
    this.bound.set(sessionId, current);
    this.bridge.enqueue("sessions.bind", [sessionId, accountId, reason]);
  }

  bindings(sessionId: string): SessionBinding[] {
    return this.bound.get(sessionId) ?? [];
  }
}

export class QueuedUsageRepo implements UsageStore {
  constructor(private readonly bridge: SqliteBridge) {}

  record(event: UsageRecord): void {
    this.bridge.enqueue("usage.record", [event]);
  }

  rollup(since: number, group?: UsageGroup, filter?: UsageFilter): Promise<Record<string, unknown>[]> {
    return this.bridge.call("usage.rollup", [since, group, filter]) as Promise<Record<string, unknown>[]>;
  }

  series(
    since: number,
    bucketMs: number,
    filter?: UsageFilter,
  ): Promise<{ t: number; requests: number; tokens: number; cost: number }[]> {
    return this.bridge.call("usage.series", [since, bucketMs, filter]) as Promise<
      { t: number; requests: number; tokens: number; cost: number }[]
    >;
  }
}

export class QueuedEventRepo {
  private events: PoolEvent[] = [];
  private nextId = 1;

  constructor(private readonly bridge: SqliteBridge) {}

  hydrate(rows: PoolEvent[]): void {
    this.events = rows.map(reviveEvent);
    this.nextId = this.events.reduce((max, event) => Math.max(max, event.id), 0) + 1;
  }

  append(event: Omit<PoolEvent, "id">): PoolEvent {
    const stored = { ...event, id: this.nextId++ };
    this.events.unshift(stored);
    if (this.events.length > 500) this.events.length = 500;
    this.bridge.enqueue("events.append", [event]);
    return stored;
  }

  list(limit = 200, category?: string): PoolEvent[] {
    const rows = category ? this.events.filter((event) => event.category === category) : this.events;
    return rows.slice(0, limit);
  }
}

function reviveSession(session: Session): Session {
  return {
    ...session,
    createdAt: new Date(session.createdAt),
    lastRequestAt: new Date(session.lastRequestAt),
  };
}

function reviveEvent(event: PoolEvent): PoolEvent {
  return { ...event, at: new Date(event.at) };
}

export function reviveAccount(account: Account): Account {
  return {
    ...account,
    lastSuccessAt: account.lastSuccessAt ? new Date(account.lastSuccessAt) : undefined,
    lastFailureAt: account.lastFailureAt ? new Date(account.lastFailureAt) : undefined,
    cooldownUntil: account.cooldownUntil ? new Date(account.cooldownUntil) : undefined,
    quota: reviveQuota(account.quota),
  };
}

function reviveQuota(quota: AccountQuota): AccountQuota {
  return {
    fiveHour: reviveWindow(quota.fiveHour),
    weekly: reviveWindow(quota.weekly),
    monthly: reviveWindow(quota.monthly),
  };
}

function reviveWindow(window: AccountQuota["fiveHour"]): AccountQuota["fiveHour"] {
  if (!window) return window;
  return { ...window, resetAt: window.resetAt ? new Date(window.resetAt) : undefined };
}
