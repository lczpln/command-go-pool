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
});
