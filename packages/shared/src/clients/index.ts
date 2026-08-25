export { CLIENT_IDS, type ClientId, type ClientAdapter, type ClientStatus, type ClientWriteResult, type ConnectOptions, type DetectEnv } from "./types.js";
export { defaultOpenCodeFile, opencodeAdapter, connectOpenCodeWithModels } from "./opencode.js";
export { defaultClaudeDir, defaultClaudeFile, claudeAdapter } from "./claude.js";
export {
  getClientAdapter,
  listClientAdapters,
  listClientStatuses,
  isClientId,
  connectClient,
  disconnectClient,
  syncConnectedClientKeys,
  rotatePoolApiKey,
  markClientsOnboarded,
} from "./registry.js";
export { poolOrigin, poolOpenAiUrl, loopbackHost } from "./paths.js";
