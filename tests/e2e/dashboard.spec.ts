import { test, expect } from "@playwright/test";

test.describe("dashboard", () => {
  test("overview shows the pool and per-account quota windows", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Command Go Pool", { exact: true })).toBeVisible();
    await expect(page.getByText("Local inference gateway")).toBeVisible();
    await expect(page.getByText("GO #01")).toBeVisible();
    await expect(page.getByText("GO #10")).toBeVisible();
    await expect(page.getByText("POOL CAPACITY")).toBeVisible();
    await expect(page.getByText("5h").first()).toBeVisible();
    await expect(page.getByText("Week").first()).toBeVisible();
    await expect(page.getByText("Month").first()).toBeVisible();
    await expect(page.getByText("Estimated from local usage").first()).toBeVisible();
    await expect(page.getByText("Unavailable").first()).toBeVisible();
  });

  test("navigates every primary page", async ({ page }) => {
    await page.goto("/");
    for (const name of ["Accounts", "Models", "Sessions", "Usage", "Events", "Settings"]) {
      await page.getByRole("link", { name, exact: true }).click();
      await expect(page.getByRole("heading", { name })).toBeVisible();
    }
    await expect(page.getByText("Bind is localhost by default")).toBeVisible();
  });

  test("opens session detail with a migration timeline", async ({ page }) => {
    await page.goto("/sessions");
    await page.getByRole("link").filter({ hasText: "ses_demo" }).click();
    await expect(page.getByText("ses_demo")).toBeVisible();
    await expect(page.getByText("Migration timeline")).toBeVisible();
  });

  test("disable then enable updates account status live", async ({ page }) => {
    await page.goto("/accounts");
    const card = page.locator("article").filter({ hasText: "GO #02" });
    await card.getByRole("button", { name: "Disable" }).click();
    await expect(card.getByText("DISABLED")).toBeVisible();
    await card.getByRole("button", { name: "Enable" }).click();
    await expect(card.getByText("AVAILABLE")).toBeVisible();
  });

  test("disable a model hides it from GET /v1/models", async ({ page, request }) => {
    await page.goto("/models");
    await expect(page.getByRole("heading", { name: "Models" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sync with clients" })).toBeVisible();
    const row = page.locator("article").filter({ hasText: "deepseek/deepseek-v4-pro" }).first();
    await expect(row.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    await expect(row.getByText("ENABLED")).toBeVisible();
    await row.getByRole("switch").click();
    await expect(row.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    await expect(row.getByText("DISABLED")).toBeVisible();
    const hidden = await request.get("/v1/models");
    const hiddenIds = ((await hidden.json()) as { data: Array<{ id: string }> }).data.map((row) => row.id);
    expect(hiddenIds).not.toContain("deepseek/deepseek-v4-pro");
    expect(hiddenIds).not.toContain("pro");
    await row.getByRole("switch").click();
    await expect(row.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    await expect(row.getByText("ENABLED")).toBeVisible();
  });

  test("adds and removes a Command Code account from the web form", async ({ page }) => {
    await page.goto("/accounts");
    await expect(page.getByText("COMMISSION ACCOUNT")).toBeVisible();
    const label = `WEB ${Date.now()}`;
    await page.getByLabel("Label").fill(label);
    await page.getByLabel("Studio API key").fill("user_e2e_dashboard_key");
    await page.getByRole("button", { name: "Add to pool" }).click();
    await expect(page.getByText("Authentication successful")).toBeVisible();
    const card = page.locator("article").filter({ hasText: label });
    await expect(card).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await card.getByRole("button", { name: "Remove" }).click();
    await expect(card).toHaveCount(0);
  });

  test("settings rotates a local pool key you can copy", async ({ page, request }) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByText("LOCAL PROXY KEY")).toBeVisible();
    await expect(page.getByText("COMMAND_GO_POOL_API_KEY")).toBeVisible();
    const section = page.locator("section").filter({ hasText: "LOCAL PROXY KEY" });
    await expect(section.getByText("· set")).toBeVisible();
    const input = section.locator("input");
    await expect(input).toHaveValue("");
    try {
      await section.getByRole("button", { name: "Rotate" }).click();
      await expect(section.getByText("Local pool key rotated")).toBeVisible();
      await expect(input).toHaveValue(/^cgp_[0-9a-f]{48}$/);
      const issued = await input.inputValue();
      await expect(section.getByRole("button", { name: "Copy" })).toBeVisible();
      await section.getByRole("button", { name: "Copy" }).click();
      await expect(section.getByRole("button", { name: "Copied" })).toBeVisible();
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(issued);
    } finally {
      await request.patch("/api/config", { data: { server: { apiKey: process.env.COMMAND_GO_POOL_API_KEY } } });
    }
    await expect(page.getByText("COMMISSION ACCOUNT")).toBeVisible();
  });
});

test.describe("compatibility APIs", () => {
  test("OpenAI streaming completions", async ({ request }) => {
    const res = await request.post("/v1/chat/completions", {
      data: {
        model: "deepseek/deepseek-v4-flash",
        stream: true,
        messages: [{ role: "user", content: "hello" }],
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.text();
    expect(body).toContain("ok");
    expect(body).toContain("[DONE]");
  });

  test("Anthropic streaming messages", async ({ request }) => {
    const res = await request.post("/v1/messages", {
      data: {
        model: "deepseek/deepseek-v4-flash",
        max_tokens: 32,
        stream: true,
        messages: [{ role: "user", content: "hello" }],
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.text();
    expect(body).toContain("content_block_delta");
    expect(body).toContain("ok");
    expect(body).toContain("message_stop");
  });
});
