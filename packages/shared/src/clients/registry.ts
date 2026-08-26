import { generatePoolApiKey } from "../pool-key.js";
import type { AppConfig } from "../config.js";
import { claudeAdapter } from "./claude.js";
import { connectOpenCodeWithModels, opencodeAdapter } from "./opencode.js";
import type { ClientAdapter, ClientId, ClientStatus, ClientWriteResult, ConnectOptions } from "./types.js";
import { CLIENT_IDS } from "./types.js";

const adapters: Record<ClientId, ClientAdapter> = {
  opencode: opencodeAdapter,
  claude: claudeAdapter,
};

export function getClientAdapter(id: string): ClientAdapter | undefined {
  return adapters[id as ClientId];
}

export function listClientAdapters(): ClientAdapter[] {
  return CLIENT_IDS.map((id) => adapters[id]);
}

export function isClientId(id: string): id is ClientId {
  return CLIENT_IDS.includes(id as ClientId);
}

export function listClientStatuses(config: AppConfig): ClientStatus[] {
  const connected = config.clients?.connected ?? {};
  return listClientAdapters().map((adapter) => {
    const detected = adapter.detect();
    const file = connected[adapter.id]?.file;
    const configPath = file ?? detected.configPath;
    return {
      ...detected,
      connected: Boolean(connected[adapter.id]),
      configPath,
      howToRun: detected.howToRun ? detected.howToRun.replace(detected.configPath, configPath) : detected.howToRun,
    };
  });
}

function withConnected(config: AppConfig, id: ClientId, file: string | undefined): AppConfig {
  const next = structuredClone(config);
  next.clients = next.clients ?? { onboarded: false, connected: {} };
  next.clients.onboarded = true;
  next.clients.connected = next.clients.connected ?? {};
  if (file) next.clients.connected[id] = { file };
  else delete next.clients.connected[id];
  return next;
}

export function markClientsOnboarded(config: AppConfig): AppConfig {
  const next = structuredClone(config);
  next.clients = next.clients ?? { onboarded: false, connected: {} };
  next.clients.onboarded = true;
  return next;
}

export async function connectClient(
  id: string,
  config: AppConfig,
  opts: ConnectOptions = {},
): Promise<{ config: AppConfig; result: ClientWriteResult }> {
  if (!isClientId(id)) {
    return { config, result: { id: "opencode", ok: false, file: "", message: `Unknown client ${id}` } };
  }
  const adapter = adapters[id];
  const result = id === "opencode" ? await connectOpenCodeWithModels(config, opts) : adapter.connect(config, opts);
  return { config: withConnected(config, id, result.ok ? result.file : undefined), result };
}

export function disconnectClient(
  id: string,
  config: AppConfig,
  opts: ConnectOptions = {},
): { config: AppConfig; result: ClientWriteResult } {
  if (!isClientId(id)) {
    return { config, result: { id: "opencode", ok: false, file: "", message: `Unknown client ${id}` } };
  }
  const result = adapters[id].disconnect(config, opts);
  return { config: withConnected(config, id, undefined), result };
}

export async function syncConnectedClients(config: AppConfig, opts: ConnectOptions = {}): Promise<ClientWriteResult[]> {
  const results: ClientWriteResult[] = [];
  for (const [id, entry] of Object.entries(config.clients?.connected ?? {})) {
    if (!isClientId(id)) continue;
    const { result } = await connectClient(id, config, { ...opts, file: entry?.file });
    results.push(result);
  }
  return results;
}

export function syncConnectedClientKeys(config: AppConfig, apiKey?: string): ClientWriteResult[] {
  const updated: ClientWriteResult[] = [];
  for (const id of Object.keys(config.clients?.connected ?? {})) {
    if (!isClientId(id)) continue;
    const file = config.clients.connected[id]?.file;
    updated.push(adapters[id].writeKey(config, { file, apiKey: apiKey ?? config.server.apiKey }));
  }
  return updated;
}

export function rotatePoolApiKey(config: AppConfig): {
  config: AppConfig;
  apiKey: string;
  updated: ClientWriteResult[];
} {
  const apiKey = generatePoolApiKey();
  const next = structuredClone(config);
  next.server.apiKey = apiKey;
  const updated = syncConnectedClientKeys(next, apiKey);
  return { config: next, apiKey, updated };
}
