export function generatePoolApiKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return `cgp_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function isPoolApiKeyFormat(value: string): boolean {
  return /^cgp_[0-9a-f]{48}$/.test(value);
}
