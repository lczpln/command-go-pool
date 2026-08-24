import type Database from "better-sqlite3";
import type { Account, AccountQuota, AccountStatus, ProxyEvent, QuotaWindow, QuotaWindowName, Session } from "@command-go-proxy/shared";

function dt(n?: number | null): Date | undefined {
  return n ? new Date(n) : undefined;
}

function n(d?: Date): number | null {
  return d ? d.getTime() : null;
}

export class AccountRepo {
  constructor(private readonly db: Database.Database) {}

  list(): Account[] {
    const rows = this.db.prepare("SELECT * FROM accounts ORDER BY created_at").all() as Record<string, unknown>[];
    return rows.map((row) => this.hydrate(row));
  }

  get(id: string): Account | undefined {
    const row = this.db.prepare("SELECT * FROM accounts WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? this.hydrate(row) : undefined;
  }

  upsert(account: Account): void {
    this.db
      .prepare(
        `INSERT INTO accounts (
          id, label, enabled, credential_ref, status, last_success_at, last_failure_at,
          cooldown_until, cooldown_reason, health_score, monthly_subscription_cost, models_json, created_at, updated_at
        ) VALUES (@id,@label,@enabled,@credential_ref,@status,@last_success_at,@last_failure_at,
          @cooldown_until,@cooldown_reason,@health_score,@monthly_subscription_cost,@models_json,@created_at,@updated_at)
        ON CONFLICT(id) DO UPDATE SET
          label=excluded.label, enabled=excluded.enabled, credential_ref=excluded.credential_ref, status=excluded.status,
          last_success_at=excluded.last_success_at, last_failure_at=excluded.last_failure_at,
          cooldown_until=excluded.cooldown_until, cooldown_reason=excluded.cooldown_reason,
          health_score=excluded.health_score, monthly_subscription_cost=excluded.monthly_subscription_cost,
          models_json=excluded.models_json, updated_at=excluded.updated_at`,
      )
      .run({
        id: account.id,
        label: account.label,
        enabled: account.enabled ? 1 : 0,
        credential_ref: account.credentialRef,
        status: account.status,
        last_success_at: n(account.lastSuccessAt),
        last_failure_at: n(account.lastFailureAt),
        cooldown_until: n(account.cooldownUntil),
        cooldown_reason: account.cooldownReason ?? null,
        health_score: account.healthScore,
        monthly_subscription_cost: account.monthlySubscriptionCost ?? null,
        models_json: account.models ? JSON.stringify(account.models) : null,
        created_at: Date.now(),
        updated_at: Date.now(),
      });
    this.saveQuota(account.id, account.quota);
  }

  remove(id: string): void {
    this.db.prepare("DELETE FROM accounts WHERE id = ?").run(id);
    this.db.prepare("DELETE FROM quota_snapshots WHERE account_id = ?").run(id);
  }

  saveQuota(accountId: string, quota: AccountQuota): void {
    const now = Date.now();
    const insert = this.db.prepare(
      `INSERT INTO quota_snapshots (account_id, window, used, remaining, total, used_percent, remaining_percent, reset_at, source, confidence, captured_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const write = (name: QuotaWindowName, window?: QuotaWindow) => {
      if (!window) return;
      insert.run(
        accountId,
        name,
        window.used ?? null,
        window.remaining ?? null,
        window.total ?? null,
        window.usedPercent ?? null,
        window.remainingPercent ?? null,
        n(window.resetAt),
        window.source,
        window.confidence,
        now,
      );
    };
    write("fiveHour", quota.fiveHour);
    write("weekly", quota.weekly);
    write("monthly", quota.monthly);
  }

  latestQuota(accountId: string): AccountQuota {
    const rows = this.db
      .prepare(
        `SELECT * FROM quota_snapshots WHERE account_id = ? AND id IN (
          SELECT MAX(id) FROM quota_snapshots WHERE account_id = ? GROUP BY window
        )`,
      )
      .all(accountId, accountId) as Record<string, unknown>[];
    const quota: AccountQuota = {};
    for (const row of rows) {
      const window: QuotaWindow = {
        used: num(row.used),
        remaining: num(row.remaining),
        total: num(row.total),
        usedPercent: num(row.used_percent),
        remainingPercent: num(row.remaining_percent),
        resetAt: dt(num(row.reset_at)),
        source: row.source as QuotaWindow["source"],
        confidence: row.confidence as QuotaWindow["confidence"],
      };
      const name = row.window as QuotaWindowName;
      quota[name] = window;
    }
    return quota;
  }

  private hydrate(row: Record<string, unknown>): Account {
    const id = String(row.id);
    return {
      id,
      label: String(row.label),
      enabled: Boolean(row.enabled),
      credentialRef: String(row.credential_ref),
      status: row.status as AccountStatus,
      lastSuccessAt: dt(num(row.last_success_at)),
      lastFailureAt: dt(num(row.last_failure_at)),
      cooldownUntil: dt(num(row.cooldown_until)),
      cooldownReason: row.cooldown_reason ? String(row.cooldown_reason) : undefined,
      healthScore: Number(row.health_score ?? 1),
      activeSessionCount: 0,
      monthlySubscriptionCost: num(row.monthly_subscription_cost),
      models: row.models_json ? (JSON.parse(String(row.models_json)) as string[]) : undefined,
      quota: this.latestQuota(id),
    };
  }
}

export class SessionRepo {
  constructor(private readonly db: Database.Database) {}

  get(id: string): Session | undefined {
    const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? this.hydrate(row) : undefined;
  }

  listActive(ttlMs: number): Session[] {
    const cutoff = Date.now() - ttlMs;
    return (this.db.prepare("SELECT * FROM sessions WHERE last_request_at >= ? ORDER BY last_request_at DESC").all(cutoff) as Record<string, unknown>[]).map(
      (r) => this.hydrate(r),
    );
  }

  upsert(session: Session): void {
    this.db
      .prepare(
        `INSERT INTO sessions (
          id, account_id, model, label, created_at, last_request_at, requests, input_tokens, cache_read_tokens,
          cache_write_tokens, output_tokens, reasoning_tokens, estimated_cost, cost_estimated, migrations, sticky
        ) VALUES (@id,@account_id,@model,@label,@created_at,@last_request_at,@requests,@input_tokens,@cache_read_tokens,
          @cache_write_tokens,@output_tokens,@reasoning_tokens,@estimated_cost,@cost_estimated,@migrations,@sticky)
        ON CONFLICT(id) DO UPDATE SET
          account_id=excluded.account_id, model=excluded.model, label=excluded.label, last_request_at=excluded.last_request_at,
          requests=excluded.requests, input_tokens=excluded.input_tokens, cache_read_tokens=excluded.cache_read_tokens,
          cache_write_tokens=excluded.cache_write_tokens, output_tokens=excluded.output_tokens, reasoning_tokens=excluded.reasoning_tokens,
          estimated_cost=excluded.estimated_cost, migrations=excluded.migrations, sticky=excluded.sticky`,
      )
      .run({
        id: session.id,
        account_id: session.accountId,
        model: session.model,
        label: session.label ?? null,
        created_at: session.createdAt.getTime(),
        last_request_at: session.lastRequestAt.getTime(),
        requests: session.requests,
        input_tokens: session.inputTokens,
        cache_read_tokens: session.cacheReadTokens,
        cache_write_tokens: session.cacheWriteTokens,
        output_tokens: session.outputTokens,
        reasoning_tokens: session.reasoningTokens,
        estimated_cost: session.estimatedCost ?? null,
        cost_estimated: 1,
        migrations: session.migrations,
        sticky: session.sticky ? 1 : 0,
      });
  }

  bind(sessionId: string, accountId: string, reason: string): void {
    this.db.prepare("INSERT INTO session_account_bindings (session_id, account_id, reason, at) VALUES (?, ?, ?, ?)").run(
      sessionId,
      accountId,
      reason,
      Date.now(),
    );
  }

  bindings(sessionId: string): { accountId: string; reason: string | null; at: number }[] {
    return this.db
      .prepare("SELECT account_id as accountId, reason, at FROM session_account_bindings WHERE session_id = ? ORDER BY at")
      .all(sessionId) as { accountId: string; reason: string | null; at: number }[];
  }

  private hydrate(row: Record<string, unknown>): Session {
    return {
      id: String(row.id),
      accountId: String(row.account_id),
      model: String(row.model),
      label: row.label ? String(row.label) : undefined,
      createdAt: new Date(Number(row.created_at)),
      lastRequestAt: new Date(Number(row.last_request_at)),
      requests: Number(row.requests),
      inputTokens: Number(row.input_tokens),
      cacheReadTokens: Number(row.cache_read_tokens),
      cacheWriteTokens: Number(row.cache_write_tokens),
      outputTokens: Number(row.output_tokens),
      reasoningTokens: Number(row.reasoning_tokens),
      estimatedCost: num(row.estimated_cost),
      migrations: Number(row.migrations),
      sticky: Boolean(row.sticky),
    };
  }
}

export class UsageRepo {
  constructor(private readonly db: Database.Database) {}

  record(event: {
    accountId?: string;
    sessionId?: string;
    model?: string;
    inputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
    latencyMs?: number;
    ttftMs?: number;
    error?: string;
    estimatedCost?: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO usage_events (account_id, session_id, model, input_tokens, cache_read_tokens, cache_write_tokens,
          output_tokens, reasoning_tokens, latency_ms, ttft_ms, error, estimated_cost, at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.accountId ?? null,
        event.sessionId ?? null,
        event.model ?? null,
        event.inputTokens ?? 0,
        event.cacheReadTokens ?? 0,
        event.cacheWriteTokens ?? 0,
        event.outputTokens ?? 0,
        event.reasoningTokens ?? 0,
        event.latencyMs ?? null,
        event.ttftMs ?? null,
        event.error ?? null,
        event.estimatedCost ?? null,
        Date.now(),
      );
  }

  rollup(since: number, group?: "account" | "model" | "session"): Record<string, unknown>[] {
    const groupCol = group === "account" ? "account_id" : group === "model" ? "model" : group === "session" ? "session_id" : null;
    if (!groupCol) {
      return this.db
        .prepare(
          `SELECT COUNT(*) as requests, SUM(input_tokens) as inputTokens, SUM(cache_read_tokens) as cacheReadTokens,
            SUM(cache_write_tokens) as cacheWriteTokens, SUM(output_tokens) as outputTokens, SUM(reasoning_tokens) as reasoningTokens,
            SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) as errors, SUM(estimated_cost) as estimatedCost,
            AVG(latency_ms) as latencyAvg, AVG(ttft_ms) as ttftAvg
           FROM usage_events WHERE at >= ?`,
        )
        .all(since) as Record<string, unknown>[];
    }
    return this.db
      .prepare(
        `SELECT ${groupCol} as key, COUNT(*) as requests, SUM(input_tokens) as inputTokens, SUM(cache_read_tokens) as cacheReadTokens,
          SUM(output_tokens) as outputTokens, SUM(estimated_cost) as estimatedCost
         FROM usage_events WHERE at >= ? GROUP BY ${groupCol}`,
      )
      .all(since) as Record<string, unknown>[];
  }

  series(since: number, bucketMs: number): { t: number; requests: number; tokens: number; cost: number }[] {
    const rows = this.db
      .prepare("SELECT at, input_tokens, cache_read_tokens, output_tokens, estimated_cost FROM usage_events WHERE at >= ? ORDER BY at")
      .all(since) as { at: number; input_tokens: number; cache_read_tokens: number; output_tokens: number; estimated_cost: number | null }[];
    const buckets = new Map<number, { requests: number; tokens: number; cost: number }>();
    for (const row of rows) {
      const t = Math.floor(row.at / bucketMs) * bucketMs;
      const cur = buckets.get(t) ?? { requests: 0, tokens: 0, cost: 0 };
      cur.requests += 1;
      cur.tokens += (row.input_tokens ?? 0) + (row.output_tokens ?? 0);
      cur.cost += row.estimated_cost ?? 0;
      buckets.set(t, cur);
    }
    return [...buckets.entries()].map(([t, v]) => ({ t, ...v }));
  }
}

export class EventRepo {
  constructor(private readonly db: Database.Database) {}

  append(event: Omit<ProxyEvent, "id">): ProxyEvent {
    const info = this.db
      .prepare("INSERT INTO proxy_events (level, category, type, payload_json, at) VALUES (?, ?, ?, ?, ?)")
      .run(event.level, event.category, event.type, JSON.stringify(event.payload), event.at.getTime());
    return { ...event, id: Number(info.lastInsertRowid) };
  }

  list(limit = 200, category?: string): ProxyEvent[] {
    const rows = category
      ? (this.db.prepare("SELECT * FROM proxy_events WHERE category = ? ORDER BY id DESC LIMIT ?").all(category, limit) as Record<string, unknown>[])
      : (this.db.prepare("SELECT * FROM proxy_events ORDER BY id DESC LIMIT ?").all(limit) as Record<string, unknown>[]);
    return rows.map((row) => ({
      id: Number(row.id),
      at: new Date(Number(row.at)),
      level: row.level as ProxyEvent["level"],
      category: row.category as ProxyEvent["category"],
      type: String(row.type),
      payload: JSON.parse(String(row.payload_json)) as Record<string, unknown>,
    }));
  }
}

function num(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
