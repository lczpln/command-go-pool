import { input, confirm, password } from "@inquirer/prompts";
import type { AccountPool } from "@command-go-proxy/account-pool";
import type { CommandCodeTransport } from "@command-go-proxy/shared";
import { parseAppConfig } from "@command-go-proxy/shared";
import { saveConfig } from "@command-go-proxy/storage";

export async function onboard(pool: AccountPool, transport: CommandCodeTransport): Promise<boolean> {
  console.log("\nCommand Go Proxy\n");
  if (pool.list().length === 0) {
    console.log("No accounts configured.\n");
    console.log("Prefer the dashboard to paste Studio API keys. This CLI path is optional.\n");
  }
  let addMore = pool.list().length === 0;
  if (!addMore) {
    addMore = await confirm({ message: "Add another account?", default: false });
  }
  while (addMore) {
    const label = await input({ message: "Account label:", default: `Go #${String(pool.list().length + 1).padStart(2, "0")}` });
    const credential = await password({ message: "Credential:", mask: "*" });
    console.log("\nTesting authentication...\n");
    const account = pool.add({ label, apiKey: credential });
    const cred = pool.credential(account.id);
    if (!cred) {
      console.log("Failed to store credential.");
      break;
    }
    try {
      const status = await transport.getAccountStatus(cred);
      if (!status.authenticated) {
        pool.remove(account.id);
        console.log("✗ Authentication failed — account not added");
      } else {
        pool.update(account.id, { status: "available", models: status.models.map((m) => m.id), quota: status.quota });
        console.log("✓ Authentication successful");
        if (status.models.length) console.log("✓ Models discovered");
        console.log("✓ Account ready\n");
      }
    } catch {
      const result = await transport.testCredential(cred);
      if (!result.ok) {
        pool.remove(account.id);
        console.log(`✗ ${result.message} — account not added`);
      } else {
        pool.update(account.id, { status: "available", models: result.models?.map((m) => m.id) });
        console.log("✓ Authentication successful");
        if (result.models?.length) console.log("✓ Models discovered");
        console.log("✓ Account ready\n");
      }
    }
    addMore = await confirm({ message: "Add another account?", default: true });
  }
  saveConfig(parseAppConfig({}));
  const count = pool.list().length;
  if (count === 0) return false;
  console.log(`\n${count} account${count === 1 ? "" : "s"} configured.\n`);
  return confirm({ message: "Start proxy?", default: true });
}
