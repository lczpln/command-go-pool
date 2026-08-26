import { afterEach, describe, expect, it } from "vitest";
import { applyEnvOverrides, dashboardPassword, parseAppConfig } from "@command-go-pool/shared";
import {
  LoginLimiter,
  signDashboardCookie,
  verifyDashboardCookie,
} from "@command-go-pool/server";

describe("dashboard password env", () => {
  afterEach(() => {
    delete process.env.COMMAND_GO_POOL_DASHBOARD_PASSWORD;
  });

  it("reads a trimmed env value and never puts it on AppConfig", () => {
    process.env.COMMAND_GO_POOL_DASHBOARD_PASSWORD = "  secret  ";
    expect(dashboardPassword()).toBe("secret");
    const config = applyEnvOverrides(parseAppConfig({ dashboard: { password: "yaml-secret" } }));
    expect(config.dashboard).toEqual({ enabled: true });
    expect("password" in config.dashboard).toBe(false);
  });

  it("treats empty env as unset", () => {
    process.env.COMMAND_GO_POOL_DASHBOARD_PASSWORD = "  ";
    expect(dashboardPassword()).toBeUndefined();
  });
});

describe("dashboard session cookie", () => {
  it("round-trips a signed token", () => {
    const token = signDashboardCookie("pw");
    expect(verifyDashboardCookie(token, "pw")).toBe(true);
    expect(verifyDashboardCookie(token, "other")).toBe(false);
    expect(verifyDashboardCookie("not-a-token", "pw")).toBe(false);
  });

  it("rejects expired tokens", () => {
    const token = signDashboardCookie("pw", Date.now() - 8 * 24 * 3600_000);
    expect(verifyDashboardCookie(token, "pw")).toBe(false);
  });
});

describe("login limiter", () => {
  it("allows five failures then blocks", () => {
    const limiter = new LoginLimiter(5, 60_000);
    for (let i = 0; i < 5; i++) {
      expect(limiter.check("1.1.1.1")).toBe("ok");
      limiter.fail("1.1.1.1");
    }
    expect(limiter.check("1.1.1.1")).toBe("limited");
    limiter.succeed("1.1.1.1");
    expect(limiter.check("1.1.1.1")).toBe("ok");
  });
});
