const PREFIX = "cgp_";
const BYTE_LENGTH = 24;

export function generatePoolApiKey(): string {
  const bytes = new Uint8Array(BYTE_LENGTH);
  crypto.getRandomValues(bytes);
  return `${PREFIX}${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function isPoolApiKeyFormat(value: string): boolean {
  return new RegExp(`^${PREFIX}[0-9a-f]{${BYTE_LENGTH * 2}}$`).test(value);
}
