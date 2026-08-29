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

`setup opencode` writes `~/.config/opencode/opencode.json` (or `$OPENCODE_CONFIG`) and keeps unrelated providers. The dashboard Clients page can override the path before Connect. A `.bak.<timestamp>` copy is created first.

If the pool and OpenCode run in **separate containers** (Dokploy, Compose sidecar), Connect writes inside the pool container (`/home/node/.config/opencode/opencode.json` when the image runs as `node`). OpenCode as root reads `/root/.config/opencode/opencode.json`. Share one volume:

```yaml
services:
  pool:
    environment:
      OPENCODE_CONFIG: /home/node/.config/opencode/opencode.json
    volumes:
      - opencode-config:/home/node/.config/opencode
  opencode:
    volumes:
      - opencode-config:/root/.config/opencode

volumes:
  opencode-config:
```

Copy the existing OpenCode file into that volume before mounting, or a new empty volume will hide `/root/.config/opencode`. After Connect, the provider `baseURL` must be a hostname the OpenCode container can reach (the Compose service name), not `127.0.0.1`.

The OpenCode picker does not poll `GET /v1/models`. After toggling models in the dashboard, run `command-go-pool setup opencode` again or use **Sync with clients** on the Models page.

## Upstream protocol drift

`/alpha/generate` is undocumented. If Command Code changes the CLI envelope, only `packages/transport-commandcode` should need updates. See `docs/research.md`.

## Docker data empty after restart

Mount `/data` and set `COMMAND_GO_POOL_HOME=/data`. Also set `COMMAND_GO_POOL_HOST=0.0.0.0`. A pool API key is optional.

Published images: `ghcr.io/lczpln/command-go-pool:latest` (see [`docs/publish.md`](publish.md)). If `docker pull` returns `denied` or `not found`, the GHCR package is still private.
