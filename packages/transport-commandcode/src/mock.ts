import type { AccountCredential, AuthResult, CommandCodeTransport, ModelInfo, NormalizedChunk, NormalizedRequest, AccountStatusSnapshot } from "@command-go-pool/shared";
import { failure } from "@command-go-pool/shared";

export interface MockScenario {
  models?: ModelInfo[];
  chunks?: NormalizedChunk[];
  errorAfter?: number;
  quota?: AccountStatusSnapshot["quota"];
  failAuth?: boolean;
  delayMs?: number;
}

const DEFAULT_MODELS: ModelInfo[] = [
  { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", reasoning: true, contextWindow: 1_000_000 },
  { id: "deepseek/deepseek-v4-flash-vision-exp", name: "DeepSeek V4 Flash Vision Exp", vision: true, reasoning: true, contextWindow: 1_000_000 },
  { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro", reasoning: true, contextWindow: 1_000_000 },
];

const UNKNOWN_QUOTA: AccountStatusSnapshot["quota"] = {
  fiveHour: { source: "unknown", confidence: "unknown" },
  weekly: { source: "unknown", confidence: "unknown" },
  monthly: { source: "unknown", confidence: "unknown" },
};

export class MockTransport implements CommandCodeTransport {
  lastRequest?: NormalizedRequest;

  constructor(private readonly byAccount: Map<string, MockScenario> = new Map()) {}

  set(accountId: string, scenario: MockScenario): void {
    this.byAccount.set(accountId, scenario);
  }

  async listModels(account: AccountCredential): Promise<ModelInfo[]> {
    return this.scenario(account).models ?? DEFAULT_MODELS;
  }

  async testCredential(account: AccountCredential): Promise<AuthResult> {
    const scenario = this.scenario(account);
    if (scenario.failAuth) return { ok: false, message: "Authentication failed" };
    return { ok: true, message: "Authentication successful", models: scenario.models ?? DEFAULT_MODELS };
  }

  async getAccountStatus(account: AccountCredential, signal?: AbortSignal): Promise<AccountStatusSnapshot> {
    if (signal?.aborted) {
      const error = new Error("The operation was aborted");
      error.name = "AbortError";
      throw error;
    }
    const scenario = this.scenario(account);
    return {
      authenticated: !scenario.failAuth,
      models: scenario.models ?? DEFAULT_MODELS,
      quota: scenario.quota ?? UNKNOWN_QUOTA,
    };
  }

  async *generate(account: AccountCredential, request: NormalizedRequest, signal?: AbortSignal): AsyncIterable<NormalizedChunk> {
    this.lastRequest = request;
    const scenario = this.scenario(account);
    if (scenario.failAuth) {
      yield { type: "error", error: failure("auth_failed", "Authentication failed") };
      return;
    }
    const chunks = scenario.chunks ?? [
      { type: "text-delta", text: "ok" } satisfies NormalizedChunk,
      { type: "usage", usage: { inputTokens: 10, outputTokens: 2 } } satisfies NormalizedChunk,
      { type: "finish", reason: "stop", usage: { inputTokens: 10, outputTokens: 2 } } satisfies NormalizedChunk,
    ];
    for (const [i, chunk] of chunks.entries()) {
      if (signal?.aborted) {
        yield { type: "error", error: failure("client_cancelled", "Request cancelled") };
        return;
      }
      if (scenario.delayMs) await new Promise((r) => setTimeout(r, scenario.delayMs));
      if (scenario.errorAfter !== undefined && i >= scenario.errorAfter) {
        yield typeof chunks[scenario.errorAfter] === "object" && chunks[scenario.errorAfter]?.type === "error"
          ? chunks[scenario.errorAfter]!
          : { type: "error", error: failure("upstream_5xx", "Injected failure") };
        return;
      }
      yield chunk;
    }
  }

  private scenario(account: AccountCredential): MockScenario {
    return this.byAccount.get(account.accountId) ?? this.byAccount.get("*") ?? {};
  }
}
