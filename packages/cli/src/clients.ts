import { checkbox, confirm } from "@inquirer/prompts";
import {
  connectClient,
  listClientAdapters,
  markClientsOnboarded,
  type AppConfig,
  type ClientId,
} from "@command-go-pool/shared";
import { saveConfig } from "@command-go-pool/storage";

export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export async function wireClientsWizard(config: AppConfig): Promise<AppConfig> {
  const adapters = listClientAdapters();
  const choices = adapters.map((adapter) => {
    const detected = adapter.detect();
    const mark = detected.installed ? "installed" : "not found";
    return {
      name: `${detected.name.padEnd(14)} ${mark.padEnd(11)} ${detected.configPath}`,
      value: adapter.id,
      checked: detected.installed,
    };
  });
  console.log("\nCompatible CLIs\n");
  const selected = (await checkbox({
    message: "Wire these CLIs to Command Go Pool",
    instructions: "Space to select, Enter to confirm",
    choices,
  })) as ClientId[];
  if (selected.length === 0) {
    console.log("No CLIs selected.\n");
    return markClientsOnboarded(config);
  }
  const labels = selected
    .map((id) => adapters.find((adapter) => adapter.id === id)?.name ?? id)
    .join(", ");
  const ok = await confirm({
    message: `Write pool config to ${labels}?`,
    default: true,
  });
  if (!ok) {
    console.log("Aborted.\n");
    return markClientsOnboarded(config);
  }
  let next = config;
  for (const id of selected) {
    const result = await connectClient(id, next);
    next = result.config;
    console.log(result.result.message);
    console.log("");
  }
  return markClientsOnboarded(next);
}

export async function maybeWireClients(config: AppConfig): Promise<AppConfig> {
  if (!isInteractive() || config.clients?.onboarded) return config;
  const next = await wireClientsWizard(config);
  saveConfig(next);
  return next;
}
