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
    for (const name of ["Accounts", "Clients", "Models", "Sessions", "Usage", "Events", "Settings"]) {
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

  test("updates an account monthly subscription cost from inspect", async ({ page }) => {
    await page.goto("/accounts");
    const card = page.locator("article").filter({ hasText: "GO #04" });
    await card.getByRole("link", { name: "Inspect" }).click();
    const input = page.getByLabel("GO #04 monthly subscription cost");
    await expect(input).toBeVisible();
    const current = Number((await input.inputValue()) || 0);
    const next = String(current === 20 ? 21 : 20);
    const saved = page.waitForResponse(
      (res) => res.request().method() === "PATCH" && res.url().includes("/api/accounts/") && res.ok(),
    );
    await input.fill(next);
    await input.blur();
    await saved;
    await expect(input).toHaveValue(next);
    await page.goto("/accounts");
    await expect(card.getByText(`$${next}/mo`)).toBeVisible();
  });

  test("account models stay collapsed until the accordion is opened", async ({ page }) => {
    await page.goto("/accounts");
    await page.locator("article").filter({ hasText: "GO #01" }).getByRole("link", { name: "Inspect" }).click();
    const toggle = page.getByRole("button", { name: /MODELS ·/ });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("button", { name: "deepseek/deepseek-v4-flash", exact: true })).toHaveCount(0);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("button", { name: "deepseek/deepseek-v4-flash", exact: true })).toBeVisible();
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

  test("settings generates an optional local pool key you can rotate", async ({ page, request }) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByText("LOCAL PROXY KEY")).toBeVisible();
    await expect(page.getByText("Optional lock for inference. Not required.")).toBeVisible();
    const section = page.locator("section").filter({ hasText: "LOCAL PROXY KEY" });
    const input = section.locator("input");
    await expect(input).toHaveValue("");
    await section.getByRole("button", { name: "Generate" }).click();
    await expect(section.getByText("Local pool key saved")).toBeVisible();
    await expect(input).toHaveValue(/^cgp_[0-9a-f]{48}$/);
    const issued = await input.inputValue();
    await expect(section.getByRole("button", { name: "Copy" })).toBeVisible();
    await section.getByRole("button", { name: "Copy" }).click();
    await expect(section.getByRole("button", { name: "Copied" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(issued);
    try {
      await section.getByRole("button", { name: "Rotate" }).click();
      await expect(section.getByText("Local pool key rotated")).toBeVisible();
      await expect(input).not.toHaveValue(issued);
      await expect(input).toHaveValue(/^cgp_[0-9a-f]{48}$/);
    } finally {
      await request.patch("/api/config", { data: { server: { apiKey: "" } } });
    }
  });

  test("clients page can connect and disconnect OpenCode", async ({ page }, testInfo) => {
    const file = testInfo.outputPath("opencode.json");
    await page.goto("/clients");
    await expect(page.getByRole("heading", { name: "Clients" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "OpenCode" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Claude Code" })).toBeVisible();
    const card = page.locator("article").filter({ has: page.getByRole("heading", { name: "OpenCode" }) });
    const disconnect = card.getByRole("button", { name: "Disconnect" });
    if (await disconnect.isVisible()) await disconnect.click();
    await expect(card.getByRole("button", { name: "Connect" })).toBeVisible();
    await card.getByLabel("OpenCode config path").fill(file);
    await card.getByRole("button", { name: "Connect" }).click();
    await expect(card.getByText("CONNECTED")).toBeVisible();
    await expect(card.getByLabel("OpenCode config path")).toHaveValue(file);
    await card.getByRole("button", { name: "Disconnect" }).click();
    await expect(card.getByRole("button", { name: "Connect" })).toBeVisible();
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
