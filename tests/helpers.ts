import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAppConfig, type AppConfig } from "@command-go-pool/shared";
import { MockTransport } from "@command-go-pool/transport-commandcode";
import { boot } from "@command-go-pool/server";

export function poolHeaders(
  instance: { runtime: { config: { server: { apiKey?: string } } } },
  extra: Record<string, string> = {},
): Record<string, string> {
  const apiKey = instance.runtime.config.server.apiKey;
  return {
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    ...extra,
  };
}

export async function withServer(opts?: {
  setup?: (transport: MockTransport, add: (label: string) => string, instance: Awaited<ReturnType<typeof boot>>) => void;
  config?: Record<string, unknown>;
}) {
  const home = mkdtempSync(join(tmpdir(), "cgp-"));
  process.env.COMMAND_GO_POOL_HOME = home;
  process.env.COMMAND_GO_POOL_MASTER_KEY ??= "z".repeat(32);
  const transport = new MockTransport();
  const raw = opts?.config ?? {};
  const server = { host: "127.0.0.1", port: 0, ...((raw.server as object) ?? {}) };
  const config = parseAppConfig({ ...raw, server }) as AppConfig;
  const instance = await boot({ config, transport, home });
  const add = (label: string) => instance.runtime.pool.add({ label, apiKey: `user_${label}` }).id;
  opts?.setup?.(transport, add, instance);
  await instance.app.ready();
  return { ...instance, home, transport };
}
