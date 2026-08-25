import { afterEach, describe, expect, it } from "vitest";
import { parseAppConfig } from "@command-go-pool/shared";
import { MockTransport } from "@command-go-pool/transport-commandcode";
import { boot } from "@command-go-pool/server";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("persistence", () => {
  afterEach(() => {
    delete process.env.COMMAND_GO_POOL_HOME;
  });

  it("restores accounts, quota, sessions, and usage after restart", async () => {
    const home = mkdtempSync(join(tmpdir(), "cgp-persist-"));
    process.env.COMMAND_GO_POOL_HOME = home;
    process.env.COMMAND_GO_POOL_MASTER_KEY = "p".repeat(32);
    const transport = new MockTransport();
    const first = await boot({
      home,
      transport,
      config: parseAppConfig({ server: { host: "127.0.0.1", port: 0 } }),
    });
    const account = first.runtime.pool.add({ label: "Go #01", apiKey: "user_persist", monthlySubscriptionCost: 1 });
    first.runtime.pool.update(account.id, {
      quota: {
        fiveHour: { remainingPercent: 42, source: "upstream", confidence: "exact" },
      },
      cooldownUntil: new Date(Date.now() + 60_000),
      cooldownReason: "5h quota exhausted",
      status: "quota_exhausted",
    });
    first.runtime.sessions.upsert({
      id: "ses_persist",
      accountId: account.id,
      model: "deepseek/deepseek-v4-flash",
      createdAt: new Date(),
      lastRequestAt: new Date(),
      requests: 4,
      inputTokens: 10,
      cacheReadTokens: 20,
      cacheWriteTokens: 0,
      outputTokens: 3,
      reasoningTokens: 0,
      estimatedCost: 0.01,
      migrations: 0,
      sticky: true,
    });
    first.runtime.usage.record({
      accountId: account.id,
      sessionId: "ses_persist",
      model: "deepseek/deepseek-v4-flash",
      inputTokens: 10,
      cacheReadTokens: 20,
      outputTokens: 3,
      estimatedCost: 0.01,
    });
    await first.close();

    const firstKey = first.runtime.config.server.apiKey;
    const second = await boot({
      home,
      transport,
      config: parseAppConfig({ server: { host: "127.0.0.1", port: 0 } }),
    });
    expect(second.runtime.config.server.apiKey).toBe(firstKey);
    expect(second.poolApiKeyGenerated).toBe(false);
    const restored = second.runtime.pool.list();
    expect(restored).toHaveLength(1);
    expect(restored[0]?.label).toBe("Go #01");
    expect(restored[0]?.status).toBe("quota_exhausted");
    expect(restored[0]?.quota.fiveHour?.remainingPercent).toBe(42);
    expect(second.runtime.sessions.get("ses_persist")?.requests).toBe(4);
    const usage = (await second.runtime.usage.rollup(Date.now() - 86_400_000))[0] as { requests?: number };
    expect(Number(usage.requests)).toBeGreaterThan(0);
    expect(second.runtime.pool.credential(restored[0]!.id)?.apiKey).toBe("user_persist");
    await second.close();
  });
});
