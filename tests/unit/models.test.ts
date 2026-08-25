import { describe, expect, it } from "vitest";
import { catalogModels, displayNameForModel, exposedInferenceModels, isModelEnabled, parseAppConfig, setModelEnabled } from "@command-go-proxy/shared";

const config = parseAppConfig({
  aliases: {
    flash: "deepseek/deepseek-v4-flash",
    pro: "deepseek/deepseek-v4-pro",
  },
  models: { disabled: ["deepseek/deepseek-v4-pro"] },
});

describe("model policy", () => {
  it("treats denylist as disabled, including aliases of a disabled target", () => {
    expect(isModelEnabled("deepseek/deepseek-v4-flash", config)).toBe(true);
    expect(isModelEnabled("flash", config)).toBe(true);
    expect(isModelEnabled("deepseek/deepseek-v4-pro", config)).toBe(false);
    expect(isModelEnabled("pro", config)).toBe(false);
  });

  it("toggles ids on the denylist", () => {
    expect(setModelEnabled(["deepseek/deepseek-v4-pro"], "deepseek/deepseek-v4-pro", true)).toEqual([]);
    expect(setModelEnabled([], "deepseek/deepseek-v4-flash", false)).toEqual(["deepseek/deepseek-v4-flash"]);
  });

  it("builds a catalog including disabled ids and aliases", () => {
    const catalog = catalogModels(
      [{ id: "acc_1", models: ["deepseek/deepseek-v4-flash", "deepseek/deepseek-v4-pro"] }],
      config,
    );
    const byId = Object.fromEntries(catalog.map((row) => [row.id, row]));
    expect(byId["deepseek/deepseek-v4-flash"]?.enabled).toBe(true);
    expect(byId["deepseek/deepseek-v4-flash"]?.accountIds).toEqual(["acc_1"]);
    expect(byId["deepseek/deepseek-v4-pro"]?.enabled).toBe(false);
    expect(byId.flash?.aliasOf).toBe("deepseek/deepseek-v4-flash");
    expect(byId.pro?.enabled).toBe(false);
  });

  it("filters inference listing and drops aliases of disabled targets", () => {
    const data = exposedInferenceModels(["deepseek/deepseek-v4-flash", "deepseek/deepseek-v4-pro"], config);
    const ids = data.map((row) => row.id);
    expect(ids).toContain("deepseek/deepseek-v4-flash");
    expect(ids).toContain("flash");
    expect(ids).not.toContain("deepseek/deepseek-v4-pro");
    expect(ids).not.toContain("pro");
  });

  it("keeps a known display name for Go coding models", () => {
    expect(displayNameForModel("deepseek/deepseek-v4-flash")).toBe("DeepSeek V4 Flash");
    expect(displayNameForModel("acme/widget-coder")).toBe("Widget Coder");
  });
});
