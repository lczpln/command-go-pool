import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

export class SqliteBridge {
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private readonly ready: Promise<void>;
  private closed = false;

  constructor(private readonly worker: Worker) {
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("SQLite worker failed to start")), 15_000);
      this.worker.on("message", (msg: { type?: string; id?: number; ok?: boolean; result?: unknown; error?: string }) => {
        if (msg.type === "ready") {
          clearTimeout(timer);
          resolve();
          return;
        }
        if (typeof msg.id !== "number") return;
        const slot = this.pending.get(msg.id);
        if (!slot) return;
        this.pending.delete(msg.id);
        if (msg.ok) slot.resolve(msg.result);
        else slot.reject(new Error(msg.error ?? "SQLite worker error"));
      });
      this.worker.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
        this.failAll(error);
      });
      this.worker.once("exit", (code) => {
        if (this.closed || code === 0) return;
        const error = new Error(`SQLite worker exited with code ${code}`);
        reject(error);
        this.failAll(error);
      });
    });
  }

  waitUntilReady(): Promise<void> {
    return this.ready;
  }

  call(op: string, args: unknown[] = []): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("SQLite worker is closed"));
    const id = this.nextId++;
    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    void this.ready.then(
      () => {
        if (!this.pending.has(id)) return;
        this.worker.postMessage({ id, op, args });
      },
      (error: Error) => {
        const slot = this.pending.get(id);
        if (!slot) return;
        this.pending.delete(id);
        slot.reject(error);
      },
    );
    return promise;
  }

  enqueue(op: string, args: unknown[] = []): void {
    void this.call(op, args).catch(() => undefined);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    await this.ready.catch(() => undefined);
    await this.drainPending();
    try {
      await this.call("__close__");
    } catch {
      /* worker may already be gone */
    }
    this.closed = true;
    await this.worker.terminate();
  }

  private drainPending(): Promise<void> {
    if (this.pending.size === 0) return Promise.resolve();
    return Promise.allSettled(
      [...this.pending.values()].map(
        (slot) =>
          new Promise<void>((resolve) => {
            const resolveOrig = slot.resolve;
            const rejectOrig = slot.reject;
            slot.resolve = (value) => {
              resolveOrig(value);
              resolve();
            };
            slot.reject = (error) => {
              rejectOrig(error);
              resolve();
            };
          }),
      ),
    ).then(() => undefined);
  }

  private failAll(error: Error): void {
    for (const [id, slot] of this.pending) {
      this.pending.delete(id);
      slot.reject(error);
    }
  }
}

export async function openSqliteBridge(home?: string): Promise<SqliteBridge> {
  const worker = new Worker(resolveWorkerFile(), { workerData: { home, sqlite3: resolveSqlite3() } });
  const bridge = new SqliteBridge(worker);
  await bridge.waitUntilReady();
  return bridge;
}

function resolveSqlite3(): string | undefined {
  try {
    return createRequire(import.meta.url).resolve("better-sqlite3");
  } catch {
    return undefined;
  }
}

function resolveWorkerFile(): URL {
  const sibling = new URL("./sqlite-worker.js", import.meta.url);
  if (existsSync(fileURLToPath(sibling))) return sibling;
  const built = pathToFileURL(join(process.cwd(), "dist/sqlite-worker.js"));
  if (!process.env.VITEST && existsSync(fileURLToPath(built))) return built;
  return new URL("./sqlite-worker-boot.mjs", import.meta.url);
}
