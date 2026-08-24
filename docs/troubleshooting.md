# Troubleshooting

## Authentication failed

- Use a Studio API key (`user_…`), not a browser cookie.
- Paste it on the dashboard **Accounts** page (or `command-go-proxy account add`).
- Confirm the key with the Command Code CLI: `COMMAND_CODE_API_KEY=… cmd status`
- The proxy never reads `~/.commandcode/auth.json` unless you paste that key yourself.

## Go plan and `/provider/v1/chat/completions`

Official Provider API generation is not included on Go (`upgrade_required`). This proxy uses the isolated CLI generation adapter instead. Do not point clients at `https://api.commandcode.ai/provider/v1` for Go accounts.

## Quota shows Unavailable

Command Code may omit rolling-window fields on the API-key billing surface. The dashboard then shows remaining monthly credits when that number arrives, and empty 5h/weekly bars rather than fake percentages. Exhaustion is still detected from upstream error text (including reset time). Re-add or Inspect → Test the account after updating so a fresh `/alpha/billing/credits` snapshot is stored.

## Estimated vs exact

`~61%` or “Estimated from local usage” means the number is derived from observed tokens/cost, not an upstream meter. Exact values come from billing/window payloads.

## Streaming hangs before first token

Reasoning models often emit `reasoning-delta` for several seconds before text. That is upstream behavior. Idle timeout (default 120s) closes a stalled stream.

## Bound to 0.0.0.0 and 403

Non-loopback binds require `COMMAND_GO_PROXY_API_KEY`. Admin and inference routes then require that key.

## OpenCode did not pick up the provider

`setup opencode` writes `~/.config/opencode/opencode.json` and keeps unrelated providers. If your OpenCode version uses another path, set `OPENCODE_CONFIG`. A `.bak.<timestamp>` copy is created first.

## Upstream protocol drift

`/alpha/generate` is undocumented. If Command Code changes the CLI envelope, only `packages/transport-commandcode` should need updates. See `docs/research.md`.

## Docker data empty after restart

Mount `/data` and set `COMMAND_GO_PROXY_HOME=/data`. Also set `COMMAND_GO_PROXY_HOST=0.0.0.0` and `COMMAND_GO_PROXY_API_KEY`.
