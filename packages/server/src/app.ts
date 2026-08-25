import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openaiChatSchema, openaiToNormalized, openaiChunkFrame, openaiFinal } from "@command-go-pool/protocol-openai";
import {
  anthropicMessageSchema,
  anthropicToNormalized,
  anthropicStreamFrames,
  anthropicFinal,
  isAnthropicQuotaProbe,
} from "@command-go-pool/protocol-anthropic";
import {
  OPENCODE_FALLBACK_MODELS,
  catalogModels,
  connectClient,
  defaultOpenCodeFile,
  disconnectClient,
  catalogMeta,
  enabledSyncModels,
  exposedInferenceModels,
  modelInventory,
  getClientAdapter,
  isClientId,
  isRequiredVisionModel,
  OPENCODE_VISION_LOCK_REASON,
  isLoopbackHost,
  isModelEnabled,
  listClientStatuses,
  newId,
  rotatePoolApiKey,
  setModelEnabled,
  syncConnectedClientKeys,
  syncConnectedClients,
  writeOpenCodeConfig,
  type AppConfig,
} from "@command-go-pool/shared";
import {
  aggregatePool,
  subsidyMultiplier,
  clientUsageHeaders,
  claudeOauthUsage,
  openCodeUsage,
  type ClientQuota,
} from "@command-go-pool/quota-engine";
import { saveConfig } from "@command-go-pool/storage";
import { emit, executeRequest, overview, syncSessionLoad, type Runtime } from "./runtime.js";
import { mergeQuota } from "./health.js";

function headerMap(headers: Record<string, unknown>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k.toLowerCase()] = Array.isArray(v) ? String(v[0]) : v === undefined ? undefined : String(v);
  }
  return out;
}

function presentedApiKeys(headers: Record<string, unknown>): string[] {
  const map = headerMap(headers);
  const keys: string[] = [];
  const bearer = map.authorization?.replace(/^Bearer\s+/i, "").trim();
  if (bearer) keys.push(bearer);
  const headerKey = map["x-api-key"]?.trim();
  if (headerKey) keys.push(headerKey);
  return keys;
}

async function publicAccount(runtime: Runtime, id: string) {
  syncSessionLoad(runtime);
  const account = runtime.pool.get(id);
  if (!account) return undefined;
  const { credentialRef: _secret, ...rest } = account;
  const day = await nowRollup(runtime, id, 86_400_000);
  const month = await nowRollup(runtime, id, 30 * 86_400_000);
  const cacheRead = Number(month?.cacheReadTokens ?? 0);
  const input = Number(month?.inputTokens ?? 0);
  const cacheHit = cacheRead + input > 0 ? cacheRead / (cacheRead + input) : undefined;
  return {
    ...rest,
    generating: (runtime.inflightByAccount.get(id) ?? 0) > 0,
    stats: {
      requests: Number(month?.requests ?? 0),
      cacheHit,
      todayCost: day?.estimatedCost === undefined || day.estimatedCost === null ? undefined : Number(day.estimatedCost),
    },
  };
}

async function nowRollup(runtime: Runtime, accountId: string, windowMs: number) {
  const rows = await runtime.usage.rollup(Date.now() - windowMs, "account");
  return rows.find((row) => String(row.key) === accountId) as
    | { requests?: number; inputTokens?: number; cacheReadTokens?: number; estimatedCost?: number | null }
    | undefined;
}

function clientQuota(runtime: Runtime, accountId?: string): ClientQuota {
  if (accountId) return runtime.pool.get(accountId)?.quota ?? {};
  return aggregatePool(runtime.pool.list());
}

function applyUsageHeaders(reply: { header(name: string, value: string): unknown }, quota: ClientQuota) {
  for (const [key, value] of Object.entries(clientUsageHeaders(quota))) {
    reply.header(key, value);
  }
}

function sseHead(quota: ClientQuota): Record<string, string> {
  return {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
    ...clientUsageHeaders(quota),
  };
}

export async function buildApp(runtime: Runtime) {
  const app = Fastify({ loggerInstance: runtime.log, forceCloseConnections: true });
  app.addHook("preClose", async () => {
    runtime.shutdown.abort();
  });

  app.addHook("onRequest", async (req, reply) => {
    const path = req.url.split("?")[0] ?? "";
    const isInference = path.startsWith("/v1/");
    const isAdmin = path.startsWith("/api/");
    const isDashboard = !isInference && !isAdmin;
    const apiKey = runtime.config.server.apiKey?.trim();
    const exposed = !isLoopbackHost(runtime.config.server.host);
    if (!apiKey) return;
    if (!exposed && !isInference) return;
    if (isDashboard && (req.method === "GET" || req.method === "HEAD")) return;
    if (!presentedApiKeys(req.headers).includes(apiKey)) {
      return reply.code(401).send({ error: { message: "Invalid pool API key", type: "authentication_error" } });
    }
  });

  app.get("/api/health", async () => overview(runtime));

  app.get("/v1/models", async () => {
    const ids = new Set<string>();
    const meta = catalogMeta(runtime.pool.eligible());
    for (const account of runtime.pool.eligible()) {
      for (const id of account.models ?? []) ids.add(id);
    }
    if (ids.size === 0 || meta.size === 0) {
      for (const account of runtime.pool.list()) {
        const cred = runtime.pool.credential(account.id);
        if (!cred) continue;
        try {
          const models = await runtime.transport.listModels(cred);
          runtime.pool.update(account.id, modelInventory(models));
          for (const model of models) {
            ids.add(model.id);
            meta.set(model.id, {
              reasoning: model.reasoning,
              vision: model.vision,
              contextWindow: model.contextWindow,
              outputLimit: model.outputLimit,
            });
          }
        } catch {
          /* skip */
        }
      }
    }
    return { object: "list", data: exposedInferenceModels(ids, runtime.config, meta) };
  });

  app.get("/v1/usage", async (req, reply) => {
    const query = req.query as { account?: string };
    if (query.account && !runtime.pool.get(query.account)) {
      return reply.code(404).send({ error: { message: "account not found", type: "invalid_request_error" } });
    }
    const quota = clientQuota(runtime, query.account);
    applyUsageHeaders(reply, quota);
    return openCodeUsage(quota);
  });

  app.get("/api/oauth/usage", async (req, reply) => {
    const query = req.query as { account?: string };
    if (query.account && !runtime.pool.get(query.account)) {
      return reply.code(404).send({ error: { message: "account not found", type: "invalid_request_error" } });
    }
    const quota = clientQuota(runtime, query.account);
    applyUsageHeaders(reply, quota);
    return claudeOauthUsage(quota);
  });

  app.post("/v1/chat/completions", async (req, reply) => {
    const parsed = openaiChatSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { message: parsed.error.message, type: "invalid_request_error" } });
    }
    const normalized = openaiToNormalized(parsed.data, runtime.config.aliases);
    if (!isModelEnabled(parsed.data.model, runtime.config) || !isModelEnabled(normalized.model, runtime.config)) {
      return reply.code(400).send({
        error: { message: `Model ${parsed.data.model} is disabled`, type: "unsupported_model", code: "unsupported_model" },
      });
    }
    const headers = headerMap(req.headers);
    const abort = new AbortController();
    reply.raw.on("close", () => {
      if (!reply.raw.writableEnded) abort.abort();
    });
    const { stream } = executeRequest(runtime, normalized, headers, abort.signal);
    const id = newId("chatcmpl");
    const created = Math.floor(Date.now() / 1000);
    const quota = clientQuota(runtime);
    if (normalized.stream) {
      reply.hijack();
      reply.raw.writeHead(200, sseHead(quota));
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
    applyUsageHeaders(reply, quota);
    return openaiFinal(id, normalized.model, created, text, tools, usage, reasoning);
  });

  app.post("/v1/messages", async (req, reply) => {
    const parsed = anthropicMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ type: "error", error: { type: "invalid_request_error", message: parsed.error.message } });
    }
    const normalized = anthropicToNormalized(parsed.data, runtime.config.aliases);
    if (!isModelEnabled(parsed.data.model, runtime.config) || !isModelEnabled(normalized.model, runtime.config)) {
      return reply.code(400).send({
        type: "error",
        error: { type: "unsupported_model", message: `Model ${parsed.data.model} is disabled` },
      });
    }
    const quota = clientQuota(runtime);
    if (isAnthropicQuotaProbe(parsed.data)) {
      const id = newId("msg");
      const model = parsed.data.model;
      if (normalized.stream) {
        reply.hijack();
        reply.raw.writeHead(200, sseHead(quota));
        const state = { started: false, block: 0 };
        reply.raw.write(anthropicStreamFrames(id, model, { type: "text-delta", text: "." }, state));
        reply.raw.write(
          anthropicStreamFrames(id, model, { type: "finish", reason: "stop", usage: { inputTokens: 1, outputTokens: 1 } }, state),
        );
        reply.raw.end();
        return;
      }
      applyUsageHeaders(reply, quota);
      return anthropicFinal(id, model, ".", [], { inputTokens: 1, outputTokens: 1 });
    }
    const headers = headerMap(req.headers);
    const abort = new AbortController();
    reply.raw.on("close", () => {
      if (!reply.raw.writableEnded) abort.abort();
    });
    const { stream } = executeRequest(runtime, normalized, headers, abort.signal);
    const id = newId("msg");
    if (normalized.stream) {
      reply.hijack();
      reply.raw.writeHead(200, sseHead(quota));
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
    applyUsageHeaders(reply, quota);
    return anthropicFinal(id, normalized.model, text, tools, usage);
  });

  app.get("/api/accounts", async () => ({
    accounts: await Promise.all(runtime.pool.list().map((a) => publicAccount(runtime, a.id))),
  }));

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
        ...modelInventory(status.models),
        status: "available",
        quota: mergeQuota(account.quota, status.quota),
      });
      emit(runtime, { level: "info", category: "system", type: "account.updated", payload: { accountId: account.id } });
      return {
        account: await publicAccount(runtime, account.id),
        test: {
          ok: true,
          message: "Authentication successful",
          models: status.models,
        },
      };
    } catch {
      const test = await runtime.transport.testCredential(cred);
      if (!test.ok) return rejectAuth(test.message);
      runtime.pool.update(account.id, { ...modelInventory(test.models ?? []), status: "available" });
      emit(runtime, { level: "info", category: "system", type: "account.updated", payload: { accountId: account.id } });
      return { account: await publicAccount(runtime, account.id), test };
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
    if (body.monthlySubscriptionCost !== undefined) {
      const cost = Number(body.monthlySubscriptionCost);
      if (!Number.isFinite(cost) || cost < 0) {
        return reply.code(400).send({ error: "monthlySubscriptionCost must be a non-negative number" });
      }
      patch.monthlySubscriptionCost = cost;
    }
    if (typeof body.credential === "string" && body.credential.trim()) {
      runtime.pool.replaceCredential(id, body.credential.trim());
      const cred = runtime.pool.credential(id);
      if (cred) {
        try {
          const status = await runtime.transport.getAccountStatus(cred);
          patch.status = status.authenticated ? "available" : "auth_error";
          if (status.authenticated) Object.assign(patch, modelInventory(status.models));
          patch.quota = mergeQuota(runtime.pool.get(id)?.quota ?? {}, status.quota);
        } catch {
          const test = await runtime.transport.testCredential(cred);
          patch.status = test.ok ? "available" : "auth_error";
          if (test.ok) Object.assign(patch, modelInventory(test.models ?? []));
        }
      }
    }
    runtime.pool.update(id, patch);
    emit(runtime, { level: "info", category: "system", type: "account.updated", payload: { accountId: id, enabled: body.enabled } });
    return { account: await publicAccount(runtime, id) };
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
        ...modelInventory(status.models),
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

  app.get("/api/usage", async (req) => {
    const query = req.query as { account?: string; model?: string; session?: string };
    const filter = {
      accountId: query.account || undefined,
      model: query.model || undefined,
      sessionId: query.session || undefined,
    };
    const scoped = filter.accountId || filter.model || filter.sessionId ? filter : undefined;
    const now = Date.now();
    const day = now - 86_400_000;
    const week = now - 7 * 86_400_000;
    const month = now - 30 * 86_400_000;
    const accounts = runtime.pool.list();
    const billed = filter.accountId ? accounts.filter((a) => a.id === filter.accountId) : accounts;
    const paid = billed.reduce((s, a) => s + (a.monthlySubscriptionCost ?? 0), 0);
    const [today, weekRow, monthRollup, byAccount, byModel, bySession, series] = await Promise.all([
      runtime.usage.rollup(day, undefined, scoped),
      runtime.usage.rollup(week, undefined, scoped),
      runtime.usage.rollup(month, undefined, scoped),
      runtime.usage.rollup(month, "account", scoped),
      runtime.usage.rollup(month, "model", scoped),
      runtime.usage.rollup(month, "session", scoped),
      runtime.usage.series(week, 3600_000, scoped),
    ]);
    const monthRow = monthRollup[0] as { estimatedCost?: number; requests?: number; inputTokens?: number; cacheReadTokens?: number; outputTokens?: number } | undefined;
    const consumed = Number(monthRow?.estimatedCost ?? 0);
    const cacheRead = Number(monthRow?.cacheReadTokens ?? 0);
    const input = Number(monthRow?.inputTokens ?? 0);
    const cacheHit = cacheRead + input > 0 ? cacheRead / (cacheRead + input) : undefined;
    return {
      today: today[0],
      week: weekRow[0],
      month: monthRow,
      windows: clientQuota(runtime, filter.accountId),
      byAccount,
      byModel,
      bySession,
      series,
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

  app.get("/api/models", async () => ({ models: catalogModels(runtime.pool.list(), runtime.config) }));

  app.patch("/api/models", async (req, reply) => {
    const body = req.body as { id?: string; enabled?: boolean };
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) return reply.code(400).send({ error: "id required" });
    if (typeof body.enabled !== "boolean") return reply.code(400).send({ error: "enabled boolean required" });
    if (isRequiredVisionModel(id) && body.enabled === false) {
      return reply.code(400).send({ error: OPENCODE_VISION_LOCK_REASON });
    }
    runtime.config.models = runtime.config.models ?? { disabled: [] };
    runtime.config.models.disabled = setModelEnabled(runtime.config.models.disabled ?? [], id, body.enabled);
    saveConfig(runtime.config);
    emit(runtime, { level: "info", category: "system", type: "models.updated", payload: { id, enabled: body.enabled } });
    return { models: catalogModels(runtime.pool.list(), runtime.config) };
  });

  function enabledClientModels() {
    const enabled = enabledSyncModels(runtime.pool.list(), runtime.config);
    const fallback = enabled.length === 0;
    return { models: fallback ? OPENCODE_FALLBACK_MODELS : enabled, fallback };
  }

  function persistRuntimeConfig(next: AppConfig) {
    Object.assign(runtime.config, next);
    saveConfig(runtime.config);
  }

  app.get("/api/clients", async () => ({ clients: listClientStatuses(runtime.config) }));

  app.post("/api/clients/sync", async () => {
    const { models, fallback } = enabledClientModels();
    const results = await syncConnectedClients(runtime.config, { models, apiKey: runtime.config.server.apiKey });
    const okRows = results.filter((row) => row.ok);
    const names = okRows.map((row) => getClientAdapter(row.id)?.name ?? row.id);
    const failed = results.some((row) => !row.ok);
    return {
      ok: okRows.length > 0 && !failed,
      clients: results.map((row) => ({
        id: row.id,
        name: getClientAdapter(row.id)?.name ?? row.id,
        file: row.file,
        connected: true,
        ok: row.ok,
        synced: row.ok,
        message: row.message,
      })),
      models: models.map((model) => model.id),
      message: names.length
        ? `Synced ${names.join(", ")}`
        : "No connected clients. Connect OpenCode or Claude Code first.",
      warning: fallback && names.length ? "No enabled models in the pool; wrote fallback catalog." : undefined,
    };
  });

  app.post("/api/clients/:id/connect", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!isClientId(id)) return reply.code(404).send({ error: "unknown client" });
    const body = (req.body ?? {}) as { file?: string };
    const { models, fallback } = enabledClientModels();
    const { config, result } = await connectClient(id, runtime.config, { file: body.file?.trim(), models });
    persistRuntimeConfig(config);
    emit(runtime, { level: "info", category: "system", type: "clients.updated", payload: { id, action: "connect", file: result.file } });
    return { ok: result.ok, client: id, file: result.file, message: result.message, warning: fallback ? "No enabled models in the pool; wrote fallback catalog." : undefined };
  });

  app.post("/api/clients/:id/disconnect", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!isClientId(id)) return reply.code(404).send({ error: "unknown client" });
    const { config, result } = disconnectClient(id, runtime.config);
    persistRuntimeConfig(config);
    emit(runtime, { level: "info", category: "system", type: "clients.updated", payload: { id, action: "disconnect", file: result.file } });
    return { ok: result.ok, client: id, file: result.file, message: result.message };
  });

  app.post("/api/key/rotate", async () => {
    const rotated = rotatePoolApiKey(runtime.config);
    persistRuntimeConfig(rotated.config);
    emit(runtime, { level: "info", category: "system", type: "clients.updated", payload: { action: "rotate", updated: rotated.updated.map((row) => row.id) } });
    return { apiKey: rotated.apiKey, updated: rotated.updated, config: publicConfig(runtime.config) };
  });

  app.post("/api/setup/opencode", async (req) => {
    const body = (req.body ?? {}) as { file?: string; baseUrl?: string };
    const file = body.file?.trim() || defaultOpenCodeFile();
    const { models, fallback } = enabledClientModels();
    if (body.baseUrl?.trim()) {
      const message = writeOpenCodeConfig({
        baseUrl: body.baseUrl.trim(),
        file,
        models,
        apiKey: runtime.config.server.apiKey,
      });
      persistRuntimeConfig({
        ...runtime.config,
        clients: {
          ...runtime.config.clients,
          connected: { ...runtime.config.clients.connected, opencode: { file } },
        },
      });
      return { ok: true, file, message, models: models.map((m) => m.id), warning: fallback ? "No enabled models in the pool; wrote fallback catalog." : undefined };
    }
    const { config, result } = await connectClient("opencode", runtime.config, { file, models });
    persistRuntimeConfig(config);
    return {
      ok: true,
      file: result.file,
      message: result.message,
      models: models.map((m) => m.id),
      warning: fallback ? "No enabled models in the pool; wrote fallback catalog." : undefined,
    };
  });

  app.get("/api/config", async () => ({ config: publicConfig(runtime.config) }));

  app.patch("/api/config", async (req) => {
    const patch = req.body as Record<string, unknown>;
    const previousKey = runtime.config.server.apiKey;
    const merged = { ...runtime.config, ...patch, server: { ...runtime.config.server, ...((patch.server as object) ?? {}) } };
    if (typeof merged.server.apiKey === "string" && merged.server.apiKey.trim() === "") merged.server.apiKey = undefined;
    Object.assign(runtime.config, merged);
    const updated = runtime.config.server.apiKey !== previousKey ? syncConnectedClientKeys(runtime.config) : [];
    saveConfig(runtime.config);
    return { config: publicConfig(runtime.config), updated };
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
