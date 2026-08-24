import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openaiChatSchema, openaiToNormalized, openaiChunkFrame, openaiFinal } from "@command-go-proxy/protocol-openai";
import { anthropicMessageSchema, anthropicToNormalized, anthropicStreamFrames, anthropicFinal } from "@command-go-proxy/protocol-anthropic";
import { isLoopbackHost, newId } from "@command-go-proxy/shared";
import { subsidyMultiplier } from "@command-go-proxy/quota-engine";
import { saveConfig } from "@command-go-proxy/storage";
import { emit, executeRequest, overview, type Runtime } from "./runtime.js";
import { mergeQuota } from "./health.js";
import type { AppConfig } from "@command-go-proxy/shared";

function headerMap(headers: Record<string, unknown>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k.toLowerCase()] = Array.isArray(v) ? String(v[0]) : v === undefined ? undefined : String(v);
  }
  return out;
}

function publicAccount(runtime: Runtime, id: string) {
  const account = runtime.pool.get(id);
  if (!account) return undefined;
  const { credentialRef: _secret, ...rest } = account;
  const day = nowRollup(runtime, id, 86_400_000);
  const month = nowRollup(runtime, id, 30 * 86_400_000);
  const cacheRead = Number(month?.cacheReadTokens ?? 0);
  const input = Number(month?.inputTokens ?? 0);
  const cacheHit = cacheRead + input > 0 ? cacheRead / (cacheRead + input) : undefined;
  return {
    ...rest,
    stats: {
      requests: Number(month?.requests ?? 0),
      cacheHit,
      todayCost: day?.estimatedCost === undefined || day.estimatedCost === null ? undefined : Number(day.estimatedCost),
    },
  };
}

function nowRollup(runtime: Runtime, accountId: string, windowMs: number) {
  return runtime.usage.rollup(Date.now() - windowMs, "account").find((row) => String(row.key) === accountId) as
    | { requests?: number; inputTokens?: number; cacheReadTokens?: number; estimatedCost?: number | null }
    | undefined;
}

export async function buildApp(runtime: Runtime) {
  const app = Fastify({ loggerInstance: runtime.log });

  app.addHook("onRequest", async (req, reply) => {
    const path = req.url.split("?")[0] ?? "";
    const isInference = path.startsWith("/v1/");
    const isAdmin = path.startsWith("/api/");
    const isDashboard = !isInference && !isAdmin;
    const apiKey = runtime.config.server.apiKey;
    const exposed = !isLoopbackHost(runtime.config.server.host);
    if (exposed && !apiKey) {
      return reply.code(403).send({
        error: {
          message: "Binding outside localhost requires COMMAND_GO_PROXY_API_KEY. Admin and inference routes are locked.",
          type: "authentication_error",
        },
      });
    }
    if (!exposed && !isInference) return;
    if (isDashboard && req.method === "GET" && !exposed) return;
    if (!apiKey && !exposed) return;
    if (!apiKey) return;
    if (isDashboard && req.method === "GET") return;
    const provided =
      headerMap(req.headers).authorization?.replace(/^Bearer\s+/i, "") ?? headerMap(req.headers)["x-api-key"];
    if (provided !== apiKey) {
      return reply.code(401).send({ error: { message: "Invalid proxy API key", type: "authentication_error" } });
    }
  });

  app.get("/api/health", async () => overview(runtime));

  app.get("/v1/models", async () => {
    const ids = new Map<string, { id: string; object: string; owned_by: string }>();
    for (const account of runtime.pool.eligible()) {
      for (const id of account.models ?? []) {
        ids.set(id, { id, object: "model", owned_by: id.split("/")[0] ?? "command-code" });
      }
    }
    if (ids.size === 0) {
      for (const account of runtime.pool.list()) {
        const cred = runtime.pool.credential(account.id);
        if (!cred) continue;
        try {
          const models = await runtime.transport.listModels(cred);
          runtime.pool.update(account.id, { models: models.map((m) => m.id) });
          for (const model of models) ids.set(model.id, { id: model.id, object: "model", owned_by: model.ownedBy ?? "command-code" });
        } catch {
          /* skip */
        }
      }
    }
    for (const alias of Object.keys(runtime.config.aliases)) {
      const target = runtime.config.aliases[alias];
      if (target && ids.has(target)) ids.set(alias, { id: alias, object: "model", owned_by: "alias" });
    }
    return { object: "list", data: [...ids.values()] };
  });

  app.post("/v1/chat/completions", async (req, reply) => {
    const parsed = openaiChatSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { message: parsed.error.message, type: "invalid_request_error" } });
    }
    const normalized = openaiToNormalized(parsed.data, runtime.config.aliases);
    const headers = headerMap(req.headers);
    const abort = new AbortController();
    reply.raw.on("close", () => {
      if (!reply.raw.writableEnded) abort.abort();
    });
    const { stream } = executeRequest(runtime, normalized, headers, abort.signal);
    const id = newId("chatcmpl");
    const created = Math.floor(Date.now() / 1000);
    if (normalized.stream) {
      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      try {
        for await (const chunk of stream) {
          if (chunk.type === "error") {
            reply.raw.write(`data: ${JSON.stringify({ error: { message: chunk.error.message, type: chunk.error.code } })}\n\n`);
            break;
          }
          const frame = openaiChunkFrame(id, normalized.model, created, chunk);
          if (frame) reply.raw.write(frame);
        }
      } finally {
        reply.raw.end();
      }
      return;
    }
    let text = "";
    let reasoning = "";
    const tools: { id: string; name: string; arguments: string }[] = [];
    let usage;
    for await (const chunk of stream) {
      if (chunk.type === "error") {
        return reply.code(chunk.error.status && chunk.error.status >= 400 ? chunk.error.status : 502).send({
          error: { message: chunk.error.message, type: chunk.error.code, code: chunk.error.code },
        });
      }
      if (chunk.type === "text-delta") text += chunk.text;
      if (chunk.type === "reasoning-delta") reasoning += chunk.text;
      if (chunk.type === "tool-call") tools.push({ id: chunk.id, name: chunk.name, arguments: JSON.stringify(chunk.arguments ?? {}) });
      if (chunk.type === "finish") usage = chunk.usage;
    }
    return openaiFinal(id, normalized.model, created, text, tools, usage, reasoning);
  });

  app.post("/v1/messages", async (req, reply) => {
    const parsed = anthropicMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ type: "error", error: { type: "invalid_request_error", message: parsed.error.message } });
    }
    const normalized = anthropicToNormalized(parsed.data, runtime.config.aliases);
    const headers = headerMap(req.headers);
    const abort = new AbortController();
    reply.raw.on("close", () => {
      if (!reply.raw.writableEnded) abort.abort();
    });
    const { stream } = executeRequest(runtime, normalized, headers, abort.signal);
    const id = newId("msg");
    if (normalized.stream) {
      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      const state = { started: false, block: 0 };
      try {
        for await (const chunk of stream) {
          if (chunk.type === "error") {
            reply.raw.write(`event: error\ndata: ${JSON.stringify({ type: "error", error: { type: chunk.error.code, message: chunk.error.message } })}\n\n`);
            break;
          }
          reply.raw.write(anthropicStreamFrames(id, normalized.model, chunk, state));
        }
      } finally {
        reply.raw.end();
      }
      return;
    }
    let text = "";
    const tools: { id: string; name: string; arguments: unknown }[] = [];
    let usage;
    for await (const chunk of stream) {
      if (chunk.type === "error") {
        return reply.code(502).send({ type: "error", error: { type: chunk.error.code, message: chunk.error.message } });
      }
      if (chunk.type === "text-delta") text += chunk.text;
      if (chunk.type === "tool-call") tools.push({ id: chunk.id, name: chunk.name, arguments: chunk.arguments });
      if (chunk.type === "finish") usage = chunk.usage;
    }
    return anthropicFinal(id, normalized.model, text, tools, usage);
  });

  app.get("/api/accounts", async () => ({ accounts: runtime.pool.list().map((a) => publicAccount(runtime, a.id)) }));

  app.post("/api/accounts", async (req, reply) => {
    const raw = req.body;
    if (!raw || typeof raw !== "object") return reply.code(400).send({ error: "label and credential required" });
    const body = raw as Record<string, unknown>;
    const label = typeof body.label === "string" ? body.label.trim() : "";
    const credential = typeof body.credential === "string" ? body.credential.trim() : "";
    if (!label || !credential) return reply.code(400).send({ error: "label and credential required" });
    const monthlySubscriptionCost = typeof body.monthlySubscriptionCost === "number" ? body.monthlySubscriptionCost : undefined;
    const account = runtime.pool.add({
      label,
      apiKey: credential,
      monthlySubscriptionCost,
    });
    const cred = runtime.pool.credential(account.id)!;
    const rejectAuth = (message: string) => {
      runtime.pool.remove(account.id);
      return reply.code(400).send({ error: message });
    };
    try {
      const status = await runtime.transport.getAccountStatus(cred);
      if (!status.authenticated) return rejectAuth("Authentication failed");
      runtime.pool.update(account.id, {
        models: status.models.map((m) => m.id),
        status: "available",
        quota: mergeQuota(account.quota, status.quota),
      });
      emit(runtime, { level: "info", category: "system", type: "account.updated", payload: { accountId: account.id } });
      return {
        account: publicAccount(runtime, account.id),
        test: {
          ok: true,
          message: "Authentication successful",
          models: status.models,
        },
      };
    } catch {
      const test = await runtime.transport.testCredential(cred);
      if (!test.ok) return rejectAuth(test.message);
      runtime.pool.update(account.id, { models: test.models?.map((m) => m.id), status: "available" });
      emit(runtime, { level: "info", category: "system", type: "account.updated", payload: { accountId: account.id } });
      return { account: publicAccount(runtime, account.id), test };
    }
  });

  app.patch("/api/accounts/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!runtime.pool.get(id)) return reply.code(404).send({ error: "not found" });
    const body = req.body as {
      label?: string;
      enabled?: boolean;
      monthlySubscriptionCost?: number;
      status?: "disabled" | "available";
      credential?: string;
    };
    const patch: Record<string, unknown> = {};
    if (body.label) patch.label = body.label;
    if (typeof body.enabled === "boolean") {
      patch.enabled = body.enabled;
      patch.status = body.enabled ? "available" : "disabled";
    }
    if (body.monthlySubscriptionCost !== undefined) patch.monthlySubscriptionCost = body.monthlySubscriptionCost;
    if (typeof body.credential === "string" && body.credential.trim()) {
      runtime.pool.replaceCredential(id, body.credential.trim());
      const cred = runtime.pool.credential(id);
      if (cred) {
        try {
          const status = await runtime.transport.getAccountStatus(cred);
          patch.status = status.authenticated ? "available" : "auth_error";
          if (status.authenticated) patch.models = status.models.map((m) => m.id);
          patch.quota = mergeQuota(runtime.pool.get(id)?.quota ?? {}, status.quota);
        } catch {
          const test = await runtime.transport.testCredential(cred);
          patch.status = test.ok ? "available" : "auth_error";
          if (test.ok) patch.models = test.models?.map((m) => m.id);
        }
      }
    }
    runtime.pool.update(id, patch);
    emit(runtime, { level: "info", category: "system", type: "account.updated", payload: { accountId: id, enabled: body.enabled } });
    return { account: publicAccount(runtime, id) };
  });

  app.delete("/api/accounts/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!runtime.pool.get(id)) return reply.code(404).send({ error: "not found" });
    runtime.pool.remove(id);
    emit(runtime, { level: "info", category: "system", type: "account.updated", payload: { accountId: id } });
    return { ok: true };
  });

  app.post("/api/accounts/:id/test", async (req, reply) => {
    const { id } = req.params as { id: string };
    const current = runtime.pool.get(id);
    const cred = runtime.pool.credential(id);
    if (!current || !cred) return reply.code(404).send({ error: "not found" });
    try {
      const status = await runtime.transport.getAccountStatus(cred);
      runtime.pool.update(id, {
        models: status.models.map((m) => m.id),
        quota: mergeQuota(current.quota, status.quota),
        status: status.authenticated ? (current.status === "auth_error" ? "available" : current.status) : "auth_error",
      });
      emit(runtime, { level: "info", category: "system", type: "account.updated", payload: { accountId: id } });
      return {
        ok: status.authenticated,
        message: status.authenticated ? "Authentication successful" : "Authentication failed",
        models: status.models,
      };
    } catch {
      const test = await runtime.transport.testCredential(cred);
      return test;
    }
  });

  app.get("/api/sessions", async () => {
    const ttl = runtime.config.routing.sessionTtlHours * 3600_000;
    return { sessions: runtime.sessions.listActive(ttl) };
  });

  app.get("/api/sessions/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const session = runtime.sessions.get(id);
    if (!session) return reply.code(404).send({ error: "not found" });
    return { session, migrations: runtime.sessions.bindings(id) };
  });

  app.get("/api/usage", async () => {
    const now = Date.now();
    const day = now - 86_400_000;
    const week = now - 7 * 86_400_000;
    const month = now - 30 * 86_400_000;
    const accounts = runtime.pool.list();
    const paid = accounts.reduce((s, a) => s + (a.monthlySubscriptionCost ?? 0), 0);
    const monthRollup = runtime.usage.rollup(month)[0] as { estimatedCost?: number; requests?: number; inputTokens?: number; cacheReadTokens?: number; outputTokens?: number } | undefined;
    const consumed = Number(monthRollup?.estimatedCost ?? 0);
    const cacheRead = Number(monthRollup?.cacheReadTokens ?? 0);
    const input = Number(monthRollup?.inputTokens ?? 0);
    const cacheHit = cacheRead + input > 0 ? cacheRead / (cacheRead + input) : undefined;
    return {
      today: runtime.usage.rollup(day)[0],
      week: runtime.usage.rollup(week)[0],
      month: monthRollup,
      byAccount: runtime.usage.rollup(month, "account"),
      byModel: runtime.usage.rollup(month, "model"),
      bySession: runtime.usage.rollup(month, "session"),
      series: runtime.usage.series(week, 3600_000),
      paid,
      consumed: consumed || undefined,
      subsidy: paid && consumed ? subsidyMultiplier(paid, consumed) : undefined,
      cacheHit,
    };
  });

  app.get("/api/events", async (req) => {
    const query = req.query as { category?: string; limit?: string };
    return { events: runtime.events.list(Number(query.limit ?? 200), query.category) };
  });

  app.get("/api/events/stream", async (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const send = (event: { type: string; payload: unknown; at?: Date }) => {
      reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    send({ type: "hello", payload: overview(runtime) });
    const off = runtime.bus.onEvent((event) => send(event));
    req.raw.on("close", () => {
      off();
      reply.raw.end();
    });
  });

  app.get("/api/config", async () => ({ config: publicConfig(runtime.config) }));

  app.patch("/api/config", async (req) => {
    const patch = req.body as Record<string, unknown>;
    const merged = { ...runtime.config, ...patch, server: { ...runtime.config.server, ...((patch.server as object) ?? {}) } };
    Object.assign(runtime.config, merged);
    saveConfig(runtime.config);
    return { config: publicConfig(runtime.config) };
  });

  const dashboardDir = resolveDashboardDir();
  if (runtime.config.dashboard.enabled && dashboardDir && existsSync(dashboardDir)) {
    const assetsDir = join(dashboardDir, "assets");
    if (existsSync(assetsDir)) {
      await app.register(fastifyStatic, { root: assetsDir, prefix: "/assets/", decorateReply: false });
    }
    await app.register(fastifyStatic, { root: dashboardDir, prefix: "/", wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/v1/") || req.url.startsWith("/api/")) {
        return reply.code(404).send({ error: { message: "Not found" } });
      }
      return reply.sendFile("index.html");
    });
  }

  return app;
}

export function publicConfig(config: AppConfig) {
  return {
    ...config,
    server: { ...config.server, apiKey: config.server.apiKey ? "[set]" : undefined },
    fallback: { ...config.fallback, apiKey: config.fallback.apiKey ? "[set]" : undefined },
  };
}

function resolveDashboardDir(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "dashboard"),
    join(here, "../dashboard"),
    join(process.cwd(), "apps/dashboard/dist"),
    join(process.cwd(), "dist/dashboard"),
  ];
  return candidates.find((p) => existsSync(join(p, "index.html")));
}
