import { existsSync } from "node:fs";
import { writeClaudeConfig, claudeSettingsPath, type ClaudeModelInput } from "./claude.js";
import { openCodeConfigPath, writeOpenCodeConfig, type OpenCodeModelInput } from "./opencode.js";

export type ClientId = "opencode" | "claude";

export interface ClientTarget {
  id: ClientId;
  name: string;
  file: string;
  connected: boolean;
}

export interface ClientSyncResult extends ClientTarget {
  ok: boolean;
  synced: boolean;
  message?: string;
}

export interface ClientPaths {
  opencode?: string;
  claude?: string;
}

export interface ListClientOptions {
  home: string;
  paths?: ClientPaths;
  env?: NodeJS.ProcessEnv;
}

export interface SyncClientOptions extends ListClientOptions {
  origin: string;
  apiKey?: string;
  models: Array<OpenCodeModelInput & ClaudeModelInput>;
}

const CLIENT_NAMES: Record<ClientId, string> = {
  opencode: "OpenCode",
  claude: "Claude Code",
};

export function listClientTargets(opts: ListClientOptions): ClientTarget[] {
  const env = opts.env ?? process.env;
  const opencode = opts.paths?.opencode?.trim() || openCodeConfigPath(env);
  const claude = opts.paths?.claude?.trim() || claudeSettingsPath(opts.home);
  return [
    { id: "opencode", name: CLIENT_NAMES.opencode, file: opencode, connected: existsSync(opencode) },
    { id: "claude", name: CLIENT_NAMES.claude, file: claude, connected: existsSync(claude) },
  ];
}

export function syncConnectedClients(opts: SyncClientOptions): {
  clients: ClientSyncResult[];
  synced: ClientSyncResult[];
} {
  const origin = opts.origin.replace(/\/$/, "");
  const clients = listClientTargets(opts).map((target) => syncOneClient(target, origin, opts));
  return { clients, synced: clients.filter((client) => client.synced) };
}

function syncOneClient(target: ClientTarget, origin: string, opts: SyncClientOptions): ClientSyncResult {
  if (!target.connected) {
    return { ...target, ok: true, synced: false };
  }
  try {
    const message =
      target.id === "opencode"
        ? writeOpenCodeConfig({
            baseUrl: `${origin}/v1`,
            file: target.file,
            models: opts.models,
            apiKey: opts.apiKey,
          })
        : writeClaudeConfig({
            origin,
            file: target.file,
            apiKey: opts.apiKey ?? "",
            models: opts.models,
          });
    return { ...target, ok: true, synced: true, message };
  } catch (error) {
    return {
      ...target,
      ok: false,
      synced: false,
      message: error instanceof Error ? error.message : "Sync failed",
    };
  }
}
