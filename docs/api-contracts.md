# API contracts

## Inference (`/v1`)

Auth: if `server.apiKey` or `COMMAND_GO_POOL_API_KEY` is set, require `Authorization: Bearer` or `x-api-key`. Required when bind host is not loopback.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/v1/models` | Union of models usable by at least one **available** account, minus `config.models.disabled`. Aliases are included only when their target is enabled. |
| POST | `/v1/chat/completions` | OpenAI. Stream = SSE `data:` chunks, forwarded immediately. Disabled models return `400 unsupported_model`. |
| POST | `/v1/messages` | Anthropic. Stream = `event:` + `data:` frames. Disabled models return `400 unsupported_model`. |

Unsupported upstream features return a clear compatibility error (`invalid_request` / `unsupported_model`), never a silent fake.

Headers:

- `X-Command-Go-Session` — sticky session id
- `X-Command-Go-Routing` — `sticky` \| `balanced` \| `most-available` \| `round-robin` (request override)
- `X-Command-Go-Sticky: 0` — opt out of stickiness for this request

## Admin (`/api`)

Same auth rules. Never includes credential material.

| Method | Path |
| --- | --- |
| GET | `/api/health` |
| GET/POST | `/api/accounts` | POST body: `{ label, credential, monthlySubscriptionCost? }`. Response never includes the secret. |
| PATCH/DELETE | `/api/accounts/:id` | PATCH may include `credential` to rotate the stored key. |
| POST | `/api/accounts/:id/test` |
| GET | `/api/models` | Pool catalog: `{ id, enabled, accountIds[], aliasOf? }` |
| PATCH | `/api/models` | Body `{ id, enabled }`. Persists `config.models.disabled`. |
| POST | `/api/setup/opencode` | Writes `opencode.json` with currently enabled models. Optional body `{ file, baseUrl }`. |
| GET | `/api/sessions` |
| GET | `/api/sessions/:id` |
| GET | `/api/usage` |
| GET | `/api/events` |
| GET | `/api/events/stream` (SSE) |
| GET/PATCH | `/api/config` |

SSE event names: `account.updated`, `account.cooldown`, `account.recovered`, `session.started`, `session.migrated`, `session.ended`, `usage.updated`, `models.updated`, `pool.error`.
