import { afterEach, describe, expect, it } from "vitest";
import { withServer } from "../helpers.js";

describe("usage filters", () => {
  afterEach(() => {
    delete process.env.COMMAND_GO_POOL_HOME;
  });

  it("scopes series and totals by account, model, and session", async () => {
    const instance = await withServer({
      setup(_transport, add, server) {
        const alpha = add("Alpha");
        const beta = add("Beta");
        server.runtime.usage.record({
          accountId: alpha,
          sessionId: "ses_a",
          model: "deepseek/deepseek-v4-flash",
          inputTokens: 100,
          outputTokens: 20,
          estimatedCost: 0.4,
        });
        server.runtime.usage.record({
          accountId: beta,
          sessionId: "ses_b",
          model: "deepseek/deepseek-v4-pro",
          inputTokens: 50,
          outputTokens: 5,
          estimatedCost: 0.1,
        });
      },
    });
    const accounts = instance.runtime.pool.list();
    const alpha = accounts.find((row) => row.label === "Alpha")?.id;
    const all = await instance.app.inject({ method: "GET", url: "/api/usage" });
    const body = all.json() as { month: { requests: number; inputTokens: number }; series: Array<{ tokens: number }> };
    expect(Number(body.month.requests)).toBe(2);
    expect(Number(body.month.inputTokens)).toBe(150);

    const filtered = await instance.app.inject({ method: "GET", url: `/api/usage?account=${alpha}` });
    const scoped = filtered.json() as {
      month: { requests: number; inputTokens: number };
      series: Array<{ tokens: number; requests: number }>;
      byModel: Array<{ key: string; requests: number }>;
    };
    expect(Number(scoped.month.requests)).toBe(1);
    expect(Number(scoped.month.inputTokens)).toBe(100);
    expect(scoped.series.reduce((sum, point) => sum + point.tokens, 0)).toBe(120);
    expect(scoped.byModel.map((row) => row.key)).toEqual(["deepseek/deepseek-v4-flash"]);
    await instance.close();
  });

  it("scopes paid and subsidy to the filtered account", async () => {
    const instance = await withServer({
      setup(_transport, add, server) {
        const alpha = add("Alpha");
        const beta = add("Beta");
        server.runtime.pool.update(alpha, { monthlySubscriptionCost: 10 });
        server.runtime.pool.update(beta, { monthlySubscriptionCost: 5 });
        server.runtime.usage.record({ accountId: alpha, estimatedCost: 74.6 });
        server.runtime.usage.record({ accountId: beta, estimatedCost: 10 });
      },
    });
    const accounts = instance.runtime.pool.list();
    const alpha = accounts.find((row) => row.label === "Alpha")?.id;

    const all = await instance.app.inject({ method: "GET", url: "/api/usage" });
    const poolUsage = all.json() as { paid: number; consumed: number; subsidy: number };
    expect(poolUsage.paid).toBe(15);
    expect(poolUsage.consumed).toBeCloseTo(84.6);
    expect(poolUsage.subsidy).toBeCloseTo(84.6 / 15);

    const filtered = await instance.app.inject({ method: "GET", url: `/api/usage?account=${alpha}` });
    const scoped = filtered.json() as { paid: number; consumed: number; subsidy: number };
    expect(scoped.paid).toBe(10);
    expect(scoped.consumed).toBeCloseTo(74.6);
    expect(scoped.subsidy).toBeCloseTo(7.46);
    await instance.close();
  });
});
