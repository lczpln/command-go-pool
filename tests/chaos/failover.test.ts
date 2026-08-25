import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseAppConfig, failure } from "@command-go-pool/shared";
import { MockTransport } from "@command-go-pool/transport-commandcode";
import { boot } from "@command-go-pool/server";

describe("chaos: 10 accounts", () => {
  afterEach(() => {
    delete process.env.COMMAND_GO_POOL_HOME;
  });

  it("migrates past exhausted, timeout, and auth-failed accounts onto a healthy one", async () => {
    const home = mkdtempSync(join(tmpdir(), "cgp-chaos-"));
    process.env.COMMAND_GO_POOL_HOME = home;
    process.env.COMMAND_GO_POOL_MASTER_KEY = "c".repeat(32);
    const transport = new MockTransport();
    const instance = await boot({
      config: parseAppConfig({ server: { host: "127.0.0.1", port: 0 }, routing: { maxFailoversPerRequest: 3 } }),
      transport,
      home,
    });
    const ids: string[] = [];
    for (let i = 1; i <= 10; i++) {
      ids.push(instance.runtime.pool.add({ label: `GO #${String(i).padStart(2, "0")}`, apiKey: `user_${i}` }).id);
    }
    transport.set(ids[0]!, { chunks: [{ type: "error", error: failure("quota_exhausted", "5h quota exhausted", { window: "fiveHour" }) }] });
    transport.set(ids[1]!, { chunks: [{ type: "error", error: failure("timeout", "timed out") }] });
    transport.set(ids[2]!, { chunks: [{ type: "error", error: failure("auth_failed", "bad key") }] });
    for (let i = 3; i < 10; i++) {
      transport.set(ids[i]!, {
        chunks: [
          { type: "text-delta", text: `healthy-${i + 1}` },
          { type: "finish", reason: "stop", usage: { outputTokens: 1 } },
        ],
      });
    }
    await instance.app.ready();
    const res = await instance.app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "x-command-go-session": "ses_8fh2" },
      payload: { model: "deepseek/deepseek-v4-flash", messages: [{ role: "user", content: "go" }] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { choices: Array<{ message: { content: string } }> };
    expect(body.choices[0]?.message.content).toMatch(/healthy-/);
    expect(instance.runtime.pool.get(ids[0]!)?.status).toBe("quota_exhausted");
    expect(instance.runtime.pool.get(ids[2]!)?.status).toBe("auth_error");
    const events = instance.runtime.events.list(50);
    expect(events.some((e) => e.type === "session.migrated")).toBe(true);
    await instance.close();
  });
});
