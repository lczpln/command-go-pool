export { CLIENT_IDS, type ClientId, type ClientAdapter, type ClientStatus, type ClientWriteResult, type ConnectOptions, type DetectEnv } from "./types.js";
export { defaultOpenCodeFile, opencodeAdapter, connectOpenCodeWithModels } from "./opencode.js";
export { defaultClaudeDir, defaultClaudeFile, claudeAdapter, pickClaudeModelDefaults, CLAUDE_FALLBACK_DEFAULTS } from "./claude.js";
export type { ClaudeModelDefaults } from "./claude.js";
export {
  defaultCodexHome,
  defaultCodexFile,
  codexAdapter,
  connectCodexWithModels,
  pickCodexModel,
  upsertCodexToml,
  removeCodexProvider,
  CODEX_PROVIDER_ID,
  CODEX_FALLBACK_MODEL,
} from "./codex.js";
export {
  getClientAdapter,
  listClientAdapters,
  listClientStatuses,
  isClientId,
  connectClient,
  disconnectClient,
  syncConnectedClientKeys,
  syncConnectedClients,
  rotatePoolApiKey,
  markClientsOnboarded,
} from "./registry.js";
export { poolOrigin, poolOpenAiUrl, loopbackHost } from "./paths.js";
