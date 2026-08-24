# Milestone 0 — Research findings

Inspected official Command Code docs and community implementations **for protocol behavior only**. Licenses of those projects were checked; this repository does not copy their source.

## Official product

- CLI package: `command-code` (`cmd` / `command-code`). Requires Node 22+ for the official CLI; this proxy targets Node 20+ independently.
- Auth: user-owned API keys from Studio (`user_…`). Stored by the CLI at `~/.commandcode/auth.json` (mode 0600). Env override: `COMMAND_CODE_API_KEY`.
- Login: `cmd login` (browser OAuth or pasted key). We never scrape browser sessions.
- Headless: `cmd -p` / `--print` is an **agent loop** (tools, sessions, exit codes). It is not a drop-in OpenAI generation transport. Useful for auth/status fallback (`cmd status`, exit codes 3/5/7/10), not for streaming client tool-calls.
- Quota UX: interactive `/usage` shows 5-hour and weekly rolling meters. Windows open on first request and reset after 5h / 7d. Extra PAYG credits skip window caps.
- Go plan (published): $1/mo, $10 monthly credits, $3 per 5-hour window, $6 weekly. Caps are credit-value, not request counts.
- Official generation API (`/provider/v1/chat/completions` and `/provider/v1/messages`) is **not available on Go**. Go returns `upgrade_required`. Model listing `GET /provider/v1/models` is readable on Go.

## Generation transport used by the CLI

Community proxies and the CLI itself use:

```
POST https://api.commandcode.ai/alpha/generate
Authorization: Bearer user_…
x-command-code-version: <cli version>
x-session-id: <uuid>
```

This endpoint is **undocumented** and Vercel AI SDK flavored. It is what the official `cmd` CLI uses, so it is not plan-gated the way `/provider/v1/*` is.

**Decision:** isolate this entire wire format behind `CommandCodeTransport`. Routing, protocols, and the dashboard must not know about `/alpha/generate`. Document it as an isolated adapter that may break when Command Code changes the CLI.

### Request envelope (strict)

```jsonc
{
  "config": {
    "workingDir": string,
    "date": string,
    "environment": "production",
    "structure": [],
    "isGitRepo": false,
    "currentBranch": "",
    "mainBranch": "",
    "gitStatus": "",
    "recentCommits": []
  },
  "memory": "",
  "taste": null,
  "skills": null,
  "permissionMode": "standard",
  "params": {
    "model": "deepseek/deepseek-v4-flash",
    "system": string,
    "messages": [ /* Vercel AI SDK ModelMessage[] */ ],
    "tools": [{ "name", "description", "input_schema" }],
    "max_tokens": number,
    "temperature": number,
    "stream": true
  }
}
```

Omitting required `config` fields returns 400 validation errors.

### Messages

Not OpenAI and not Anthropic. Roles: `user`, `assistant`, `tool`. Content parts: `text`, `image` (`image` + `mediaType`), `tool-call`, `tool-result` with `output: { type: "text"|"error-text", value }`.

### Stream

NDJSON (newline JSON objects), **not** SSE. Events include `start`, `reasoning-start/delta/end`, `text-start/delta/end`, `tool-input-start/delta/end`, `tool-call`, `finish-step`, `finish`, `error`.

Usage on finish includes `inputTokens`, `cachedInputTokens` / `inputTokenDetails.cacheReadTokens`, `outputTokens`, `reasoningTokens`, and sometimes `providerMetadata.gateway.cost` (actual USD, not plan credits).

## Auth / quota HTTP (API key, no cookies)

Used only inside the transport adapter:

| Call | Purpose |
| --- | --- |
| `GET /alpha/whoami` | Credential test |
| `GET /alpha/billing/credits` | Remaining monthly/purchased credits; may include `windowLimits` |
| `GET /alpha/billing/subscriptions` | `planId`, period end (optional) |
| `GET /provider/v1/models` | Live catalog |

`/internal/billing/*` is cookie-session based. **We do not use it** (no browser scraping).

Quota source priority in this project:

1. `windowLimits` / credit fields from `/alpha/billing/credits` when present → `source: upstream`, `confidence: exact` for fields that actually arrived
2. Plan catalog totals matched against observed remaining (only when caps corroborate) → still labeled
3. Error bodies that name a window and reset time
4. Local observed consumption → `source: local-estimate`, `confidence: estimated`
5. Unknown → render “Unavailable”, never a fake percentage

Monthly remaining is **remaining**, not a total. Do not invert the meter. Go totals ($10 / $3 / $6) are used only as denominators when they match published plan identity.

## Error semantics (normalized)

Observed upstream:

| Signal | ProxyError |
| --- | --- |
| 401 / `UNAUTHORIZED` | `auth_failed` |
| insufficient credits | `insufficient_credit` |
| 5-hour / weekly usage limit + reset time | `quota_exhausted` |
| 429 / `rate_limit_error` | `rate_limited` |
| 5xx | `upstream_5xx` |
| timeout / fetch abort | `timeout` / `client_cancelled` |
| invalid ModelMessage / validation | `invalid_request` |
| unknown model | `unsupported_model` |

CLI headless exit codes (fallback only): 3 auth, 5 rate limit, 6 network, 7 5xx, 10 insufficient credits.

## Community projects (behavior only)

| Project | License | Notes |
| --- | --- | --- |
| `thaolaptrinh/commandcode-api-proxy` | MIT | TS proxy, `/alpha/generate`, OpenAI+Anthropic, OpenCode/Claude setup. Single account. |
| `MAXeaglet/commandcode-proxy` | MIT | Single-file Node, tools, vision, cache metrics. Default bind `0.0.0.0` (we will not). |
| Go proxies (`command-code-proxy-server`, `Command-Code-AI-Proxy`, `cmdcode2api`, `CommandCodeBridge`) | various | Same generate endpoint. Spec’s `commandcode-proxy-go` name maps to this family; no one canonical repo. |
| `safzanpirani/pi-commandcode-provider` | (docs used) | Best wire-protocol writeup. Not copied. |

**We do not fork these.** Architecture isolates the adapter so CLI/HTTP/future official API can swap.

## Models

Do not hardcode the full catalog. Fetch `/provider/v1/models`, cache, expose aliases from config. DeepSeek V4 Flash / Flash Vision Exp / Pro are the Go-plan coding models of record. Vision is explicit (alias or requested model), not automatic escalation.

## Constraints we encode

- User-supplied keys only; no account creation or purchase automation
- No quota bypass; cooldown respects reset times
- Never forge quota precision
- Default bind `127.0.0.1`
- Credentials never logged, never returned by admin APIs
- Telemetry off
- Prompts not persisted
