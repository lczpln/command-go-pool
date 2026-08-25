import { accessSync, constants, copyFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import type { AppConfig } from "../config.js";
import type { DetectEnv } from "./types.js";

export function resolveHome(env?: DetectEnv): string {
  return env?.homedir ?? env?.env?.HOME ?? homedir();
}

export function binaryOnPath(name: string, env?: DetectEnv): boolean {
  const platform = env?.platform ?? process.platform;
  const pathValue = env?.path ?? env?.env?.PATH ?? process.env.PATH ?? "";
  const names = platform === "win32" ? [`${name}.exe`, name] : [name];
  for (const dir of pathValue.split(delimiter)) {
    for (const bin of names) {
      try {
        accessSync(join(dir, bin), constants.X_OK);
        return true;
      } catch {
        /* keep looking */
      }
    }
  }
  return false;
}

export function backupFile(file: string): string | undefined {
  if (!existsSync(file)) return undefined;
  const backup = `${file}.bak.${Date.now()}`;
  copyFileSync(file, backup);
  return backup;
}

export function loopbackHost(host: string): string {
  return host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
}

export function poolOrigin(config: AppConfig): string {
  return `http://${loopbackHost(config.server.host)}:${config.server.port}`;
}

export function poolOpenAiUrl(config: AppConfig): string {
  return `${poolOrigin(config)}/v1`;
}

export function connectedFile(config: AppConfig, id: string, fallback: string): string {
  return config.clients.connected[id]?.file ?? fallback;
}
