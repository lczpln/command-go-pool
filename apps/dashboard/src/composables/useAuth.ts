import { reactive } from "vue";

export interface AuthStatus {
  required: boolean;
  authenticated: boolean;
  ready: boolean;
}

export const auth = reactive<AuthStatus>({
  required: false,
  authenticated: true,
  ready: false,
});

function errorMessage(res: Response, body: { error?: string | { message?: string } }): string {
  const error = body.error;
  if (typeof error === "string") return error;
  return error?.message ?? `${res.status} ${res.url}`;
}

export async function fetchAuthStatus(): Promise<AuthStatus> {
  const res = await fetch("/api/auth/status");
  const body = (await res.json().catch(() => ({}))) as { required?: boolean; authenticated?: boolean };
  auth.required = Boolean(body.required);
  auth.authenticated = body.authenticated !== false;
  auth.ready = true;
  return auth;
}

export async function login(password: string): Promise<void> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string | { message?: string } };
    throw new Error(errorMessage(res, body));
  }
  auth.required = true;
  auth.authenticated = true;
  auth.ready = true;
}

export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
  auth.authenticated = false;
}

export function useAuth() {
  return auth;
}
