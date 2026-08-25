import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("CLI surface", () => {
  it("lists required commands from --help", () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", "packages/cli/src/index.ts", "--help"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    const out = `${result.stdout}${result.stderr}`;
    for (const token of ["init", "start", "status", "doctor", "account", "setup", "rotate", "client"]) {
      expect(out).toContain(token);
    }
  });
});
