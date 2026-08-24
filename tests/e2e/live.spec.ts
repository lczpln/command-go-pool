import { test, expect } from "@playwright/test";

test("optional live Command Code account", async ({ request }) => {
  test.skip(!process.env.COMMAND_CODE_API_KEY, "excluded from CI unless COMMAND_CODE_API_KEY is supplied");
  const res = await request.post("https://api.commandcode.ai/alpha/whoami", {
    headers: { authorization: `Bearer ${process.env.COMMAND_CODE_API_KEY}` },
  });
  expect(res.ok()).toBeTruthy();
});
