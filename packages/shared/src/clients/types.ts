import type { AppConfig } from "../config.js";
import type { OpenCodeModelInput } from "../opencode.js";

export const CLIENT_IDS = ["opencode", "claude"] as const;
export type ClientId = (typeof CLIENT_IDS)[number];

export interface ClientWriteResult {
  id: ClientId;
  ok: boolean;
  file: string;
  message: string;
}

export interface ClientStatus {
  id: ClientId;
  name: string;
  protocol: "openai" | "anthropic";
  installed: boolean;
  connected: boolean;
  configPath: string;
  howToRun?: string;
}

export interface ConnectOptions {
  file?: string;
  fetchImpl?: typeof fetch;
  models?: OpenCodeModelInput[];
  apiKey?: string;
  homedir?: string;
}

export interface DetectEnv {
  homedir?: string;
  path?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}

export interface ClientAdapter {
  id: ClientId;
  name: string;
  protocol: "openai" | "anthropic";
  detect(env?: DetectEnv): Omit<ClientStatus, "connected">;
  connect(config: AppConfig, opts?: ConnectOptions): ClientWriteResult;
  disconnect(config: AppConfig, opts?: ConnectOptions): ClientWriteResult;
  writeKey(config: AppConfig, opts?: ConnectOptions): ClientWriteResult;
}
