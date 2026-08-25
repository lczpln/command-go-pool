export const POOL_API_KEY_PREFIX = "cgp_";
export const POOL_API_KEY_BYTES = 24;
export const PLACEHOLDER_CLIENT_KEY = "pool-managed";

export function generatePoolApiKey(): string {
  const bytes = new Uint8Array(POOL_API_KEY_BYTES);
  crypto.getRandomValues(bytes);
  return `${POOL_API_KEY_PREFIX}${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function isPoolApiKeyFormat(value: string): boolean {
  return new RegExp(`^${POOL_API_KEY_PREFIX}[0-9a-f]{${POOL_API_KEY_BYTES * 2}}$`).test(value);
}

export function clientApiKey(apiKey?: string): string {
  return apiKey?.trim() || PLACEHOLDER_CLIENT_KEY;
}

export function ensurePoolApiKey(config: { server: { apiKey?: string } }): boolean {
  const current = config.server.apiKey?.trim();
  if (current) {
    config.server.apiKey = current;
    return false;
  }
  config.server.apiKey = generatePoolApiKey();
  return true;
}
