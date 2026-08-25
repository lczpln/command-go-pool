import type { ACCOUNT_STATUSES, POOL_ERRORS, ROUTING_MODES } from "./constants.js";

export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];
export type PoolErrorCode = (typeof POOL_ERRORS)[number];
export type RoutingMode = (typeof ROUTING_MODES)[number];

export type QuotaSource = "upstream" | "local-estimate" | "unknown";
export type QuotaConfidence = "exact" | "estimated" | "unknown";
export type QuotaWindowName = "fiveHour" | "weekly" | "monthly";

export interface QuotaWindow {
  used?: number;
  remaining?: number;
  total?: number;
  usedPercent?: number;
  remainingPercent?: number;
  resetAt?: Date;
  source: QuotaSource;
  confidence: QuotaConfidence;
}

export interface AccountQuota {
  fiveHour?: QuotaWindow;
  weekly?: QuotaWindow;
  monthly?: QuotaWindow;
}

export interface Account {
  id: string;
  label: string;
  enabled: boolean;
  credentialRef: string;
  status: AccountStatus;
  lastSuccessAt?: Date;
  lastFailureAt?: Date;
  cooldownUntil?: Date;
  cooldownReason?: string;
  healthScore: number;
  activeSessionCount: number;
  monthlySubscriptionCost?: number;
  quota: AccountQuota;
  recentLatencyMs?: number;
  recentErrorRate?: number;
  models?: string[];
}

export interface AccountCredential {
  accountId: string;
  apiKey: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  ownedBy?: string;
  contextWindow?: number;
  vision?: boolean;
  reasoning?: boolean;
}

export interface AuthResult {
  ok: boolean;
  message: string;
  models?: ModelInfo[];
}

export interface AccountStatusSnapshot {
  authenticated: boolean;
  models: ModelInfo[];
  quota: AccountQuota;
  planId?: string;
  latencyMs?: number;
}

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface TextPart {
  type: "text";
  text: string;
}

export interface ImagePart {
  type: "image";
  url?: string;
  base64?: string;
  mediaType: string;
}

export interface ToolCallPart {
  type: "tool-call";
  id: string;
  name: string;
  arguments: unknown;
}

export interface ToolResultPart {
  type: "tool-result";
  id: string;
  name?: string;
  output: string;
  isError?: boolean;
}

export type ContentPart = TextPart | ImagePart | ToolCallPart | ToolResultPart;

export interface NormalizedMessage {
  role: MessageRole;
  content: ContentPart[];
}

export interface NormalizedTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface NormalizedRequest {
  model: string;
  messages: NormalizedMessage[];
  system?: string;
  tools?: NormalizedTool[];
  toolChoice?: "auto" | "none" | "required" | { name: string };
  temperature?: number;
  maxTokens?: number;
  stream: boolean;
  reasoningEffort?: string;
  sessionHint?: string;
  promptCacheKey?: string;
  metadata?: Record<string, unknown>;
  sticky?: boolean;
  routingMode?: RoutingMode;
}

export type NormalizedChunk =
  | { type: "text-delta"; text: string }
  | { type: "reasoning-delta"; text: string }
  | { type: "tool-call-delta"; id: string; name: string; argumentsDelta: string }
  | { type: "tool-call"; id: string; name: string; arguments: unknown }
  | { type: "usage"; usage: TokenUsage }
  | { type: "finish"; reason: FinishReason; usage?: TokenUsage }
  | { type: "error"; error: PoolFailure };

export type FinishReason = "stop" | "length" | "tool-calls" | "cancelled" | "error";

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  estimatedCost?: number;
  costSource?: QuotaSource;
}

export interface PoolFailure {
  code: PoolErrorCode;
  message: string;
  retryable: boolean;
  failover: boolean;
  cooldownUntil?: Date;
  status?: number;
  window?: QuotaWindowName;
}

export interface Session {
  id: string;
  accountId: string;
  model: string;
  label?: string;
  createdAt: Date;
  lastRequestAt: Date;
  requests: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  estimatedCost?: number;
  migrations: number;
  sticky: boolean;
}

export interface SessionMigration {
  sessionId: string;
  fromAccountId: string;
  toAccountId: string;
  reason: string;
  at: Date;
}

export interface CommandCodeTransport {
  listModels(account: AccountCredential): Promise<ModelInfo[]>;
  generate(
    account: AccountCredential,
    request: NormalizedRequest,
    signal?: AbortSignal,
  ): AsyncIterable<NormalizedChunk>;
  getAccountStatus(account: AccountCredential): Promise<AccountStatusSnapshot>;
  testCredential(account: AccountCredential): Promise<AuthResult>;
}

export interface PoolEvent {
  id: number;
  at: Date;
  level: "info" | "warning" | "error";
  category: "routing" | "quota" | "authentication" | "system";
  type: string;
  payload: Record<string, unknown>;
}

export interface UsageRollup {
  requests: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  errors: number;
  migrations: number;
  estimatedCost?: number;
  latencyP50?: number;
  ttftP50?: number;
}

export function unknownQuota(): QuotaWindow {
  return { source: "unknown", confidence: "unknown" };
}
