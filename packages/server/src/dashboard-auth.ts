import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { dashboardPassword } from "@command-go-pool/shared";

export const DASHBOARD_COOKIE = "cgp_dash";
export const DASHBOARD_COOKIE_MAX_AGE_SEC = 7 * 24 * 60 * 60;
export const LOGIN_FAIL_DELAY_MS = 50;
export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export function safeEqual(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

function signingKey(password: string, env: NodeJS.ProcessEnv = process.env): Buffer {
  return createHmac("sha256", password).update(env.COMMAND_GO_POOL_MASTER_KEY ?? "cgp-dashboard").digest();
}

export function signDashboardCookie(password: string, now = Date.now(), env: NodeJS.ProcessEnv = process.env): string {
  const exp = Math.floor(now / 1000) + DASHBOARD_COOKIE_MAX_AGE_SEC;
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  const sig = createHmac("sha256", signingKey(password, env)).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyDashboardCookie(
  token: string | undefined,
  password: string | undefined,
  now = Date.now(),
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!token || !password) return false;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!payload || !sig) return false;
  const expected = createHmac("sha256", signingKey(password, env)).update(payload).digest("base64url");
  if (!safeEqual(sig, expected)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: unknown };
    return typeof parsed.exp === "number" && parsed.exp * 1000 > now;
  } catch {
    return false;
  }
}

export function readCookie(header: string | string[] | undefined, name = DASHBOARD_COOKIE): string | undefined {
  const raw = Array.isArray(header) ? header.join("; ") : header;
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return undefined;
}

export function dashboardSessionCookie(value: string, secure: boolean): string {
  const parts = [`${DASHBOARD_COOKIE}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${DASHBOARD_COOKIE_MAX_AGE_SEC}`];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearDashboardCookie(secure: boolean): string {
  const parts = [`${DASHBOARD_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function requestIsSecure(protocol: string, forwardedProto?: string | string[]): boolean {
  const forwarded = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  const proto = forwarded?.split(",")[0]?.trim().toLowerCase() || protocol;
  return proto === "https";
}

export class LoginLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max = LOGIN_MAX_ATTEMPTS,
    private readonly windowMs = LOGIN_WINDOW_MS,
  ) {}

  check(ip: string, now = Date.now()): "ok" | "limited" {
    const bucket = this.buckets.get(ip);
    if (!bucket || now >= bucket.resetAt) return "ok";
    return bucket.count >= this.max ? "limited" : "ok";
  }

  fail(ip: string, now = Date.now()): void {
    const bucket = this.buckets.get(ip);
    if (!bucket || now >= bucket.resetAt) {
      this.buckets.set(ip, { count: 1, resetAt: now + this.windowMs });
      return;
    }
    bucket.count += 1;
  }

  succeed(ip: string): void {
    this.buckets.delete(ip);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export { dashboardPassword };
