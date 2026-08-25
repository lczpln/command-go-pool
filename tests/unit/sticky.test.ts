import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AccountPool } from "@command-go-pool/account-pool";
import { SessionRouter } from "@command-go-pool/session-router";
import { AccountRepo, SessionRepo, SecretStore, openDatabase } from "@command-go-pool/storage";
import { failure } from "@command-go-pool/shared";

function harness() {
  const home = mkdtempSync(join(tmpdir(), "cgp-"));
  process.env.COMMAND_GO_POOL_HOME = home;
  process.env.COMMAND_GO_POOL_MASTER_KEY = "x".repeat(32);
  const db = openDatabase(home);
  const secrets = SecretStore.open(home);
  const pool = new AccountPool(new AccountRepo(db), secrets);
  const sessions = new SessionRepo(db);
  const router = new SessionRouter(pool, sessions, { ttlMs: 24 * 3600_000, loadWeight: 0.04, defaultMode: "sticky" });
  return { home, db, pool, router };
}

describe("sticky routing", () => {
  afterEach(() => {
    delete process.env.COMMAND_GO_POOL_HOME;
  });

  it("keeps a conversation on the same account", () => {
    const { pool, router } = harness();
    const a = pool.add({ label: "Go #01", apiKey: "user_a" });
    pool.add({ label: "Go #02", apiKey: "user_b" });
    pool.update(a.id, {
      quota: { fiveHour: { remainingPercent: 10, source: "upstream", confidence: "exact" } },
    });
    const req = {
      model: "deepseek/deepseek-v4-flash",
      messages: [{ role: "user" as const, content: [{ type: "text" as const, text: "build a parser" }] }],
      stream: true,
    };
    const first = router.route(req, { "x-command-go-session": "ses_sticky" });
    const second = router.route(req, { "x-command-go-session": "ses_sticky" });
    expect(second.account.id).toBe(first.account.id);
    expect(second.created).toBe(false);
  });

  it("new sessions prefer remaining quota", () => {
    const { pool, router } = harness();
    const low = pool.add({ label: "low", apiKey: "a" });
    const high = pool.add({ label: "high", apiKey: "b" });
    pool.update(low.id, { quota: { fiveHour: { remainingPercent: 5, source: "upstream", confidence: "exact" } } });
    pool.update(high.id, { quota: { fiveHour: { remainingPercent: 90, source: "upstream", confidence: "exact" } } });
    const decision = router.route(
      { model: "m", messages: [{ role: "user", content: [{ type: "text", text: "n1" }] }], stream: true },
      { "x-command-go-session": "ses_new" },
    );
    expect(decision.account.id).toBe(high.id);
  });

  it("expires inactive bindings", () => {
    const home = mkdtempSync(join(tmpdir(), "cgp-"));
    process.env.COMMAND_GO_POOL_HOME = home;
    process.env.COMMAND_GO_POOL_MASTER_KEY = "y".repeat(32);
    const db = openDatabase(home);
    const pool = new AccountPool(new AccountRepo(db), SecretStore.open(home));
    const sessions = new SessionRepo(db);
    const router = new SessionRouter(pool, sessions, { ttlMs: 10, loadWeight: 0, defaultMode: "sticky" });
    pool.add({ label: "a", apiKey: "a" });
    const req = { model: "m", messages: [{ role: "user" as const, content: [{ type: "text" as const, text: "z" }] }], stream: true };
    const first = router.route(req, { "x-command-go-session": "old" });
    sessions.upsert({ ...first.session, lastRequestAt: new Date(Date.now() - 1000) });
    const second = router.route(req, { "x-command-go-session": "old" });
    expect(second.created || second.session.lastRequestAt.getTime() >= first.session.lastRequestAt.getTime()).toBe(true);
  });
});

describe("session load", () => {
  it("marks accounts with sticky sessions as active without persisting", () => {
    const { pool } = harness();
    const acc = pool.add({ label: "Go #01", apiKey: "k" });
    pool.applySessionLoad(new Map([[acc.id, 2]]));
    expect(pool.get(acc.id)?.status).toBe("active");
    expect(pool.get(acc.id)?.activeSessionCount).toBe(2);
    pool.applySessionLoad(new Map(), [acc.id]);
    expect(pool.get(acc.id)?.status).toBe("active");
    expect(pool.get(acc.id)?.activeSessionCount).toBe(0);
    pool.applySessionLoad(new Map());
    expect(pool.get(acc.id)?.status).toBe("available");
  });
});

describe("state transitions", () => {
  it("cooldown then recover", () => {
    const { pool } = harness();
    const acc = pool.add({ label: "Go #03", apiKey: "k" });
    pool.markFailure(
      acc.id,
      failure("quota_exhausted", "5h exhausted", { cooldownUntil: new Date(Date.now() - 1000), window: "fiveHour" }),
    );
    expect(pool.get(acc.id)?.status).toBe("quota_exhausted");
    const recovered = pool.recoverExpired();
    expect(recovered[0]?.id).toBe(acc.id);
    expect(pool.get(acc.id)?.status).toBe("available");
  });
});
