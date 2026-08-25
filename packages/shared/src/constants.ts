export const POOL_NAME = "Command Go Pool";
export const POOL_VERSION = "0.1.1";
export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 8787;
export const DEFAULT_SESSION_TTL_HOURS = 24;
export const DEFAULT_MAX_FAILOVERS = 2;
export const DEFAULT_QUOTA_REFRESH_SECONDS = 60;
export const SESSION_HEADER = "x-command-go-session";
export const ROUTING_HEADER = "x-command-go-routing";
export const STICKY_HEADER = "x-command-go-sticky";
export const UPSTREAM_API_BASE = "https://api.commandcode.ai";
export const CLI_VERSION_HEADER_DEFAULT = "0.52.1";

export const ACCOUNT_STATUSES = [
  "available",
  "active",
  "cooldown",
  "quota_exhausted",
  "auth_error",
  "upstream_error",
  "disabled",
] as const;

export const POOL_ERRORS = [
  "quota_exhausted",
  "rate_limited",
  "auth_failed",
  "insufficient_credit",
  "unsupported_model",
  "network_error",
  "upstream_5xx",
  "timeout",
  "invalid_request",
  "client_cancelled",
  "unknown",
] as const;

export const ROUTING_MODES = ["sticky", "balanced", "most-available", "round-robin"] as const;
