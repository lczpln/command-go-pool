import { describe, expect, it } from "vitest";
import {
  catalogModels,
  displayNameForModel,
  enabledSyncModels,
  exposedInferenceModels,
  isModelEnabled,
  parseAppConfig,
  setModelEnabled,
  traitsForModel,
} from "@command-go-pool/shared";

const config = parseAppConfig({
  aliases: {
    speedy: "deepseek/deepseek-v4-flash",
    heavy: "deepseek/deepseek-v4-pro",
  },
  models: { disabled: ["deepseek/deepseek-v4-pro"] },
});

describe("model policy", () => {
  it("drops stock flash/vision/pro aliases and keeps custom ones", () => {
    const parsed = parseAppConfig({
      aliases: {
        flash: "deepseek/deepseek-v4-flash",
        vision: "deepseek/deepseek-v4-flash-vision-exp",
        pro: "deepseek/deepseek-v4-pro",
        speedy: "deepseek/deepseek-v4-flash",
      },
    });
    expect(parsed.aliases).toEqual({ speedy: "deepseek/deepseek-v4-flash" });
    expect(parseAppConfig({}).aliases).toEqual({});
  });

  it("treats denylist as disabled, including aliases of a disabled target", () => {
    expect(isModelEnabled("deepseek/deepseek-v4-flash", config)).toBe(true);
    expect(isModelEnabled("speedy", config)).toBe(true);
    expect(isModelEnabled("deepseek/deepseek-v4-pro", config)).toBe(false);
    expect(isModelEnabled("heavy", config)).toBe(false);
  });

  it("keeps OpenCode vision models enabled and locked", () => {
    const parsed = parseAppConfig({ models: { disabled: ["xiaomi/mimo-v2.5", "deepseek/deepseek-v4-pro"] } });
    expect(isModelEnabled("xiaomi/mimo-v2.5", parsed)).toBe(true);
    expect(setModelEnabled(["xiaomi/mimo-v2.5"], "xiaomi/mimo-v2.5", false)).toEqual([]);
    const catalog = catalogModels([{ id: "acc_1", models: ["xiaomi/mimo-v2.5", "deepseek/deepseek-v4-flash"] }], parsed);
    const mimo = catalog.find((row) => row.id === "xiaomi/mimo-v2.5");
    expect(mimo).toMatchObject({
      enabled: true,
      locked: true,
      lockReason: "Required for OpenCode vision",
    });
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
    expect(byId.speedy?.aliasOf).toBe("deepseek/deepseek-v4-flash");
    expect(byId.heavy?.enabled).toBe(false);
  });

  it("filters inference listing and drops aliases of disabled targets", () => {
    const data = exposedInferenceModels(["deepseek/deepseek-v4-flash", "deepseek/deepseek-v4-pro"], config);
    const ids = data.map((row) => row.id);
    expect(ids).toContain("deepseek/deepseek-v4-flash");
    expect(ids).toContain("speedy");
    expect(ids).not.toContain("deepseek/deepseek-v4-pro");
    expect(ids).not.toContain("heavy");
    expect(ids).not.toContain("flash");
    expect(ids).not.toContain("pro");
  });

  it("marks Go reasoning models on /v1/models without stock aliases", () => {
    const data = exposedInferenceModels(["deepseek/deepseek-v4-flash", "deepseek/deepseek-v4-pro"], parseAppConfig({}));
    const byId = Object.fromEntries(data.map((row) => [row.id, row]));
    expect(byId["deepseek/deepseek-v4-flash"]?.reasoning).toBe(true);
    expect(byId["deepseek/deepseek-v4-pro"]?.reasoning).toBe(true);
    expect(byId["deepseek/deepseek-v4-flash"]?.context_window).toBe(1_000_000);
    expect(byId.flash).toBeUndefined();
    expect(byId.pro).toBeUndefined();
    expect(byId.vision).toBeUndefined();
  });

  it("syncs only enabled canonical models, not aliases", () => {
    const models = enabledSyncModels(
      [{ id: "acc_1", models: ["deepseek/deepseek-v4-flash", "deepseek/deepseek-v4-pro"] }],
      config,
    );
    expect(models.map((row) => row.id)).toEqual(["deepseek/deepseek-v4-flash"]);
    expect(models[0]?.reasoning).toBe(true);
  });

  it("prefers live catalog flags over known traits", () => {
    const data = exposedInferenceModels(["acme/widget"], parseAppConfig({}), new Map([["acme/widget", { reasoning: true }]]));
    expect(data[0]?.reasoning).toBe(true);
  });

  it("defaults every model to reasoning without inventing vision", () => {
    expect(traitsForModel("deepseek/deepseek-v4-flash")).toEqual({ reasoning: true, contextWindow: 1_000_000 });
    expect(traitsForModel("deepseek/deepseek-v4-pro")).toEqual({ reasoning: true, contextWindow: 1_000_000 });
    expect(traitsForModel("deepseek/deepseek-v4-flash-vision-exp")).toEqual({ reasoning: true, contextWindow: 1_000_000 });
    expect(traitsForModel("anthropic/claude-sonnet-5")).toEqual({ reasoning: true });
    expect(traitsForModel("acme/widget-coder")).toEqual({ reasoning: true });
  });

  it("copies live context windows onto synced models", () => {
    const models = enabledSyncModels(
      [
        {
          id: "acc_1",
          models: ["anthropic/claude-sonnet-5"],
          modelCatalog: [{ id: "anthropic/claude-sonnet-5", name: "Claude Sonnet 5", contextWindow: 1_000_000, reasoning: true }],
        },
      ],
      parseAppConfig({}),
    );
    expect(models[0]).toMatchObject({
      id: "anthropic/claude-sonnet-5",
      reasoning: true,
      contextWindow: 1_000_000,
    });
  });

  it("keeps a known display name for Go coding models", () => {
    expect(displayNameForModel("deepseek/deepseek-v4-flash")).toBe("DeepSeek V4 Flash");
    expect(displayNameForModel("acme/widget-coder")).toBe("Widget Coder");
  });
});
