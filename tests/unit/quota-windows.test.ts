import { describe, expect, it } from "vitest";
import { HttpAlphaTransport, parseCreditsPayload } from "@command-go-pool/transport-commandcode";
import { planById, remainingNormalized } from "@command-go-pool/quota-engine";
import { withServer } from "../helpers.js";
import { formatQuotaView } from "../../apps/dashboard/src/utils/quota.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const CREDITS_WITH_WINDOWS = {
  credits: { monthlyCredits: 7.2, purchasedCredits: 0 },
  windowLimits: {
    fiveHour: { cap: 3, used: 0.6, resetAt: "2026-08-24T22:00:00.000Z" },
    weekly: { cap: 6, used: 1.2, resetAt: "2026-08-31T12:00:00.000Z" },
  },
};

describe("parseCreditsPayload", () => {
  it("derives percents from Command Code windowLimits cap/used", () => {
    const quota = parseCreditsPayload(CREDITS_WITH_WINDOWS);
    expect(quota.fiveHour?.confidence).toBe("exact");
    expect(quota.fiveHour?.total).toBe(3);
    expect(quota.fiveHour?.used).toBe(0.6);
    expect(quota.fiveHour?.remaining).toBeCloseTo(2.4);
    expect(quota.fiveHour?.remainingPercent).toBeCloseTo(80);
    expect(quota.weekly?.remainingPercent).toBeCloseTo(80);
    expect(quota.monthly?.remaining).toBe(7.2);
    expect(quota.monthly?.confidence).toBe("exact");
  });
});

describe("remainingNormalized", () => {
  it("uses used and total when percents are omitted", () => {
    expect(remainingNormalized({ used: 0.6, total: 3, source: "upstream", confidence: "exact" })).toBeCloseTo(0.8);
  });
});

describe("planById", () => {
  it("does not match goat as go", () => {
    expect(planById("goat")?.id).toBe("goat");
    expect(planById("GOAT")?.id).toBe("goat");
    expect(planById("go")?.id).toBe("go");
  });
});

describe("formatQuotaView", () => {
  it("renders a bar from used and total without a percent field", () => {
    const view = formatQuotaView({ used: 0.6, total: 3, source: "upstream", confidence: "exact" });
    expect(view.tone).not.toBe("empty");
    expect(view.filled).toBeCloseTo(80);
    expect(view.text).toMatch(/80%/);
  });

  it("uses a calendar date for resets more than two days away", () => {
    const resetAt = new Date(Date.now() + 10 * 24 * 3600_000).toISOString();
    const view = formatQuotaView({
      remainingPercent: 91,
      usedPercent: 9,
      resetAt,
      source: "upstream",
      confidence: "exact",
    });
    expect(view.reset).toBe(new Date(resetAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }));
  });
});

describe("HttpAlphaTransport.listModels", () => {
  it("maps capabilities.reasoning from the Command Code catalog", async () => {
    const transport = new HttpAlphaTransport({
      apiBase: "https://api.commandcode.ai",
      cliVersion: "0.52.1",
      timeoutMs: 5_000,
      idleTimeoutMs: 1_000,
      fetchImpl: async (url) => {
        if (String(url).endsWith("/provider/v1/models")) {
          return jsonResponse({
            data: [
              {
                id: "deepseek/deepseek-v4-pro",
                name: "DeepSeek V4 Pro",
                capabilities: { reasoning: true, vision: false },
              },
            ],
          });
        }
        return jsonResponse({});
      },
    });
    const models = await transport.listModels({ accountId: "acc_1", apiKey: "user_test" });
    expect(models[0]).toMatchObject({ id: "deepseek/deepseek-v4-pro", reasoning: true, vision: false });
  });

  it("maps context_length from the Command Code catalog", async () => {
    const transport = new HttpAlphaTransport({
      apiBase: "https://api.commandcode.ai",
      cliVersion: "0.52.1",
      timeoutMs: 5_000,
      idleTimeoutMs: 1_000,
      fetchImpl: async (url) => {
        if (String(url).endsWith("/provider/v1/models")) {
          return jsonResponse({
            data: [
              {
                id: "anthropic/claude-sonnet-5",
                name: "Claude Sonnet 5",
                context_length: 1_000_000,
              },
            ],
          });
        }
        return jsonResponse({});
      },
    });
    const models = await transport.listModels({ accountId: "acc_1", apiKey: "user_test" });
    expect(models[0]).toMatchObject({
      id: "anthropic/claude-sonnet-5",
      contextWindow: 1_000_000,
      reasoning: true,
    });
    expect(models[0]?.vision).toBeUndefined();
  });

  it("maps OpenCode-style limit.context when context_length is absent", async () => {
    const transport = new HttpAlphaTransport({
      apiBase: "https://api.commandcode.ai",
      cliVersion: "0.52.1",
      timeoutMs: 5_000,
      idleTimeoutMs: 1_000,
      fetchImpl: async (url) => {
        if (String(url).endsWith("/provider/v1/models")) {
          return jsonResponse({
            data: [
              {
                id: "openai/gpt-5.4",
                name: "GPT-5.4",
                limit: { context: 1_100_000, output: 128_000 },
                capabilities: { reasoning: false },
              },
            ],
          });
        }
        return jsonResponse({});
      },
    });
    const models = await transport.listModels({ accountId: "acc_1", apiKey: "user_test" });
    expect(models[0]).toMatchObject({
      id: "openai/gpt-5.4",
      contextWindow: 1_100_000,
      outputLimit: 128_000,
      reasoning: false,
    });
  });
});

describe("HttpAlphaTransport.getAccountStatus", () => {
  it("maps billing credits and Go plan identity into displayable windows", async () => {
    const transport = new HttpAlphaTransport({
      apiBase: "https://api.commandcode.ai",
      cliVersion: "0.52.1",
      timeoutMs: 5_000,
      idleTimeoutMs: 1_000,
      fetchImpl: async (url) => {
        const path = String(url);
        if (path.endsWith("/alpha/whoami")) return jsonResponse({ email: "user@example.com" });
        if (path.endsWith("/alpha/billing/credits")) return jsonResponse(CREDITS_WITH_WINDOWS);
        if (path.endsWith("/alpha/billing/subscriptions")) {
          return jsonResponse({ success: true, data: { planId: "go", status: "active" } });
        }
        if (path.endsWith("/provider/v1/models")) return jsonResponse({ data: [{ id: "deepseek/deepseek-v4-flash" }] });
        return jsonResponse({ error: "missing" }, 404);
      },
    });
    const status = await transport.getAccountStatus({ accountId: "acc_1", apiKey: "user_test" });
    expect(status.authenticated).toBe(true);
    expect(status.quota.fiveHour?.remainingPercent).toBeCloseTo(80);
    expect(status.quota.weekly?.remainingPercent).toBeCloseTo(80);
    expect(status.quota.monthly?.remainingPercent).toBeCloseTo(72);
    expect(status.quota.monthly?.total).toBe(10);
  });

  it("infers GOAT monthly cap from 5h/weekly window totals when subscriptions omit planId", async () => {
    const transport = new HttpAlphaTransport({
      apiBase: "https://api.commandcode.ai",
      cliVersion: "0.52.1",
      timeoutMs: 5_000,
      idleTimeoutMs: 1_000,
      fetchImpl: async (url) => {
        const path = String(url);
        if (path.endsWith("/alpha/whoami")) return jsonResponse({ ok: true });
        if (path.endsWith("/alpha/billing/credits")) {
          return jsonResponse({
            credits: { monthlyCredits: 63.5166642281 },
            windowLimits: {
              fiveHour: { cap: 14, used: 0 },
              weekly: { cap: 35, used: 6.4833357719, resetAt: "2026-08-25T18:02:30.000Z" },
            },
          });
        }
        if (path.endsWith("/alpha/billing/subscriptions")) {
          return jsonResponse({ success: true, data: { currentPeriodEnd: "2026-09-18T00:00:00.000Z" } });
        }
        if (path.endsWith("/provider/v1/models")) return jsonResponse({ data: [] });
        return jsonResponse({ error: "missing" }, 404);
      },
    });
    const status = await transport.getAccountStatus({ accountId: "acc_goat", apiKey: "user_test" });
    expect(status.quota.monthly?.total).toBe(70);
    expect(status.quota.monthly?.usedPercent).toBeCloseTo(9.26, 1);
    expect(status.quota.monthly?.remainingPercent).toBeCloseTo(90.74, 1);
    expect(status.quota.monthly?.resetAt?.toISOString().startsWith("2026-09-18")).toBe(true);
  });

  it("uses the goat monthly cap when subscriptions return planId goat", async () => {
    const transport = new HttpAlphaTransport({
      apiBase: "https://api.commandcode.ai",
      cliVersion: "0.52.1",
      timeoutMs: 5_000,
      idleTimeoutMs: 1_000,
      fetchImpl: async (url) => {
        const path = String(url);
        if (path.endsWith("/alpha/whoami")) return jsonResponse({ ok: true });
        if (path.endsWith("/alpha/billing/credits")) {
          return jsonResponse({
            credits: { monthlyCredits: 63.5166642281 },
            windowLimits: {
              fiveHour: { cap: 14, used: 0 },
              weekly: { cap: 35, used: 6.4833357719, resetAt: "2026-08-25T18:02:30.000Z" },
            },
          });
        }
        if (path.endsWith("/alpha/billing/subscriptions")) {
          return jsonResponse({ success: true, data: { planId: "goat", currentPeriodEnd: "2026-09-18T00:00:00.000Z" } });
        }
        if (path.endsWith("/provider/v1/models")) return jsonResponse({ data: [] });
        return jsonResponse({ error: "missing" }, 404);
      },
    });
    const status = await transport.getAccountStatus({ accountId: "acc_goat", apiKey: "user_test" });
    expect(status.quota.monthly?.total).toBe(70);
    expect(status.quota.monthly?.remainingPercent).toBeCloseTo(90.74, 1);
  });

  it("tags status fetches as health and generate as generate", async () => {
    const transport = new HttpAlphaTransport({
      apiBase: "https://api.commandcode.ai",
      cliVersion: "0.52.1",
      timeoutMs: 5_000,
      idleTimeoutMs: 1_000,
      fetchImpl: async (url) => {
        const path = String(url);
        if (path.endsWith("/alpha/generate")) return new Response("", { status: 200 });
        if (path.endsWith("/alpha/whoami")) return jsonResponse({ ok: true });
        if (path.endsWith("/alpha/billing/credits")) return jsonResponse({});
        if (path.endsWith("/alpha/billing/subscriptions")) return jsonResponse({});
        if (path.endsWith("/provider/v1/models")) return jsonResponse({ data: [] });
        return jsonResponse({ error: "missing" }, 404);
      },
    });
    await transport.getAccountStatus({ accountId: "acc_1", apiKey: "user_test" });
    expect(transport.lastRequestKind).toBe("health");
    for await (const _chunk of transport.generate(
      { accountId: "acc_1", apiKey: "user_test" },
      { model: "deepseek/deepseek-v4-flash", messages: [], stream: true },
    )) {
      /* drain */
    }
    expect(transport.lastRequestKind).toBe("generate");
  });

  it("aborts getAccountStatus when the health signal fires", async () => {
    const controller = new AbortController();
    const transport = new HttpAlphaTransport({
      apiBase: "https://api.commandcode.ai",
      cliVersion: "0.52.1",
      timeoutMs: 5_000,
      idleTimeoutMs: 1_000,
      fetchImpl: (_url, init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    });
    const pending = transport.getAccountStatus({ accountId: "acc_1", apiKey: "user_test" }, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("POST /api/accounts quota", () => {
  it("stores the transport quota snapshot when seating a key", async () => {
    const instance = await withServer({
      setup(transport) {
        const original = transport.getAccountStatus.bind(transport);
        transport.getAccountStatus = async (account) => {
          const status = await original(account);
          return {
            ...status,
            quota: {
              fiveHour: { remainingPercent: 80, usedPercent: 20, source: "upstream", confidence: "exact" },
              weekly: { remainingPercent: 70, usedPercent: 30, source: "upstream", confidence: "exact" },
              monthly: { remainingPercent: 90, remaining: 9, total: 10, source: "upstream", confidence: "exact" },
            },
          };
        };
      },
    });
    const created = await instance.app.inject({
      method: "POST",
      url: "/api/accounts",
      payload: { label: "Go #01", credential: "user_quota_seat" },
    });
    expect(created.statusCode).toBe(200);
    const account = (created.json() as { account: { quota: { fiveHour?: { remainingPercent?: number } } } }).account;
    expect(account.quota.fiveHour?.remainingPercent).toBe(80);
    await instance.close();
  });
});
