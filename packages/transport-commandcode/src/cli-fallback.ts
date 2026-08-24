import { spawn } from "node:child_process";
import type { AccountCredential, AuthResult } from "@command-go-proxy/shared";

/**
 * Optional CLI fallback for credential checks only.
 * Headless `cmd -p` is an agent loop and is not used for generation.
 */
export async function testCredentialViaCli(account: AccountCredential, timeoutMs = 15_000): Promise<AuthResult> {
  return await new Promise((resolve) => {
    const child = spawn("cmd", ["status"], {
      env: { ...process.env, COMMAND_CODE_API_KEY: account.apiKey },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ ok: false, message: "CLI status timed out" });
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ ok: false, message: "Command Code CLI not installed" });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ ok: true, message: "CLI authentication successful" });
      else if (code === 3) resolve({ ok: false, message: "CLI authentication failed" });
      else resolve({ ok: false, message: redact(stderr || stdout || `CLI exit ${code}`) });
    });
  });
}

function redact(text: string): string {
  return text.replace(/user_[A-Za-z0-9_-]+/g, "user_[redacted]").slice(0, 240);
}
