import { describe, expect, it } from "vitest";
import { quotaScore, scoreAccount, aggregatePool, subsidyMultiplier } from "@command-go-pool/quota-engine";
import type { Account } from "@command-go-pool/shared";
import { classifyUpstreamError, identifySession, parseResetTime } from "@command-go-pool/shared";

function account(partial: Partial<Account> & Pick<Account, "id">): Account {
  return {
    label: partial.id,
    enabled: true,
    credentialRef: "sec",
    status: "available",
    healthScore: 1,
    activeSessionCount: 0,
    quota: {},
    ...partial,
  };
}

describe("quota score", () => {
  it("uses the minimum remaining window", () => {
    expect(
      quotaScore({
        fiveHour: { remainingPercent: 10, source: "upstream", confidence: "exact" },
        weekly: { remainingPercent: 80, source: "upstream", confidence: "exact" },
        monthly: { remainingPercent: 90, source: "upstream", confidence: "exact" },
      }),
    ).toBeCloseTo(0.1);
  });

  it("does not treat unknown as zero", () => {
    expect(quotaScore({ fiveHour: { source: "unknown", confidence: "unknown" } })).toBe(0.5);
  });

  it("penalizes load", () => {
    const a = account({
      id: "a",
      activeSessionCount: 5,
      quota: { monthly: { remainingPercent: 100, source: "upstream", confidence: "exact" } },
    });
    const b = account({
      id: "b",
      activeSessionCount: 0,
      quota: { monthly: { remainingPercent: 100, source: "upstream", confidence: "exact" } },
    });
    expect(scoreAccount(b)).toBeGreaterThan(scoreAccount(a));
  });
});

describe("pool aggregation", () => {
  it("does not mix unknown percentages", () => {
    const pool = aggregatePool([
      account({
        id: "a",
        quota: { fiveHour: { remainingPercent: 50, source: "upstream", confidence: "exact" } },
      }),
      account({
        id: "b",
        quota: { fiveHour: { source: "unknown", confidence: "unknown" } },
      }),
    ]);
    expect(pool.fiveHour?.confidence).toBe("exact");
    expect(pool.fiveHour?.remainingPercent).toBe(50);
  });

  it("marks mixed estimates", () => {
    const pool = aggregatePool([
      account({
        id: "a",
        quota: { monthly: { remainingPercent: 50, source: "local-estimate", confidence: "estimated" } },
      }),
      account({
        id: "b",
        quota: { monthly: { remainingPercent: 50, source: "local-estimate", confidence: "estimated" } },
      }),
    ]);
    expect(pool.monthly?.confidence).toBe("estimated");
  });

  it("keeps monthly remaining credits when the percent is unknown", () => {
    const pool = aggregatePool([
      account({
        id: "a",
        quota: { monthly: { remaining: 63.5166642281, source: "upstream", confidence: "exact" } },
      }),
    ]);
    expect(pool.monthly?.confidence).toBe("exact");
    expect(pool.monthly?.remaining).toBeCloseTo(63.5166642281);
    expect(pool.monthly?.remainingPercent).toBeUndefined();
  });
});

describe("subsidy", () => {
  it("computes multiplier only with paid cost", () => {
    expect(subsidyMultiplier(10, 74.6)).toBeCloseTo(7.46, 2);
    expect(subsidyMultiplier(0, 10)).toBeUndefined();
  });
});

describe("errors", () => {
  it("classifies quota with reset", () => {
    const err = classifyUpstreamError({
      status: 400,
      bodyText: "You've reached your 5-hour usage limit for your plan. Your limit resets at 3:00 PM.",
    });
    expect(err.code).toBe("quota_exhausted");
    expect(err.failover).toBe(true);
    expect(err.window).toBe("fiveHour");
  });

  it("does not failover invalid requests", () => {
    const err = classifyUpstreamError({ status: 400, bodyText: "Invalid prompt: The messages do not match" });
    expect(err.code).toBe("invalid_request");
    expect(err.failover).toBe(false);
  });

  it("parses relative reset", () => {
    const at = parseResetTime("resets in 43m", new Date("2026-01-01T00:00:00Z"));
    expect(at?.getTime()).toBe(Date.parse("2026-01-01T00:43:00Z"));
  });
});

describe("session identity", () => {
  it("prefers explicit header", () => {
    const id = identifySession(
      { model: "m", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }], stream: true },
      { "x-command-go-session": "ses_1" },
    );
    expect(id.id).toBe("ses_1");
    expect(id.source).toBe("header");
  });

  it("uses metadata then prompt_cache_key", () => {
    const fromMeta = identifySession(
      {
        model: "m",
        messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        stream: true,
        metadata: { session_id: "meta_ses" },
      },
      {},
    );
    expect(fromMeta.source).toBe("metadata");
    expect(fromMeta.id).toBe("meta_ses");
    const fromCache = identifySession(
      {
        model: "m",
        messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        stream: true,
        promptCacheKey: "cache-1",
      },
      {},
    );
    expect(fromCache.source).toBe("prompt_cache_key");
  });

  it("fingerprints stable early content", () => {
    const a = identifySession(
      { model: "m", messages: [{ role: "user", content: [{ type: "text", text: "hello world" }] }], stream: true },
      {},
    );
    const b = identifySession(
      {
        model: "m",
        messages: [
          { role: "user", content: [{ type: "text", text: "hello world" }] },
          { role: "assistant", content: [{ type: "text", text: "later extra" }] },
        ],
        stream: true,
      },
      {},
    );
    expect(a.id).toBe(b.id);
  });
});
