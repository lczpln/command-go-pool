import { Command } from "commander";
import { input, password, checkbox } from "@inquirer/prompts";
import {
  POOL_NAME,
  POOL_VERSION,
  parseAppConfig,
  connectClient,
  disconnectClient,
  listClientStatuses,
  rotatePoolApiKey,
  isClientId,
  type ClientId,
} from "@command-go-pool/shared";
import { AccountRepo, SessionRepo, SecretStore, existsConfig, loadConfig, openDatabase, saveConfig } from "@command-go-pool/storage";
import { AccountPool } from "@command-go-pool/account-pool";
import { HttpAlphaTransport } from "@command-go-pool/transport-commandcode";
import { boot, overview } from "@command-go-pool/server";
import { compactStatus, startupBanner } from "./banner.js";
import { onboard } from "./onboard.js";
import { doctor } from "./doctor.js";
import { isInteractive, maybeWireClients, wireClientsWizard } from "./clients.js";

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
  await maybeWireClients(loadConfig());
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
  if (instance.runtime.config.server.apiKey) {
    console.log("Pool API key is set. Inference requires Authorization: Bearer.\n");
  }
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

function printClientList() {
  const config = loadConfig();
  for (const client of listClientStatuses(config)) {
    const state = client.connected ? "connected" : client.installed ? "installed" : "not found";
    console.log(`${client.id.padEnd(10)} ${client.name.padEnd(14)} ${state.padEnd(12)} ${client.configPath}`);
    if (client.connected && client.howToRun) console.log(`           ${client.howToRun}`);
  }
}

async function pickClientIds(message: string, connectedOnly = false): Promise<ClientId[]> {
  const config = loadConfig();
  const rows = listClientStatuses(config).filter((row) => (connectedOnly ? row.connected : true));
  if (rows.length === 0) return [];
  if (!isInteractive()) return rows.map((row) => row.id);
  return (await checkbox({
    message,
    instructions: "Space to select, Enter to confirm",
    choices: rows.map((row) => ({
      name: `${row.name.padEnd(14)} ${row.connected ? "connected" : row.installed ? "installed" : "not found"}  ${row.configPath}`,
      value: row.id,
      checked: connectedOnly || row.installed,
    })),
  })) as ClientId[];
}

function program() {
  const cli = new Command();
  cli.name("command-go-pool").description(POOL_NAME).version(POOL_VERSION);

  cli.action(async () => {
    await cmdStart();
  });

  cli.command("init").description("Create config, wire CLIs, and optionally add accounts from the CLI").action(async () => {
    if (!existsConfig()) saveConfig(parseAppConfig({}));
    const { db, pool, transport } = poolFromDisk();
    const startPool = await onboard(pool, transport);
    db.close();
    let config = loadConfig();
    if (isInteractive() && !config.clients.onboarded) {
      config = await wireClientsWizard(config);
      saveConfig(config);
    }
    if (startPool) await cmdStart();
  });

  cli.command("start").description("Start the pool; add accounts in the dashboard").action(async () => {
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

  cli.command("rotate").description("Generate a pool API key and update connected CLIs").action(() => {
    const rotated = rotatePoolApiKey(loadConfig());
    saveConfig(rotated.config);
    console.log(rotated.apiKey);
    console.log("Copy this key now; it is not shown again.");
    if (rotated.updated.length === 0) {
      console.log("No connected CLIs to update.");
      return;
    }
    for (const row of rotated.updated) console.log(row.message);
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

  const client = cli.command("client").description("Connect local coding CLIs to this pool");
  client.command("list").description("Show detected and connected CLIs").action(() => {
    printClientList();
  });
  client
    .command("connect")
    .argument("[ids...]")
    .description("Write pool config into selected CLIs")
    .action(async (ids: string[]) => {
      let selected = ids.filter(isClientId);
      if (selected.length === 0) selected = await pickClientIds("Select CLIs to connect");
      if (selected.length === 0) {
        console.log("No CLIs selected.");
        return;
      }
      let config = loadConfig();
      for (const id of selected) {
        const { config: next, result } = await connectClient(id, config);
        config = next;
        console.log(result.message);
      }
      saveConfig(config);
    });
  client
    .command("disconnect")
    .argument("[ids...]")
    .description("Remove pool config from selected CLIs")
    .action(async (ids: string[]) => {
      let selected = ids.filter(isClientId);
      if (selected.length === 0) selected = await pickClientIds("Select CLIs to disconnect", true);
      if (selected.length === 0) {
        console.log("No connected CLIs.");
        return;
      }
      let config = loadConfig();
      for (const id of selected) {
        const { config: next, result } = disconnectClient(id, config);
        config = next;
        console.log(result.message);
      }
      saveConfig(config);
    });

  const setup = cli.command("setup").description("Client integrations");
  setup.command("opencode").action(async () => {
    const { config, result } = await connectClient("opencode", loadConfig());
    saveConfig(config);
    console.log(result.message);
  });
  setup.command("claude").action(async () => {
    const { config, result } = await connectClient("claude", loadConfig());
    saveConfig(config);
    console.log(result.message);
  });

  return cli;
}

const cli = program();
await cli.parseAsync(process.argv);
