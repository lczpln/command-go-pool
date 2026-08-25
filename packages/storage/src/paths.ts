import { homedir } from "node:os";
import { mkdirSync, chmodSync, existsSync } from "node:fs";
import { join } from "node:path";

function preferExisting(next: string, legacy: string): string {
  if (!existsSync(next) && existsSync(legacy)) return legacy;
  return next;
}

export function dataHome(env: NodeJS.ProcessEnv = process.env): string {
  if (env.COMMAND_GO_POOL_HOME) return env.COMMAND_GO_POOL_HOME;
  if (env.XDG_CONFIG_HOME) {
    return preferExisting(
      join(env.XDG_CONFIG_HOME, "command-go-pool"),
      join(env.XDG_CONFIG_HOME, "command-go-proxy"),
    );
  }
  return preferExisting(join(homedir(), ".command-go-pool"), join(homedir(), ".command-go-proxy"));
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
