import { z } from "zod";
import { DEFAULT_HOST, DEFAULT_PORT, DEFAULT_MAX_FAILOVERS, DEFAULT_QUOTA_REFRESH_SECONDS, DEFAULT_SESSION_TTL_HOURS } from "./constants.js";

export const routingModeSchema = z.enum(["sticky", "balanced", "most-available", "round-robin"]);

export const appConfigSchema = z.object({
  server: z
    .object({
      host: z.string().default(DEFAULT_HOST),
      port: z.number().int().min(0).default(DEFAULT_PORT),
      apiKey: z.string().optional(),
    })
    .default({}),
  routing: z
    .object({
      mode: routingModeSchema.default("sticky"),
      sessionTtlHours: z.number().positive().default(DEFAULT_SESSION_TTL_HOURS),
      maxFailoversPerRequest: z.number().int().min(0).max(8).default(DEFAULT_MAX_FAILOVERS),
      loadWeight: z.number().default(0.04),
    })
    .default({}),
  quota: z
    .object({
      refreshIntervalSeconds: z.number().positive().default(DEFAULT_QUOTA_REFRESH_SECONDS),
    })
    .default({}),
  dashboard: z
    .object({
      enabled: z.boolean().default(true),
    })
    .default({}),
  transport: z
    .object({
      apiBase: z.string().url().default("https://api.commandcode.ai"),
      cliVersion: z.string().default("0.52.1"),
      timeoutMs: z.number().int().positive().default(600_000),
      idleTimeoutMs: z.number().int().nonnegative().default(120_000),
    })
    .default({}),
  aliases: z.record(z.string()).default({
    flash: "deepseek/deepseek-v4-flash",
    vision: "deepseek/deepseek-v4-flash-vision-exp",
    pro: "deepseek/deepseek-v4-pro",
  }),
  models: z
    .object({
      disabled: z.array(z.string()).default([]),
    })
    .default({}),
  fallback: z
    .object({
      enabled: z.boolean().default(false),
      baseUrl: z.string().optional(),
      apiKey: z.string().optional(),
      modelMap: z.record(z.string()).default({}),
    })
    .default({ enabled: false }),
  clients: z
    .object({
      onboarded: z.boolean().default(false),
      connected: z
        .record(
          z.object({
            file: z.string(),
          }),
        )
        .default({}),
    })
    .default({}),
});

export type AppConfig = z.infer<typeof appConfigSchema>;

export function parseAppConfig(raw: unknown): AppConfig {
  return appConfigSchema.parse(raw ?? {});
}

export function applyEnvOverrides(config: AppConfig, env: NodeJS.ProcessEnv = process.env): AppConfig {
  const next = structuredClone(config);
  if (env.COMMAND_GO_POOL_HOST) next.server.host = env.COMMAND_GO_POOL_HOST;
  if (env.COMMAND_GO_POOL_PORT) next.server.port = Number(env.COMMAND_GO_POOL_PORT);
  if (env.COMMAND_GO_POOL_API_KEY) next.server.apiKey = env.COMMAND_GO_POOL_API_KEY;
  if (env.COMMAND_GO_POOL_LOG_LEVEL) {
    /* consumed by logger */
  }
  return next;
}

export function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

export function clientHost(host: string): string {
  return host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
}
