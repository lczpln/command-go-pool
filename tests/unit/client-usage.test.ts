import { describe, expect, it } from "vitest";
import {
  clientUsageHeaders,
  claudeOauthUsage,
  openCodeUsage,
  usedRatio,
} from "@command-go-pool/quota-engine";
import { isAnthropicQuotaProbe, anthropicMessageSchema } from "@command-go-pool/protocol-anthropic";
import type { QuotaWindow } from "@command-go-pool/shared";

const fiveHour: QuotaWindow = {
  usedPercent: 25,
  remainingPercent: 75,
  resetAt: new Date("2026-09-01T12:00:00.000Z"),
  source: "upstream",
  confidence: "exact",
};

const weekly: QuotaWindow = {
  usedPercent: 40,
  remainingPercent: 60,
  resetAt: new Date("2026-09-07T12:00:00.000Z"),
  source: "upstream",
  confidence: "exact",
};

const monthly: QuotaWindow = {
  used: 1,
  remaining: 9,
  total: 10,
  usedPercent: 10,
  remainingPercent: 90,
  source: "upstream",
  confidence: "exact",
};

describe("usedRatio", () => {
  it("returns undefined for unknown windows", () => {
    expect(usedRatio({ source: "unknown", confidence: "unknown" })).toBeUndefined();
    expect(usedRatio(undefined)).toBeUndefined();
  });

  it("prefers usedPercent", () => {
    expect(usedRatio(fiveHour)).toBeCloseTo(0.25);
  });
});

describe("client usage payloads", () => {
  it("omits invented percents when quota is unknown", () => {
    const quota = {
      fiveHour: { source: "unknown", confidence: "unknown" } satisfies QuotaWindow,
      weekly: { source: "unknown", confidence: "unknown" } satisfies QuotaWindow,
    };
    expect(clientUsageHeaders(quota)).toEqual({});
    expect(claudeOauthUsage(quota).five_hour).toBeNull();
    expect(openCodeUsage(quota).usage.rolling).toEqual({ status: "unavailable" });
  });

  it("maps pool windows into Claude Code oauth usage", () => {
    const body = claudeOauthUsage({ fiveHour, weekly, monthly });
    expect(body.five_hour).toEqual({ utilization: 25, resets_at: "2026-09-01T12:00:00.000Z" });
    expect(body.seven_day).toEqual({ utilization: 40, resets_at: "2026-09-07T12:00:00.000Z" });
    expect(body.extra_usage).toMatchObject({ is_enabled: true, monthly_limit: 10, used_credits: 1, utilization: 10 });
    expect(body.limits.map((row) => row.kind)).toEqual(["session", "weekly_all"]);
  });

  it("maps pool windows into OpenCode Go usage", () => {
    expect(openCodeUsage({ fiveHour, weekly, monthly }).usage).toEqual({
      rolling: { status: "ok", percent: 25, resetsAt: "2026-09-01T12:00:00.000Z" },
      weekly: { status: "ok", percent: 40, resetsAt: "2026-09-07T12:00:00.000Z" },
      monthly: { status: "ok", percent: 10, resetsAt: null },
    });
  });

  it("emits Anthropic unified rate-limit headers as 0–1 utilization", () => {
    const headers = clientUsageHeaders({ fiveHour, weekly }, Date.parse("2026-08-25T00:00:00.000Z"));
    expect(headers["anthropic-ratelimit-unified-5h-utilization"]).toBe("0.25");
    expect(headers["anthropic-ratelimit-unified-7d-utilization"]).toBe("0.4");
    expect(headers["anthropic-ratelimit-unified-status"]).toBe("allowed");
    expect(headers["anthropic-ratelimit-unified-representative-claim"]).toBe("seven_day");
    expect(headers["x-ratelimit-remaining-requests"]).toBe("75");
  });
});

describe("isAnthropicQuotaProbe", () => {
  it("matches Claude Code's lightweight quota ping", () => {
    const parsed = anthropicMessageSchema.parse({
      model: "deepseek/deepseek-v4-flash",
      max_tokens: 1,
      messages: [{ role: "user", content: "quota" }],
    });
    expect(isAnthropicQuotaProbe(parsed)).toBe(true);
  });

  it("does not treat a real question as a probe", () => {
    const parsed = anthropicMessageSchema.parse({
      model: "deepseek/deepseek-v4-flash",
      max_tokens: 32,
      messages: [{ role: "user", content: "quota" }],
    });
    expect(isAnthropicQuotaProbe(parsed)).toBe(false);
  });
});
