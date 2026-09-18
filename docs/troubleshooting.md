# Troubleshooting

## Authentication failed

- Use a Studio API key (`user_…`), not a browser cookie.
- Paste it on the dashboard **Accounts** page (or `command-go-pool account add`).
- Confirm the key with the Command Code CLI: `COMMAND_CODE_API_KEY=… cmd status`
- The pool never reads `~/.commandcode/auth.json` unless you paste that key yourself.

## Go plan and `/provider/v1/chat/completions`

Official Provider API generation is not included on Go (`upgrade_required`). This pool uses the isolated CLI generation adapter instead. Do not point clients at `https://api.commandcode.ai/provider/v1` for Go accounts.

## Quota shows Unavailable

Command Code may omit rolling-window fields on the API-key billing surface. The dashboard then shows remaining monthly credits when that number arrives, and empty 5h/weekly bars rather than fake percentages. Exhaustion is still detected from upstream error text (including reset time). Re-add or Inspect → Test the account after updating so a fresh `/alpha/billing/credits` snapshot is stored.

## Estimated vs exact

`~61%` or “Estimated from local usage” means the number is derived from observed tokens/cost, not an upstream meter. Exact values come from billing/window payloads.

## Codex Desktop will not talk to the pool

Codex only speaks the Responses API. Confirm `POST /v1/responses` exists (this pool version) and that `~/.codex/config.toml` has:

- `model_provider = "command-go-pool"` in the **user** file (not a project `.codex/config.toml`)
- `[model_providers.command-go-pool]` with `base_url = "http://127.0.0.1:8787/v1"` and `wire_api = "responses"`
- a Go model id (`deepseek/deepseek-v4-flash` or `pro`/`flash`), not `gpt-5`
- `requires_openai_auth = false` and `supports_websockets = false`

Restart Codex Desktop after editing. `command-go-pool setup codex` writes this file. If the stream starts then goes silent, raise `stream_idle_timeout_ms` (setup uses `600000`).

## Claude Code / OpenCode usage is empty

The dashboard **Usage** page is local request rollups (`GET /api/usage`). Client `/usage` meters come from pooled quota windows:

- Claude Code reads `anthropic-ratelimit-unified-*` on `POST /v1/messages`. Inspect an account (or wait for the health refresh) so `/alpha/billing/credits` windows are stored.
- OpenCode and scripts: `GET /v1/usage`. Unknown windows return `"status": "unavailable"`.
- Claude Code JSON: `GET /api/oauth/usage`. Unknown buckets are `null`.

If every account still shows Unavailable 5h/weekly bars on the dashboard, clients will not get those meters either.

## Streaming hangs before first token

Reasoning models often emit `reasoning-delta` for several seconds before text. That is upstream behavior. Idle timeout (default 120s) closes a stalled stream.

## Bound to 0.0.0.0

A pool API key is optional. If you set one, admin and inference routes then require that key. Generate it on Settings or with `command-go-pool rotate` so connected CLIs pick it up.

To lock the dashboard itself, set `COMMAND_GO_POOL_DASHBOARD_PASSWORD` and restart. Sign in at the UI. Change or remove the password only by changing that env var — not from Settings or the CLI. Put TLS (Caddy/nginx) in front of a public bind; the cookie is `Secure` only on HTTPS.

Forgot the dashboard password: unset or replace `COMMAND_GO_POOL_DASHBOARD_PASSWORD` on the host and restart. There is no in-app recovery.

## OpenCode did not pick up the provider

`setup opencode` writes `~/.config/opencode/opencode.json` and keeps unrelated providers. If your OpenCode version uses another path, set `OPENCODE_CONFIG`. A `.bak.<timestamp>` copy is created first.

The OpenCode picker does not poll `GET /v1/models`. After toggling models in the dashboard, run `command-go-pool setup opencode` again or use **Sync with clients** on the Models page.

## Upstream protocol drift

`/alpha/generate` is undocumented. If Command Code changes the CLI envelope, only `packages/transport-commandcode` should need updates. See `docs/research.md`.

## Docker data empty after restart

Mount `/data` and set `COMMAND_GO_POOL_HOME=/data`. Also set `COMMAND_GO_POOL_HOST=0.0.0.0`. A pool API key is optional.

Published images: `ghcr.io/lczpln/command-go-pool:latest` (see [`docs/publish.md`](publish.md)). If `docker pull` returns `denied` or `not found`, the GHCR package is still private.
