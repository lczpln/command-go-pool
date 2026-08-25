# API contracts

## Inference (`/v1`)

Auth: a pool API key is always issued on first start (`server.apiKey` / `COMMAND_GO_POOL_API_KEY`, format `cgp_…`). Inference (`/v1`) requires `Authorization: Bearer` or `x-api-key`. Loopback admin (`/api`) stays open for the dashboard. Non-loopback binds authenticate both inference and admin.

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
| PATCH/DELETE | `/api/accounts/:id` | PATCH may include `credential` to rotate the stored key. |
| POST | `/api/accounts/:id/test` |
| GET | `/api/models` | Pool catalog: `{ id, enabled, accountIds[], aliasOf? }` |
| PATCH | `/api/models` | Body `{ id, enabled }`. Persists `config.models.disabled`. |
| POST | `/api/setup/opencode` | Writes `opencode.json` with currently enabled models. Optional body `{ file, baseUrl }`. |
| GET | `/api/sessions` |
| GET | `/api/sessions/:id` |
| GET | `/api/usage` | Request/cost rollups plus `windows` (same quota objects as the pool). |
| GET | `/api/oauth/usage` | Claude Code `/usage` JSON: `five_hour` / `seven_day` utilization 0–100. Unknown buckets are `null`. |
| GET | `/api/events` |
| GET | `/api/events/stream` (SSE) |
| GET/PATCH | `/api/config` |

SSE event names: `account.updated`, `account.cooldown`, `account.recovered`, `session.started`, `session.migrated`, `session.ended`, `usage.updated`, `models.updated`, `pool.error`.
