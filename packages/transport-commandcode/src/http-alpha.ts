/**
 * Isolated Command Code HTTP adapter.
 *
 * Talks to undocumented CLI surfaces (`/alpha/generate`, `/alpha/whoami`,
 * `/alpha/billing/*`) plus the public model catalog. Nothing outside this
 * package should import these URLs or the Vercel AI SDK envelope.
 */
import type {
  AccountCredential,
  AccountStatusSnapshot,
  AuthResult,
  CommandCodeTransport,
  ModelInfo,
  NormalizedChunk,
  NormalizedMessage,
  NormalizedRequest,
  QuotaWindow,
  TokenUsage,
} from "@command-go-pool/shared";
import { classifyUpstreamError, failure } from "@command-go-pool/shared";
import { planById, planByWindowCaps } from "@command-go-pool/quota-engine";

export interface HttpAlphaOptions {
  apiBase: string;
  cliVersion: string;
  timeoutMs: number;
  idleTimeoutMs: number;
  fetchImpl?: typeof fetch;
}

export class HttpAlphaTransport implements CommandCodeTransport {
  constructor(private readonly opts: HttpAlphaOptions) {}

  async listModels(account: AccountCredential): Promise<ModelInfo[]> {
    const res = await this.request(account, "GET", "/provider/v1/models");
    const json = (await res.json()) as { data?: Array<Record<string, unknown>> };
    return (json.data ?? []).map(mapModel);
  }

  async testCredential(account: AccountCredential): Promise<AuthResult> {
    try {
      const res = await this.request(account, "GET", "/alpha/whoami");
      if (!res.ok) {
        const text = await res.text();
        return { ok: false, message: redact(text) || `HTTP ${res.status}` };
      }
      const models = await this.listModels(account).catch(() => []);
      return { ok: true, message: "Authentication successful", models };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Auth failed" };
    }
  }

  async getAccountStatus(account: AccountCredential): Promise<AccountStatusSnapshot> {
    const started = Date.now();
    const timeoutMs = Math.min(this.opts.timeoutMs, 15_000);
    const [whoami, credits, modelsRes] = await Promise.all([
      this.request(account, "GET", "/alpha/whoami", undefined, undefined, timeoutMs),
      this.request(account, "GET", "/alpha/billing/credits", undefined, undefined, timeoutMs).catch(() => undefined),
      this.request(account, "GET", "/provider/v1/models", undefined, undefined, timeoutMs).catch(() => undefined),
    ]);
    const authenticated = whoami.ok;
    let quota = parseCreditsPayload(credits ? await safeJson(credits) : undefined);
    const subs = await this.request(account, "GET", "/alpha/billing/subscriptions", undefined, undefined, timeoutMs).catch(
      () => undefined,
    );
    const sub = parseSubscription(subs ? await safeJson(subs) : undefined);
    quota = enrichMonthlyTotal(quota, sub.planId, sub.periodEnd);
    const modelsJson = modelsRes?.ok ? await safeJson(modelsRes) : undefined;
    const models = Array.isArray((modelsJson as { data?: unknown })?.data)
      ? ((modelsJson as { data: Array<Record<string, unknown>> }).data).map(mapModel)
      : [];
    return { authenticated, models, quota, planId: sub.planId, latencyMs: Date.now() - started };
  }

  async *generate(
    account: AccountCredential,
    request: NormalizedRequest,
    signal?: AbortSignal,
  ): AsyncIterable<NormalizedChunk> {
    const body = buildEnvelope(request);
    const res = await this.request(account, "POST", "/alpha/generate", body, signal);
    if (!res.ok || !res.body) {
      const text = await res.text();
      yield { type: "error", error: classifyUpstreamError({ status: res.status, bodyText: text }) };
      return;
    }
    let idle = this.opts.idleTimeoutMs;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finished = false;
    try {
      while (!finished) {
        const read = idle
          ? await Promise.race([
              reader.read(),
              sleep(idle).then(() => ({ done: true, value: undefined as Uint8Array | undefined, timeout: true })),
            ])
          : await reader.read();
        if ("timeout" in read && read.timeout) {
          yield { type: "error", error: failure("timeout", "Idle timeout waiting for upstream chunks") };
          break;
        }
        const { done, value } = read as { done: boolean; value?: Uint8Array };
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const chunk = parseNdjsonLine(line);
          if (!chunk) continue;
          yield chunk;
          if (chunk.type === "finish" || chunk.type === "error") finished = true;
        }
      }
      if (buffer.trim()) {
        const chunk = parseNdjsonLine(buffer);
        if (chunk) yield chunk;
      }
    } catch (error) {
      const aborted = signal?.aborted || (error instanceof Error && error.name === "AbortError");
      yield {
        type: "error",
        error: classifyUpstreamError({
          aborted,
          name: error instanceof Error ? error.name : undefined,
          bodyText: error instanceof Error ? error.message : String(error),
        }),
      };
    } finally {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
    }
  }

  private async request(
    account: AccountCredential,
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
    timeoutMs = this.opts.timeoutMs,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort);
    try {
      const fetchImpl = this.opts.fetchImpl ?? fetch;
      return await fetchImpl(`${this.opts.apiBase}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${account.apiKey}`,
          "content-type": "application/json",
          "x-cli-environment": "production",
          "x-command-code-version": this.opts.cliVersion,
          "x-session-id": account.accountId,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }
}

export function buildEnvelope(request: NormalizedRequest): Record<string, unknown> {
  const { system, messages } = splitSystem(request);
  return {
    config: {
      workingDir: process.cwd(),
      date: new Date().toISOString().slice(0, 10),
      environment: "production",
      structure: [],
      isGitRepo: false,
      currentBranch: "",
      mainBranch: "",
      gitStatus: "",
      recentCommits: [],
    },
    memory: "",
    taste: null,
    skills: null,
    permissionMode: "standard",
    params: {
      model: request.model,
      system,
      messages: messages.map(toModelMessage),
      tools: (request.tools ?? []).map((tool) => ({
        name: tool.name,
        description: tool.description ?? "",
        input_schema: tool.inputSchema,
      })),
      max_tokens: request.maxTokens ?? 32_000,
      temperature: request.temperature,
      stream: true,
      ...(request.reasoningEffort ? { reasoning_effort: request.reasoningEffort } : {}),
    },
  };
}

function splitSystem(request: NormalizedRequest): { system: string; messages: NormalizedMessage[] } {
  const fromMessages = request.messages.filter((m) => m.role === "system");
  const rest = request.messages.filter((m) => m.role !== "system");
  const system = [request.system, ...fromMessages.map(plainText)].filter(Boolean).join("\n\n");
  return { system, messages: rest };
}

function toModelMessage(message: NormalizedMessage): Record<string, unknown> {
  if (message.role === "tool") {
    return {
      role: "tool",
      content: message.content
        .filter((p) => p.type === "tool-result")
        .map((p) => {
          if (p.type !== "tool-result") return p;
          return {
            type: "tool-result",
            toolCallId: p.id,
            toolName: p.name ?? "tool",
            output: { type: p.isError ? "error-text" : "text", value: p.output },
          };
        }),
    };
  }
  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: message.content.map((part) => {
        if (part.type === "text") return { type: "text", text: part.text };
        if (part.type === "tool-call") {
          return { type: "tool-call", toolCallId: part.id, toolName: part.name, input: part.arguments };
        }
        return { type: "text", text: "" };
      }),
    };
  }
  return {
    role: "user",
    content: message.content.map((part) => {
      if (part.type === "text") return { type: "text", text: part.text };
      if (part.type === "image") {
        const image = part.base64
          ? `data:${part.mediaType};base64,${part.base64}`
          : part.url ?? "";
        return { type: "image", image, mediaType: part.mediaType };
      }
      return { type: "text", text: "" };
    }),
  };
}

export function parseNdjsonLine(line: string): NormalizedChunk | undefined {
  const trimmed = line.trim().replace(/^data:\s*/, "");
  if (!trimmed || trimmed === "[DONE]") return undefined;
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const type = String(event.type ?? "");
  if (type === "text-delta") return { type: "text-delta", text: String(event.text ?? event.delta ?? "") };
  if (type === "reasoning-delta") return { type: "reasoning-delta", text: String(event.text ?? event.delta ?? "") };
  if (type === "tool-input-delta") {
    return {
      type: "tool-call-delta",
      id: String(event.id ?? event.toolCallId ?? ""),
      name: String(event.toolName ?? event.name ?? ""),
      argumentsDelta: String(event.delta ?? event.text ?? ""),
    };
  }
  if (type === "tool-input-start") {
    return {
      type: "tool-call-delta",
      id: String(event.id ?? ""),
      name: String(event.toolName ?? ""),
      argumentsDelta: "",
    };
  }
  if (type === "tool-call") {
    return {
      type: "tool-call",
      id: String(event.toolCallId ?? event.id ?? ""),
      name: String(event.toolName ?? event.name ?? ""),
      arguments: event.input ?? event.args ?? event.arguments ?? {},
    };
  }
  if (type === "finish" || type === "finish-step") {
    const usage = mapUsage((event.usage ?? event.totalUsage) as Record<string, unknown> | undefined, event.providerMetadata as Record<string, unknown> | undefined);
    const reason = mapFinish(String(event.finishReason ?? event.rawFinishReason ?? "stop"));
    return { type: "finish", reason, usage };
  }
  if (type === "error") {
    const nested = event.error;
    const message =
      typeof nested === "string"
        ? nested
        : nested && typeof nested === "object"
          ? String((nested as { message?: string }).message ?? JSON.stringify(nested))
          : String(event.message ?? "Upstream error");
    return { type: "error", error: classifyUpstreamError({ bodyText: message, status: Number((nested as { status?: number })?.status) || undefined }) };
  }
  return undefined;
}

function mapUsage(usage?: Record<string, unknown>, meta?: Record<string, unknown>): TokenUsage | undefined {
  if (!usage && !meta) return undefined;
  const details = (usage?.inputTokenDetails as Record<string, unknown> | undefined) ?? {};
  const cacheRead =
    num(usage?.cachedInputTokens) ?? num(details.cacheReadTokens) ?? num((usage?.raw as Record<string, unknown> | undefined)?.prompt_cache_hit_tokens);
  const inputTotal = num(usage?.inputTokens);
  const uncached = inputTotal !== undefined && cacheRead !== undefined ? Math.max(0, inputTotal - cacheRead) : inputTotal;
  const gateway = (meta?.gateway as Record<string, unknown> | undefined) ?? {};
  const cost = num(gateway.cost) ?? num(gateway.inferenceCost);
  return {
    inputTokens: uncached,
    cacheReadTokens: cacheRead,
    outputTokens: num(usage?.outputTokens),
    reasoningTokens: num(usage?.reasoningTokens) ?? num((usage?.outputTokenDetails as Record<string, unknown> | undefined)?.reasoningTokens),
    estimatedCost: cost,
    costSource: cost !== undefined ? "upstream" : undefined,
  };
}

function mapFinish(reason: string): "stop" | "length" | "tool-calls" | "cancelled" | "error" {
  if (reason.includes("tool")) return "tool-calls";
  if (reason.includes("length") || reason.includes("max")) return "length";
  if (reason.includes("cancel")) return "cancelled";
  if (reason.includes("error")) return "error";
  return "stop";
}

export function parseCreditsPayload(payload: unknown): AccountStatusSnapshot["quota"] {
  if (!payload || typeof payload !== "object") {
    return {
      fiveHour: unknownWindow(),
      weekly: unknownWindow(),
      monthly: unknownWindow(),
    };
  }
  const root = payload as Record<string, unknown>;
  const credits = (root.credits as Record<string, unknown> | undefined) ?? root;
  const limits = (root.windowLimits as Record<string, unknown> | undefined) ?? (credits.windowLimits as Record<string, unknown> | undefined);
  const monthlyRemaining = num(credits.monthlyCredits);
  return {
    fiveHour: parseLimitWindow(limits, ["fiveHour", "five_hour", "five-hour", "5h"]),
    weekly: parseLimitWindow(limits, ["weekly", "week"]),
    monthly:
      monthlyRemaining === undefined
        ? unknownWindow()
        : {
            remaining: monthlyRemaining,
            source: "upstream",
            confidence: "exact",
          },
  };
}

function parseLimitWindow(limits: Record<string, unknown> | undefined, keys: string[]): QuotaWindow {
  if (!limits) return unknownWindow();
  for (const key of Object.keys(limits)) {
    if (!keys.some((k) => key.toLowerCase().replace(/[^a-z0-9]/g, "").includes(k.replace(/[^a-z0-9]/g, "")))) continue;
    const node = limits[key];
    if (!node || typeof node !== "object") continue;
    const w = node as Record<string, unknown>;
    const total = num(w.total) ?? num(w.limit) ?? num(w.cap);
    const used = num(w.used) ?? (total !== undefined ? 0 : undefined);
    const remaining = num(w.remaining) ?? (total !== undefined && used !== undefined ? Math.max(0, total - used) : undefined);
    const usedPercent =
      num(w.usedPercent) ?? num(w.used_percent) ?? (total && used !== undefined ? (used / total) * 100 : undefined);
    const remainingPercent =
      num(w.remainingPercent) ??
      num(w.remaining_percent) ??
      (total && remaining !== undefined ? (remaining / total) * 100 : undefined);
    const resetRaw = w.resetAt ?? w.resetsAt ?? w.reset_at;
    let resetAt: Date | undefined;
    if (typeof resetRaw === "number" && resetRaw > 0) resetAt = new Date(resetRaw > 10_000_000_000 ? resetRaw : resetRaw * 1000);
    if (typeof resetRaw === "string") resetAt = new Date(resetRaw);
    return {
      used,
      remaining,
      total,
      usedPercent,
      remainingPercent,
      resetAt,
      source: "upstream",
      confidence: "exact",
    };
  }
  return unknownWindow();
}

function enrichMonthlyTotal(quota: AccountStatusSnapshot["quota"], planId?: string, periodEnd?: Date): AccountStatusSnapshot["quota"] {
  const named = planById(planId);
  const fromWindows = planByWindowCaps(quota.fiveHour?.total, quota.weekly?.total);
  const remaining = quota.monthly?.remaining;
  const namedFits = named && remaining !== undefined ? remaining <= named.monthlyCredits + 0.01 : Boolean(named);
  const plan = (namedFits ? named : undefined) ?? fromWindows ?? named;
  let monthly = quota.monthly;
  if (plan && monthly && remaining !== undefined && remaining <= plan.monthlyCredits + 0.01) {
    monthly = {
      ...monthly,
      total: plan.monthlyCredits,
      used: Math.max(0, plan.monthlyCredits - remaining),
      usedPercent: ((plan.monthlyCredits - remaining) / plan.monthlyCredits) * 100,
      remainingPercent: (remaining / plan.monthlyCredits) * 100,
      source: "upstream",
      confidence: "exact",
    };
  }
  if (monthly && periodEnd) monthly = { ...monthly, resetAt: periodEnd };
  if (!plan) return { ...quota, monthly };
  return {
    ...quota,
    monthly,
    fiveHour: fillCap(quota.fiveHour, plan.fiveHour),
    weekly: fillCap(quota.weekly, plan.weekly),
  };
}

function fillCap(window: QuotaWindow | undefined, cap: number): QuotaWindow | undefined {
  if (!window || window.confidence === "unknown") return window;
  if (window.total) return window;
  if (window.usedPercent !== undefined) {
    return { ...window, total: cap, used: (window.usedPercent / 100) * cap, remaining: cap * (1 - window.usedPercent / 100) };
  }
  return window;
}

function unknownWindow(): QuotaWindow {
  return { source: "unknown", confidence: "unknown" };
}

function parseSubscription(payload: unknown): { planId?: string; periodEnd?: Date } {
  if (!payload || typeof payload !== "object") return {};
  const root = payload as Record<string, unknown>;
  const nodes: Record<string, unknown>[] = [];
  const push = (value: unknown) => {
    if (value && typeof value === "object" && !Array.isArray(value)) nodes.push(value as Record<string, unknown>);
  };
  push(root);
  push(root.data);
  push(root.subscription);
  if (Array.isArray(root.data)) push(root.data[0]);
  if (root.data && typeof root.data === "object" && !Array.isArray(root.data)) {
    const data = root.data as Record<string, unknown>;
    push(data.plan);
    push(data.subscription);
  }
  let planId: string | undefined;
  let periodEnd: Date | undefined;
  for (const node of nodes) {
    const raw = node.planId ?? node.plan_id ?? node.plan;
    if (!planId && typeof raw === "string" && raw.trim()) planId = raw;
    if (!planId && raw && typeof raw === "object") {
      const nested = raw as Record<string, unknown>;
      const id = nested.id ?? nested.planId ?? nested.name;
      if (typeof id === "string" && id.trim()) planId = id;
    }
    periodEnd ??= parseDate(node.currentPeriodEnd ?? node.current_period_end ?? node.periodEnd ?? node.renewsAt);
  }
  return { planId, periodEnd };
}

function parseDate(value: unknown): Date | undefined {
  if (typeof value === "number" && value > 0) return new Date(value > 10_000_000_000 ? value : value * 1000);
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return undefined;
}

function mapModel(row: Record<string, unknown>): ModelInfo {
  const id = String(row.id ?? row.name ?? "unknown");
  return {
    id,
    name: String(row.name ?? id),
    ownedBy: typeof row.owned_by === "string" ? row.owned_by : id.split("/")[0],
    contextWindow: num(row.context_window) ?? num((row.limits as Record<string, unknown> | undefined)?.max_tokens),
    vision: Boolean(row.vision ?? (row.capabilities as Record<string, unknown> | undefined)?.vision),
    reasoning: Boolean(row.reasoning),
  };
}

function plainText(message: NormalizedMessage): string {
  return message.content.filter((p) => p.type === "text").map((p) => (p.type === "text" ? p.text : "")).join("\n");
}

function redact(text: string): string {
  return text.replace(/user_[A-Za-z0-9_-]+/g, "user_[redacted]").replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) return Number(value);
  return undefined;
}

async function safeJson(res: Response): Promise<unknown> {
  if (!res.ok) return undefined;
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
