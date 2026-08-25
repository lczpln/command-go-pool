import { parseAppConfig } from "@command-go-pool/shared";
import { MockTransport } from "@command-go-pool/transport-commandcode";
import { boot } from "@command-go-pool/server";
import type { AccountQuota } from "@command-go-pool/shared";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const home = process.env.COMMAND_GO_POOL_HOME ?? "/tmp/command-go-pool-demo";
process.env.COMMAND_GO_POOL_MASTER_KEY ??= "demo-master-key-not-for-production!!";
process.env.COMMAND_GO_POOL_HOME = home;
mkdirSync(home, { recursive: true });
const demoOpenCode = join(home, "opencode.json");
const demoClaude = join(home, "claude-settings.json");
process.env.OPENCODE_CONFIG ??= demoOpenCode;
if (!existsSync(demoOpenCode)) writeFileSync(demoOpenCode, "{}\n");
if (!existsSync(demoClaude)) writeFileSync(demoClaude, "{}\n");

const transport = new MockTransport();
const instance = await boot({
  home,
  transport,
  config: parseAppConfig({
    server: {
      host: "127.0.0.1",
      port: Number(process.env.COMMAND_GO_POOL_PORT ?? 8787),
      apiKey: process.env.COMMAND_GO_POOL_API_KEY,
    },
  }),
});

function quotaFor(i: number, exhausted: boolean): AccountQuota {
  if (i === 9) {
    return {
      fiveHour: { source: "unknown", confidence: "unknown" },
      weekly: { remainingPercent: 55, usedPercent: 45, source: "upstream", confidence: "exact" },
      monthly: { remainingPercent: 62, usedPercent: 38, remaining: 6.2, total: 10, source: "upstream", confidence: "exact" },
    };
  }
  if (i === 10) {
    return {
      fiveHour: { remainingPercent: 61, usedPercent: 39, source: "local-estimate", confidence: "estimated" },
      weekly: { remainingPercent: 70, usedPercent: 30, source: "local-estimate", confidence: "estimated" },
      monthly: { remainingPercent: 80, usedPercent: 20, remaining: 8, total: 10, source: "local-estimate", confidence: "estimated" },
    };
  }
  const remaining = exhausted ? 0 : Math.max(5, 100 - i * 9);
  return {
    fiveHour: {
      remainingPercent: remaining,
      usedPercent: 100 - remaining,
      source: "upstream",
      confidence: "exact",
      resetAt: exhausted ? new Date(Date.now() + 43 * 60_000) : new Date(Date.now() + 2 * 3600_000),
    },
    weekly: {
      remainingPercent: Math.min(95, remaining + 10 || 61),
      usedPercent: Math.max(5, 90 - remaining),
      source: "upstream",
      confidence: "exact",
    },
    monthly: {
      remainingPercent: Math.min(98, (remaining || 0) + 18),
      usedPercent: Math.max(2, 82 - remaining),
      remaining: remaining / 10,
      total: 10,
      source: "upstream",
      confidence: "exact",
    },
  };
}

if (instance.runtime.pool.list().length === 0) {
  for (let i = 1; i <= 10; i++) {
    const exhausted = i === 3;
    const account = instance.runtime.pool.add({
      label: `GO #${String(i).padStart(2, "0")}`,
      apiKey: `user_demo_${i}`,
      monthlySubscriptionCost: 1,
    });
    const quota = quotaFor(i, exhausted);
    instance.runtime.pool.update(account.id, {
      status: exhausted ? "quota_exhausted" : i === 1 ? "active" : "available",
      cooldownUntil: exhausted ? new Date(Date.now() + 43 * 60_000) : undefined,
      cooldownReason: exhausted ? "5h quota exhausted" : undefined,
      activeSessionCount: i === 1 ? 3 : 0,
      models: ["deepseek/deepseek-v4-flash", "deepseek/deepseek-v4-flash-vision-exp", "deepseek/deepseek-v4-pro"],
      quota,
    });
    transport.set(account.id, { quota });
  }
}

const ids = instance.runtime.pool.list().map((a) => a.id);
for (const account of instance.runtime.pool.list()) {
  transport.set(account.id, { quota: account.quota });
}

if (ids[0] && !instance.runtime.sessions.get("ses_demo")) {
  const now = new Date();
  instance.runtime.sessions.upsert({
    id: "ses_demo",
    accountId: ids[0],
    model: "deepseek/deepseek-v4-flash",
    label: "party.exe",
    createdAt: now,
    lastRequestAt: now,
    requests: 183,
    inputTokens: 1_100_000,
    cacheReadTokens: 23_900_000,
    cacheWriteTokens: 40_000,
    outputTokens: 122_000,
    reasoningTokens: 0,
    estimatedCost: 0.043,
    migrations: 1,
    sticky: true,
  });
  instance.runtime.sessions.bind("ses_demo", ids[3] ?? ids[0], "new:sticky");
  instance.runtime.sessions.bind("ses_demo", ids[0], "quota_exhausted");
  instance.runtime.usage.record({
    accountId: ids[0],
    sessionId: "ses_demo",
    model: "deepseek/deepseek-v4-flash",
    inputTokens: 1_100_000,
    cacheReadTokens: 23_900_000,
    outputTokens: 122_000,
    estimatedCost: 1.73,
  });
  instance.runtime.events.append({
    at: now,
    level: "warning",
    category: "routing",
    type: "session.migrated",
    payload: { sessionId: "ses_demo", from: ids[3] ?? ids[0], to: ids[0], reason: "quota_exhausted" },
  });
}

await instance.listen();
console.log(`Demo mock pool http://127.0.0.1:${instance.runtime.config.server.port}`);
if (instance.poolApiKeyGenerated) {
  console.log(`Pool API key  ${instance.runtime.config.server.apiKey}`);
}
