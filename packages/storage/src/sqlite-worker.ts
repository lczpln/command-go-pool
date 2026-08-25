import { parentPort, workerData } from "node:worker_threads";
import { openDatabase } from "./db.js";
import { AccountRepo, EventRepo, SessionRepo, UsageRepo, type UsageFilter, type UsageGroup, type UsageRecord } from "./repos.js";
import type { Account, AccountQuota, PoolEvent, Session } from "@command-go-pool/shared";

const port = parentPort;
if (!port) throw new Error("sqlite-worker must run as a worker thread");

const db = openDatabase(workerData?.home as string | undefined, workerData?.sqlite3 as string | undefined);
const accounts = new AccountRepo(db);
const sessions = new SessionRepo(db);
const usage = new UsageRepo(db);
const events = new EventRepo(db);

type RpcMessage = { id: number; op: string; args: unknown[] };

function dispatch(op: string, args: unknown[]): unknown {
  switch (op) {
    case "accounts.list":
      return accounts.list();
    case "accounts.upsert":
      accounts.upsert(args[0] as Account);
      return;
    case "accounts.remove":
      accounts.remove(args[0] as string);
      return;
    case "accounts.saveQuota":
      accounts.saveQuota(args[0] as string, args[1] as AccountQuota);
      return;
    case "sessions.snapshot": {
      const active = sessions.listActive(args[0] as number);
      const bindings: Record<string, { accountId: string; reason: string | null; at: number }[]> = {};
      for (const session of active) bindings[session.id] = sessions.bindings(session.id);
      return { sessions: active, bindings };
    }
    case "sessions.upsert":
      sessions.upsert(args[0] as Session);
      return;
    case "sessions.bind":
      sessions.bind(args[0] as string, args[1] as string, args[2] as string);
      return;
    case "usage.record":
      usage.record(args[0] as UsageRecord);
      return;
    case "usage.rollup":
      return usage.rollup(args[0] as number, args[1] as UsageGroup | undefined, args[2] as UsageFilter | undefined);
    case "usage.series":
      return usage.series(args[0] as number, args[1] as number, args[2] as UsageFilter | undefined);
    case "events.append":
      return events.append(args[0] as Omit<PoolEvent, "id">);
    case "events.list":
      return events.list(args[0] as number | undefined, args[1] as string | undefined);
    case "__close__":
      db.close();
      return;
    default:
      throw new Error(`Unknown sqlite worker op ${op}`);
  }
}

port.on("message", (msg: RpcMessage) => {
  try {
    const result = dispatch(msg.op, msg.args ?? []);
    port.postMessage({ id: msg.id, ok: true, result });
  } catch (error) {
    port.postMessage({
      id: msg.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

port.postMessage({ type: "ready" });
