import { describe, expect, it } from "vitest";
import { ensurePoolApiKey, generatePoolApiKey, isPoolApiKeyFormat, parseAppConfig } from "@command-go-pool/shared";

describe("pool API key", () => {
  it("generates a unique cgp_ key", () => {
    const first = generatePoolApiKey();
    const second = generatePoolApiKey();
    expect(isPoolApiKeyFormat(first)).toBe(true);
    expect(isPoolApiKeyFormat(second)).toBe(true);
    expect(first).not.toBe(second);
  });

  it("issues a key when missing and keeps an existing one", () => {
    const fresh = parseAppConfig({});
    expect(ensurePoolApiKey(fresh)).toBe(true);
    expect(isPoolApiKeyFormat(fresh.server.apiKey ?? "")).toBe(true);
    const issued = fresh.server.apiKey;
    expect(ensurePoolApiKey(fresh)).toBe(false);
    expect(fresh.server.apiKey).toBe(issued);

    const custom = parseAppConfig({ server: { apiKey: "custom-pool-secret" } });
    expect(ensurePoolApiKey(custom)).toBe(false);
    expect(custom.server.apiKey).toBe("custom-pool-secret");
  });
});
