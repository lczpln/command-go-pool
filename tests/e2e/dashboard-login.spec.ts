import { test, expect } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAppConfig } from "@command-go-pool/shared";
import { MockTransport } from "@command-go-pool/transport-commandcode";
import { boot } from "@command-go-pool/server";

test.describe("dashboard login", () => {
  const password = "e2e-dashboard-secret";
  let origin = "";
  let close: (() => Promise<void>) | undefined;
  const previous = process.env.COMMAND_GO_POOL_DASHBOARD_PASSWORD;

  test.beforeAll(async () => {
    process.env.COMMAND_GO_POOL_DASHBOARD_PASSWORD = password;
    const home = mkdtempSync(join(tmpdir(), "cgp-login-e2e-"));
    const instance = await boot({
      home,
      transport: new MockTransport(),
      config: parseAppConfig({ server: { host: "127.0.0.1", port: 0 } }),
    });
    instance.runtime.pool.add({
      label: "GO #01",
      apiKey: "user_e2e_login",
      monthlySubscriptionCost: 1,
    });
    await instance.listen();
    const address = instance.app.addresses()[0];
    const host = address?.address === "::" || address?.address === "::1" ? "127.0.0.1" : (address?.address ?? "127.0.0.1");
    origin = `http://${host}:${address?.port}`;
    close = () => instance.close();
  });

  test.afterAll(async () => {
    await close?.();
    if (previous === undefined) delete process.env.COMMAND_GO_POOL_DASHBOARD_PASSWORD;
    else process.env.COMMAND_GO_POOL_DASHBOARD_PASSWORD = previous;
  });

  test("prompts for the env password then shows the pool", async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto(origin);
    await expect(page.getByRole("heading", { name: "Dashboard lock" })).toBeVisible();
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Command Go Pool", { exact: true })).toBeVisible();
    await expect(page.getByText("GO #01")).toBeVisible();
    await page.close();
  });
});
