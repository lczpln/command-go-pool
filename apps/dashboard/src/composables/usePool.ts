import { reactive, onMounted, onUnmounted } from "vue";

export interface QuotaWindow {
  used?: number;
  remaining?: number;
  total?: number;
  usedPercent?: number;
  remainingPercent?: number;
  resetAt?: string;
  source: string;
  confidence: string;
}

export interface Account {
  id: string;
  label: string;
  enabled: boolean;
  status: string;
  healthScore: number;
  activeSessionCount: number;
  monthlySubscriptionCost?: number;
  cooldownUntil?: string;
  cooldownReason?: string;
  quota: {
    fiveHour?: QuotaWindow;
    weekly?: QuotaWindow;
    monthly?: QuotaWindow;
  };
  models?: string[];
  stats?: {
    requests: number;
    cacheHit?: number;
    todayCost?: number;
  };
}

export interface Session {
  id: string;
  accountId: string;
  model: string;
  createdAt: string;
  lastRequestAt: string;
  requests: number;
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  estimatedCost?: number;
  migrations: number;
}

export interface CatalogModel {
  id: string;
  enabled: boolean;
  accountIds: string[];
  aliasOf?: string;
}

export interface PoolClient {
  id: string;
  name: string;
  protocol: string;
  installed: boolean;
  connected: boolean;
  configPath: string;
  howToRun?: string;
}

export const store = reactive({
  overview: null as null | Record<string, unknown>,
  accounts: [] as Account[],
  sessions: [] as Session[],
  usage: null as null | Record<string, unknown>,
  events: [] as Array<{ id: number; at: string; level: string; category: string; type: string; payload: Record<string, unknown> }>,
  config: null as null | Record<string, unknown>,
  models: [] as CatalogModel[],
  clients: [] as PoolClient[],
  connected: false,
  ready: false,
});

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string | { message?: string } };
    const message = typeof body.error === "string" ? body.error : body.error?.message ?? `${res.status} ${path}`;
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export async function patchAccount(id: string, body: { enabled?: boolean; label?: string; credential?: string; monthlySubscriptionCost?: number }) {
  await json(`/api/accounts/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  await refreshAll();
}

export async function addAccount(input: { label: string; credential: string; monthlySubscriptionCost?: number }) {
  const result = await json<{ account: Account; test: { ok: boolean; message: string } }>("/api/accounts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  await refreshAll();
  return result;
}

export async function removeAccount(id: string) {
  await json(`/api/accounts/${id}`, { method: "DELETE" });
  await refreshAll();
}

export async function testAccount(id: string) {
  const result = await json<{ ok: boolean; message: string }>(`/api/accounts/${id}/test`, { method: "POST" });
  await refreshAll();
  return result;
}

export async function savePoolApiKey(apiKey: string) {
  await json("/api/config", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ server: { apiKey: apiKey || undefined } }),
  });
  await refreshAll();
}

export async function rotatePoolApiKey() {
  const result = await json<{ apiKey: string; updated: Array<{ id: string; ok: boolean; file: string; message: string }> }>("/api/key/rotate", {
    method: "POST",
  });
  await refreshAll();
  return result;
}

export async function connectClient(id: string) {
  const result = await json<{ ok: boolean; file: string; message: string; warning?: string }>(`/api/clients/${id}/connect`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  await refreshAll();
  return result;
}

export async function disconnectClient(id: string) {
  const result = await json<{ ok: boolean; file: string; message: string }>(`/api/clients/${id}/disconnect`, { method: "POST" });
  await refreshAll();
  return result;
}

export async function patchModel(id: string, body: { enabled: boolean }) {
  await json("/api/models", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, ...body }),
  });
  await refreshAll();
}

export async function syncOpenCode() {
  const result = await json<{ ok: boolean; file: string; message: string; models: string[]; warning?: string }>("/api/setup/opencode", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  return result;
}

export async function fetchUsage(filter?: { accountId?: string; model?: string; sessionId?: string }) {
  const qs = new URLSearchParams();
  if (filter?.accountId) qs.set("account", filter.accountId);
  if (filter?.model) qs.set("model", filter.model);
  if (filter?.sessionId) qs.set("session", filter.sessionId);
  const suffix = qs.size ? `?${qs}` : "";
  return json<Record<string, unknown>>(`/api/usage${suffix}`);
}

export async function refreshAll() {
  const [health, accounts, sessions, usage, events, config, models, clients] = await Promise.all([
    json<Record<string, unknown>>("/api/health"),
    json<{ accounts: Account[] }>("/api/accounts"),
    json<{ sessions: Session[] }>("/api/sessions"),
    json<Record<string, unknown>>("/api/usage"),
    json<{ events: typeof store.events }>("/api/events"),
    json<{ config: Record<string, unknown> }>("/api/config"),
    json<{ models: CatalogModel[] }>("/api/models"),
    json<{ clients: PoolClient[] }>("/api/clients"),
  ]);
  store.overview = health;
  store.accounts = accounts.accounts;
  store.sessions = sessions.sessions;
  store.usage = usage;
  store.events = events.events;
  store.config = config.config;
  store.models = models.models;
  store.clients = clients.clients;
  store.ready = true;
}

export function useLive() {
  let es: EventSource | undefined;
  onMounted(async () => {
    await refreshAll().catch(() => undefined);
    store.ready = true;
    es = new EventSource("/api/events/stream");
    es.onopen = () => {
      store.connected = true;
    };
    es.onerror = () => {
      store.connected = false;
    };
    const bump = () => {
      void refreshAll();
    };
    for (const name of ["account.updated", "account.cooldown", "account.recovered", "session.started", "session.migrated", "session.ended", "usage.updated", "pool.error", "models.updated", "clients.updated", "hello"]) {
      es.addEventListener(name, bump);
    }
  });
  onUnmounted(() => es?.close());
}
