import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import type { Worker } from "node:worker_threads";
import { SqliteBridge } from "@command-go-pool/storage";
import { createShutdown } from "../../packages/cli/src/shutdown.js";
import { withServer } from "../helpers.js";

describe("createShutdown", () => {
  it("exits 0 after close completes", async () => {
    const codes: number[] = [];
    const { stop } = createShutdown(async () => undefined, { exit: (code) => codes.push(code) });
    stop();
    await new Promise((resolve) => setImmediate(resolve));
    expect(codes).toEqual([0]);
  });

  it("force-exits on a second signal while close is pending", async () => {
    const codes: number[] = [];
    const { stop } = createShutdown(() => new Promise(() => undefined), {
      timeoutMs: 10_000,
      exit: (code) => codes.push(code),
    });
    stop();
    stop();
    expect(codes).toEqual([1]);
  });

  it("force-exits when close exceeds the timeout", async () => {
    const codes: number[] = [];
    const { stop } = createShutdown(() => new Promise(() => undefined), {
      timeoutMs: 20,
      exit: (code) => codes.push(code),
    });
    stop();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(codes).toEqual([1]);
  });
});

describe("server close", () => {
  afterEach(() => {
    delete process.env.COMMAND_GO_POOL_HOME;
  });

  it("returns while an SSE client is connected", async () => {
    const instance = await withServer();
    await instance.listen();
    const address = instance.app.server.address();
    if (!address || typeof address === "string") throw new Error("expected tcp address");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/events/stream`);
    expect(response.ok).toBe(true);
    const started = Date.now();
    await instance.close();
    expect(Date.now() - started).toBeLessThan(3_000);
    await response.body?.cancel().catch(() => undefined);
  });
});

describe("SqliteBridge.close", () => {
  it("does not wait forever for unanswered RPCs", async () => {
    const worker = new EventEmitter() as EventEmitter & {
      postMessage: () => void;
      terminate: () => Promise<number>;
    };
    worker.postMessage = () => undefined;
    worker.terminate = async () => 0;
    const bridge = new SqliteBridge(worker as unknown as Worker);
    worker.emit("message", { type: "ready" });
    await bridge.waitUntilReady();
    const pending = bridge.call("usage.rollup", [0]);
    const started = Date.now();
    await bridge.close(30);
    expect(Date.now() - started).toBeLessThan(500);
    await expect(pending).rejects.toThrow(/closed/);
  });
});
