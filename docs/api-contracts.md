# API contracts

## Inference (`/v1`)

Auth: if `server.apiKey` or `COMMAND_GO_POOL_API_KEY` is set, require `Authorization: Bearer` or `x-api-key`. The key is optional on every bind, including non-loopback.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/v1/models` | Union of models usable by at least one **available** account, minus `config.models.disabled`. Aliases are included only when their target is enabled. |
| GET | `/v1/usage` | Pooled quota windows in OpenCode Go shape: `{ usage: { rolling, weekly, monthly } }`. Unknown windows are `{ status: "unavailable" }`, never a fake percent. Optional `?account=` scopes to one account. |
| POST | `/v1/chat/completions` | OpenAI. Stream = SSE `data:` chunks, forwarded immediately. Disabled models return `400 unsupported_model`. |
| POST | `/v1/messages` | Anthropic. Stream = `event:` + `data:` frames. Disabled models return `400 unsupported_model`. A `max_tokens: 1` request whose only user text is `quota` is answered locally with rate-limit headers (Claude Code `/usage` ping). |

When a window is known, inference responses include `anthropic-ratelimit-unified-*` (utilization 0–1) and `x-ratelimit-*` (percent remaining on the 5h window). Unknown windows omit those headers.

Unsupported upstream features return a clear compatibility error (`invalid_request` / `unsupported_model`), never a silent fake.

Headers:

- `X-Command-Go-Session` — sticky session id
- `X-Command-Go-Routing` — `sticky` \| `balanced` \| `most-available` \| `round-robin` (request override)
- `X-Command-Go-Sticky: 0` — opt out of stickiness for this request

## Admin (`/api`)

Same auth rules. Never includes credential material.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/health` |
| GET/POST | `/api/accounts` | POST body: `{ label, credential, monthlySubscriptionCost? }`. Response never includes the secret. |
| PATCH/DELETE | `/api/accounts/:id` | PATCH may include `credential` to rotate the stored key, or `monthlySubscriptionCost` to change the seat price used for subsidy math. |
| POST | `/api/accounts/:id/test` |
| GET | `/api/models` | Pool catalog: `{ id, enabled, accountIds[], aliasOf? }` |
| PATCH | `/api/models` | Body `{ id, enabled }`. Persists `config.models.disabled`. |
| GET | `/api/clients` | Detected local CLIs plus connected state. |
| POST | `/api/clients/:id/connect` | Write pool config for `opencode` or `claude`. Optional `{ file }`. |
| POST | `/api/clients/:id/disconnect` | Remove pool config from that CLI. |
| POST | `/api/clients/sync` | Writes currently enabled models to every connected client config. |
| POST | `/api/setup/opencode` | Writes `opencode.json` with currently enabled models and marks OpenCode connected. Optional body `{ file, baseUrl }`. |
| POST | `/api/key/rotate` | Generate a `cgp_` key, persist it, and write it into connected CLIs. Returns the key once. |
| GET | `/api/sessions` |
| GET | `/api/sessions/:id` |
| GET | `/api/usage` | Request/cost rollups plus `windows` (same quota objects as the pool). |
| GET | `/api/oauth/usage` | Claude Code `/usage` JSON: `five_hour` / `seven_day` utilization 0–100. Unknown buckets are `null`. |
| GET | `/api/events` |
| GET | `/api/events/stream` (SSE) |
| GET/PATCH | `/api/config` |

SSE event names: `account.updated`, `account.cooldown`, `account.recovered`, `session.started`, `session.migrated`, `session.ended`, `usage.updated`, `models.updated`, `clients.updated`, `pool.error`.
