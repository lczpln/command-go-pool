import { Command } from "commander";
import { input, password, confirm } from "@inquirer/prompts";
import { PROXY_NAME, PROXY_VERSION, parseAppConfig } from "@command-go-proxy/shared";
import { AccountRepo, SessionRepo, SecretStore, existsConfig, loadConfig, openDatabase, saveConfig } from "@command-go-proxy/storage";
import { AccountPool } from "@command-go-proxy/account-pool";
import { HttpAlphaTransport } from "@command-go-proxy/transport-commandcode";
import { boot, overview } from "@command-go-proxy/server";
import { compactStatus, startupBanner } from "./banner.js";
import { onboard } from "./onboard.js";
import { setupClaude, setupOpenCode } from "./setup.js";
import { doctor } from "./doctor.js";

function poolFromDisk() {
  const db = openDatabase();
  const secrets = SecretStore.open();
  const pool = new AccountPool(new AccountRepo(db), secrets);
  const transport = new HttpAlphaTransport({
    apiBase: "https://api.commandcode.ai",
    cliVersion: "0.52.1",
    timeoutMs: 30_000,
    idleTimeoutMs: 15_000,
  });
  return { db, pool, transport };
}

async function cmdStart() {
  if (!existsConfig()) saveConfig(parseAppConfig({}));
  const instance = await boot();
  await instance.listen();
  const snap = overview(instance.runtime);
  const models = new Set(instance.runtime.pool.list().flatMap((a) => a.models ?? [])).size;
  const dashboard = `http://${snap.bind.host}:${snap.bind.port}`;
  console.log(
    startupBanner({
      accounts: instance.runtime.pool.list(),
      api: `http://${snap.bind.host}:${snap.bind.port}/v1`,
      dashboard,
      sessions: snap.sessions,
      models,
    }),
  );
  if (instance.runtime.pool.list().length === 0) {
    console.log("No Command Code accounts yet.");
    console.log(`Open ${dashboard} → Accounts and paste a Studio API key.\n`);
  }
  const stop = async () => {
    await instance.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

function program() {
  const cli = new Command();
  cli.name("command-go-proxy").description(PROXY_NAME).version(PROXY_VERSION);

  cli.action(async () => {
    await cmdStart();
  });

  cli.command("init").description("Create config and optionally add accounts from the CLI").action(async () => {
    saveConfig(parseAppConfig({}));
    const { db, pool, transport } = poolFromDisk();
    await onboard(pool, transport);
    db.close();
  });

  cli.command("start").description("Start the proxy; add accounts in the dashboard").action(async () => {
    await cmdStart();
  });

  cli.command("status").description("Print pool status").action(() => {
    const { db, pool } = poolFromDisk();
    const config = loadConfig();
    const sessions = new SessionRepo(db).listActive(config.routing.sessionTtlHours * 3600_000);
    console.log(
      compactStatus({
        accounts: pool.list(),
        api: `http://${config.server.host}:${config.server.port}/v1`,
        dashboard: `http://${config.server.host}:${config.server.port}`,
        sessions: sessions.length,
      }),
    );
    db.close();
  });

  cli.command("doctor").description("Check local health").action(async () => {
    const { db, pool } = poolFromDisk();
    const code = await doctor(pool);
    db.close();
    process.exitCode = code;
  });

  const account = cli.command("account").description("Manage Command Code accounts");

  account.command("add").description("Add an account").action(async () => {
    const { db, pool, transport } = poolFromDisk();
    const label = await input({ message: "Account label:", default: `Go #${String(pool.list().length + 1).padStart(2, "0")}` });
    const credential = await password({ message: "Credential:", mask: "*" });
    const costRaw = await input({ message: "Monthly subscription cost (optional):", default: "1" });
    const accountRow = pool.add({ label, apiKey: credential, monthlySubscriptionCost: Number(costRaw) || undefined });
    const cred = pool.credential(accountRow.id)!;
    try {
      const status = await transport.getAccountStatus(cred);
      if (status.authenticated) {
        pool.update(accountRow.id, { status: "available", models: status.models.map((m) => m.id), quota: status.quota });
        console.log("✓ Authentication successful");
        console.log("✓ Models discovered");
        console.log("✓ Account ready");
      } else {
        pool.remove(accountRow.id);
        console.log("✗ Authentication failed — account not added");
      }
    } catch {
      const result = await transport.testCredential(cred);
      if (result.ok) {
        pool.update(accountRow.id, { status: "available", models: result.models?.map((m) => m.id) });
        console.log("✓ Authentication successful");
        console.log("✓ Models discovered");
        console.log("✓ Account ready");
      } else {
        pool.remove(accountRow.id);
        console.log(`✗ ${result.message} — account not added`);
      }
    }
    db.close();
  });

  account.command("list").description("List accounts").action(() => {
    const { db, pool } = poolFromDisk();
    for (const row of pool.list()) {
      console.log(`${row.id}  ${row.label.padEnd(16)} ${row.status.padEnd(16)} sessions=${row.activeSessionCount}`);
    }
    db.close();
  });

  account.command("remove").argument("<id>").action((id: string) => {
    const { db, pool } = poolFromDisk();
    pool.remove(id);
    console.log(`Removed ${id}`);
    db.close();
  });

  account.command("enable").argument("<id>").action((id: string) => {
    const { db, pool } = poolFromDisk();
    pool.update(id, { enabled: true, status: "available" });
    db.close();
  });

  account.command("disable").argument("<id>").action((id: string) => {
    const { db, pool } = poolFromDisk();
    pool.update(id, { enabled: false, status: "disabled" });
    db.close();
  });

  account.command("test").argument("<id>").action(async (id: string) => {
    const { db, pool, transport } = poolFromDisk();
    const cred = pool.credential(id);
    if (!cred) {
      console.log("Unknown account");
      db.close();
      process.exitCode = 1;
      return;
    }
    const result = await transport.testCredential(cred);
    console.log(result.ok ? `✓ ${result.message}` : `✗ ${result.message}`);
    db.close();
  });

  const setup = cli.command("setup").description("Client integrations");
  setup.command("opencode").action(async () => {
    console.log(await setupOpenCode());
  });
  setup.command("claude").action(async () => {
    const ok = await confirm({
      message: "Write a dedicated Claude settings file (will not change unrelated env vars)?",
      default: true,
    });
    if (!ok) {
      console.log("Aborted.");
      return;
    }
    console.log(setupClaude());
  });

  return cli;
}

const cli = program();
await cli.parseAsync(process.argv);
