import { describe, expect, it } from "vitest";
import { mergeQuota } from "@command-go-pool/server";

describe("mergeQuota", () => {
  it("keeps previous exact windows when incoming data is unknown", () => {
    const merged = mergeQuota(
      {
        fiveHour: { remainingPercent: 42, source: "upstream", confidence: "exact" },
      },
      {
        fiveHour: { source: "unknown", confidence: "unknown" },
        weekly: { remainingPercent: 70, source: "upstream", confidence: "exact" },
      },
    );
    expect(merged.fiveHour?.remainingPercent).toBe(42);
    expect(merged.weekly?.remainingPercent).toBe(70);
  });
});
