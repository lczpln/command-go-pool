import { describe, expect, it } from "vitest";
import { hasBreakdown, pointIndexFromX, pointTotal } from "../../apps/dashboard/src/utils/chart.js";
import { formatMoney, formatTokens } from "../../apps/dashboard/src/utils/format.js";

describe("chart pointer", () => {
  const rect = { left: 100, width: 200 };

  it("maps x to a bucket", () => {
    expect(pointIndexFromX(100, rect, 4)).toBe(0);
    expect(pointIndexFromX(149, rect, 4)).toBe(0);
    expect(pointIndexFromX(150, rect, 4)).toBe(1);
    expect(pointIndexFromX(299, rect, 4)).toBe(3);
  });

  it("clamps outside the chart", () => {
    expect(pointIndexFromX(0, rect, 4)).toBe(0);
    expect(pointIndexFromX(400, rect, 4)).toBe(3);
  });

  it("returns null for empty series", () => {
    expect(pointIndexFromX(150, rect, 0)).toBeNull();
  });
});

describe("token layers", () => {
  it("sums cache, uncached input, and output", () => {
    const point = { t: 0, tokens: 80, cache: 50, input: 30, output: 20 };
    expect(hasBreakdown(point)).toBe(true);
    expect(pointTotal(point)).toBe(100);
  });

  it("falls back to tokens when the breakdown is missing", () => {
    const point = { t: 0, tokens: 40 };
    expect(hasBreakdown(point)).toBe(false);
    expect(pointTotal(point)).toBe(40);
  });
});

describe("usage formatters", () => {
  it("shortens token counts", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1000)).toBe("1k");
    expect(formatTokens(10_000)).toBe("10k");
    expect(formatTokens(10_920)).toBe("10.92k");
    expect(formatTokens(150_200)).toBe("150.2k");
    expect(formatTokens(1_000_000)).toBe("1M");
    expect(formatTokens(1_220_000)).toBe("1.22M");
    expect(formatTokens(11_100_000)).toBe("11.1M");
    expect(formatTokens(23_900_000)).toBe("23.9M");
  });

  it("formats estimated money", () => {
    expect(formatMoney(undefined)).toBe("—");
    expect(formatMoney(1.73)).toBe("~$1.73");
    expect(formatMoney(0.04)).toBe("~$0.04");
    expect(formatMoney(0.0012)).toBe("~$0.0012");
    expect(formatMoney(0.00004)).toBe("~$0.00004");
    expect(formatMoney(4e-8)).toBe("~$0.00000004");
    expect(formatMoney(0)).toBe("~$0");
  });
});
