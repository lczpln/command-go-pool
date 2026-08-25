import { describe, expect, it } from "vitest";
import { generatePoolApiKey, isPoolApiKeyFormat } from "../../apps/dashboard/src/utils/poolKey.js";

describe("pool API key", () => {
  it("generates a unique cgp_ key", () => {
    const first = generatePoolApiKey();
    const second = generatePoolApiKey();
    expect(isPoolApiKeyFormat(first)).toBe(true);
    expect(isPoolApiKeyFormat(second)).toBe(true);
    expect(first).not.toBe(second);
  });
});
