import { connectClient, parseAppConfig, type AppConfig } from "@command-go-pool/shared";

export async function setupOpenCode(
  baseUrl = "http://127.0.0.1:8787/v1",
  file?: string,
  opts: { fetchImpl?: typeof fetch; apiKey?: string } = {},
): Promise<string> {
  const config = parseAppConfig({ server: { ...parseServerFromUrl(baseUrl), apiKey: opts.apiKey } });
  const { result } = await connectClient("opencode", config, { file, fetchImpl: opts.fetchImpl, apiKey: opts.apiKey });
  return result.message;
}

export function setupOpenCodeFromConfig(
  config: AppConfig,
  opts: { file?: string; fetchImpl?: typeof fetch } = {},
): Promise<string> {
  return connectClient("opencode", config, opts).then(({ result }) => result.message);
}

export async function setupClaude(
  baseUrl = "http://127.0.0.1:8787",
  file?: string,
  opts: { apiKey?: string } = {},
): Promise<string> {
  const config = parseAppConfig({ server: { ...parseServerFromUrl(baseUrl), apiKey: opts.apiKey } });
  const { result } = await connectClient("claude", config, { file, apiKey: opts.apiKey });
  return result.message;
}

function parseServerFromUrl(baseUrl: string): { host: string; port: number } {
  try {
    const url = new URL(baseUrl);
    return { host: url.hostname, port: Number(url.port || (url.protocol === "https:" ? 443 : 80)) };
  } catch {
    return { host: "127.0.0.1", port: 8787 };
  }
}
