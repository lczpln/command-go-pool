import { homedir } from "node:os";
import { mkdirSync, chmodSync, existsSync } from "node:fs";
import { join } from "node:path";

export function dataHome(env: NodeJS.ProcessEnv = process.env): string {
  if (env.COMMAND_GO_PROXY_HOME) return env.COMMAND_GO_PROXY_HOME;
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, "command-go-proxy");
  return join(homedir(), ".command-go-proxy");
}

export function ensureHome(home = dataHome()): string {
  mkdirSync(join(home, "logs"), { recursive: true });
  try {
    chmodSync(home, 0o700);
  } catch {
    /* windows */
  }
  return home;
}

export function paths(home = dataHome()) {
  return {
    home,
    db: join(home, "state.db"),
    config: join(home, "config.yaml"),
    secrets: join(home, "secrets.bin"),
    masterKey: join(home, "master.key"),
    logs: join(home, "logs"),
  };
}

export function existsConfig(home = dataHome()): boolean {
  return existsSync(paths(home).config) || existsSync(paths(home).db);
}
