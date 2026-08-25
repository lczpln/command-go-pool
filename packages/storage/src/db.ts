import Database from "better-sqlite3";
import { chmodSync } from "node:fs";
import { ensureHome, paths } from "./paths.js";

const MIGRATIONS: { name: string; sql?: string; run?: (db: Database.Database) => void }[] = [
  {
    name: "001_init",
    sql: `
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        credential_ref TEXT NOT NULL,
        status TEXT NOT NULL,
        last_success_at INTEGER,
        last_failure_at INTEGER,
        cooldown_until INTEGER,
        cooldown_reason TEXT,
        health_score REAL NOT NULL DEFAULT 1,
        monthly_subscription_cost REAL,
        models_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS quota_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id TEXT NOT NULL,
        window TEXT NOT NULL,
        used REAL,
        remaining REAL,
        total REAL,
        used_percent REAL,
        remaining_percent REAL,
        reset_at INTEGER,
        source TEXT NOT NULL,
        confidence TEXT NOT NULL,
        captured_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        model TEXT NOT NULL,
        label TEXT,
        created_at INTEGER NOT NULL,
        last_request_at INTEGER NOT NULL,
        requests INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        reasoning_tokens INTEGER NOT NULL DEFAULT 0,
        estimated_cost REAL,
        cost_estimated INTEGER NOT NULL DEFAULT 1,
        migrations INTEGER NOT NULL DEFAULT 0,
        sticky INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS session_account_bindings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        reason TEXT,
        at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS usage_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id TEXT,
        session_id TEXT,
        model TEXT,
        requests INTEGER NOT NULL DEFAULT 1,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        reasoning_tokens INTEGER NOT NULL DEFAULT 0,
        latency_ms INTEGER,
        ttft_ms INTEGER,
        error TEXT,
        estimated_cost REAL,
        at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pool_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        level TEXT NOT NULL,
        category TEXT NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_quota_account ON quota_snapshots(account_id, captured_at);
      CREATE INDEX IF NOT EXISTS idx_usage_at ON usage_events(at);
      CREATE INDEX IF NOT EXISTS idx_events_at ON pool_events(at);
      CREATE INDEX IF NOT EXISTS idx_sessions_last ON sessions(last_request_at);
    `,
  },
  {
    name: "002_rename_proxy_events",
    run(db) {
      const legacy = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='proxy_events'").get();
      const current = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='pool_events'").get();
      if (legacy && !current) db.exec("ALTER TABLE proxy_events RENAME TO pool_events");
    },
  },
];

export function openDatabase(home?: string): Database.Database {
  const dir = ensureHome(home);
  const dbPath = paths(dir).db;
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    applied_at INTEGER NOT NULL
  )`);
  const applied = new Set(
    db.prepare("SELECT name FROM schema_migrations").all().map((r) => (r as { name: string }).name),
  );
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) continue;
    if (migration.run) migration.run(db);
    else if (migration.sql) db.exec(migration.sql);
    db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(migration.name, Date.now());
  }
  try {
    chmodSync(dbPath, 0o600);
  } catch {
    /* ignore */
  }
  return db;
}
