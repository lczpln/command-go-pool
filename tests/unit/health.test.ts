import { afterEach, describe, expect, it } from "vitest";
import { beginGenerate, createHealthTick, mergeQuota } from "@command-go-pool/server";
import { withServer } from "../helpers.js";

describe("mergeQuota", () => {
  it("keeps previous exact windows when incoming data is unknown", () => {
    const merged = mergeQuota(
      {
        fiveHour: { remainingPercent: 42, source: "upstream", confidence: "exact" },
      },
      {
        fiveHour: { source: "unknown", confidence: "unknown" },
        weekly: { remainingPercent: 70, source: "upstream", confidence: "exact" },
      },
    );
    expect(merged.fiveHour?.remainingPercent).toBe(42);
    expect(merged.weekly?.remainingPercent).toBe(70);
  });
});

describe("health tick gate", () => {
  afterEach(() => {
    delete process.env.COMMAND_GO_POOL_HOME;
  });

  it("skips quota refresh while generate is inflight", async () => {
    const instance = await withServer();
    instance.runtime.pool.add({ label: "a", apiKey: "user_a" });
    let calls = 0;
    const original = instance.runtime.transport.getAccountStatus.bind(instance.runtime.transport);
    instance.runtime.transport.getAccountStatus = async (account, signal) => {
      calls += 1;
      return original(account, signal);
    };
    instance.runtime.inflightGenerates = 1;
    await createHealthTick(instance.runtime)();
    expect(calls).toBe(0);
    await instance.close();
  });

  it("does not overlap ticks", async () => {
    const instance = await withServer();
    instance.runtime.pool.add({ label: "a", apiKey: "user_a" });
    let started = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    instance.runtime.transport.getAccountStatus = async () => {
      started += 1;
      await gate;
      return { authenticated: true, models: [], quota: {} };
    };
    const tick = createHealthTick(instance.runtime);
    const first = tick();
    const second = tick();
    expect(started).toBe(1);
    release();
    await Promise.all([first, second]);
    expect(started).toBe(1);
    await instance.close();
  });

  it("aborts an in-flight status fetch when generate starts", async () => {
    const instance = await withServer();
    instance.runtime.pool.add({ label: "a", apiKey: "user_a" });
    let aborted = false;
    instance.runtime.transport.getAccountStatus = async (_account, signal) => {
      await new Promise<void>((_resolve, reject) => {
        const fail = () => {
          aborted = true;
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        };
        if (signal?.aborted) {
          fail();
          return;
        }
        signal?.addEventListener("abort", fail);
      });
      return { authenticated: true, models: [], quota: {} };
    };
    const running = createHealthTick(instance.runtime)();
    await new Promise((resolve) => setTimeout(resolve, 20));
    beginGenerate(instance.runtime);
    await running;
    expect(aborted).toBe(true);
    await instance.close();
  });
});
