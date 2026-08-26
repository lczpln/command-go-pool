# Architecture decision record

## Product

Command Go Pool is a **local inference gateway**. Clients see one OpenAI/Anthropic URL. The operator sees every account, quota window, session, and migration.

## ADR-1 — Isolate Command Code behind `CommandCodeTransport`

Routing, dashboard, and protocol layers speak only:

- `listModels`
- `generate` → `AsyncIterable<NormalizedChunk>`
- `getAccountStatus`
- `testCredential`

Implementations:

1. **`HttpAlphaTransport`** (default) — undocumented `POST /alpha/generate` plus `/alpha/whoami`, `/alpha/billing/*`, `/provider/v1/models`. Entire file tree lives in `packages/transport-commandcode`. If Command Code ships an official generation API for Go, swap this adapter.
2. **`CliFallbackTransport`** — `cmd status` / env-key whoami for health when HTTP status endpoints fail. Not used for generation (headless is an agent, not a chat-completions pipe).
3. **`MockTransport`** — tests and chaos.

## ADR-2 — Sticky sessions by default

Coding agents depend on prompt cache. Round-robin per message would burn quota and cache. New sessions are quota-scored; existing sessions stay bound until failover.

Session id priority: `X-Command-Go-Session` → OpenAI/Anthropic metadata → `prompt_cache_key` → client hints → fingerprint(`model + system + first user text`) with collision suffix.

## ADR-3 — Quota honesty

Every `QuotaWindow` carries `source` and `confidence`. UI prefixes estimated values with `~` and unknown with an empty bar. Pool aggregation mixes only compatible measurements (same source class and present denominators).

## ADR-4 — Failover is classified, not blind

Max 2 account migrations per request. Retry only `quota_exhausted`, `rate_limited`, `timeout`, `upstream_5xx`, `network_error`, `auth_failed`, `insufficient_credit`. Never replay `invalid_request`.

## ADR-5 — Single process

Fastify serves `/v1/*`, `/api/*`, dashboard static assets, and SSE. SQLite in `~/.command-go-pool/state.db`. No Redis.

## ADR-6 — Secrets

SQLite stores `credential_ref` only. Secret payload is AES-256-GCM in `secrets.bin`, keyed by `COMMAND_GO_POOL_MASTER_KEY` or a 0600 `master.key`. Optional OS keychain when `keytar` loads. Docker: env or mounted file.

## ADR-7 — Localhost default

Bind `127.0.0.1`. A pool API key is optional on any bind. If `COMMAND_GO_POOL_API_KEY` (or config `server.apiKey`) is set, inference requires it; off-loopback also authenticates admin routes. Dashboard never returns credentials. Generating or rotating the key updates connected CLI configs.

`COMMAND_GO_POOL_DASHBOARD_PASSWORD` is the only way to lock the dashboard. It is env-only (not stored in `config.yaml`, not settable from the UI or CLI). When set, `/api/*` (except `/api/auth/login` and `/api/auth/status`) requires the dashboard session cookie or the pool API key. `/v1/*` still uses only the pool API key. Put TLS in front of a public bind.

## Package graph

```
cli → server → protocol-openai
             → protocol-anthropic
             → session-router → account-pool → quota-engine
             → transport-commandcode
             → storage
             → observability
             → shared
dashboard (Vite static) ──served by── server
```
