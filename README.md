# Command Go Proxy

Local inference gateway that pools **user-owned** Command Code Go subscriptions into one sticky, quota-aware endpoint.

```bash
npx command-go-proxy
```

```text
API        http://127.0.0.1:8787/v1
Dashboard  http://127.0.0.1:8787
```

Clients (OpenCode, Claude Code, Cline, Roo Code, curl) see a single OpenAI/Anthropic URL. You see every account, quota window, session, and failover on the dashboard.

This project does **not** create accounts, purchase plans, scrape browser sessions, forge quota, or bypass upstream limits. Every request is executed against one credential you supplied.

## Install

```bash
npx command-go-proxy
# or
npm install -g command-go-proxy
command-go-proxy
```

Docker (must set a proxy API key; the container binds `0.0.0.0`):

```bash
docker run \
  -p 8787:8787 \
  -e COMMAND_GO_PROXY_HOST=0.0.0.0 \
  -e COMMAND_GO_PROXY_API_KEY=change-me \
  -v command-go-proxy:/data \
  command-go-proxy
```

## First run

Start the proxy, then add Command Code keys in the dashboard — not the CLI.

1. `command-go-proxy`
2. Open `http://127.0.0.1:8787`
3. On **Accounts**, paste a Studio API key (`user_…`)
4. The key is encrypted at rest and never shown again

Optional: set a local proxy key on **Settings** if clients should send `Authorization: Bearer`. Required when binding outside localhost.

`command-go-proxy init` and `account add` still work if you prefer the terminal.

## CLI

```bash
command-go-proxy              # start (add accounts in the dashboard)
command-go-proxy init
command-go-proxy start
command-go-proxy status
command-go-proxy doctor

command-go-proxy account add|list|remove|enable|disable|test

command-go-proxy setup opencode
command-go-proxy setup claude
```

## Inference API

| Method | Path |
| --- | --- |
| GET | `/v1/models` |
| POST | `/v1/chat/completions` |
| POST | `/v1/messages` |

Sticky session header: `X-Command-Go-Session`. Opt out with `X-Command-Go-Sticky: 0`.

Local proxy auth (required when not on localhost):

```text
Authorization: Bearer $COMMAND_GO_PROXY_API_KEY
```

## OpenCode

```bash
command-go-proxy setup opencode
```

Fetches enabled models from `GET /v1/models` and writes provider `command-go-pool`. Toggle the catalog on the dashboard **Models** page, then Sync OpenCode (or re-run setup) so the picker matches.

Manual provider (model ids come from the proxy):

```json
{
  "provider": {
    "command-go-pool": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Command Go Pool",
      "options": {
        "baseURL": "http://127.0.0.1:8787/v1",
        "apiKey": "proxy-managed"
      }
    }
  }
}
```

## Configuration

`~/.command-go-proxy/config.yaml`

```yaml
server:
  host: 127.0.0.1
  port: 8787
routing:
  mode: sticky
  sessionTtlHours: 24
  maxFailoversPerRequest: 2
quota:
  refreshIntervalSeconds: 60
dashboard:
  enabled: true
aliases:
  flash: deepseek/deepseek-v4-flash
  vision: deepseek/deepseek-v4-flash-vision-exp
models:
  disabled: []
```

Env: `COMMAND_GO_PROXY_HOST`, `COMMAND_GO_PROXY_PORT`, `COMMAND_GO_PROXY_API_KEY`, `COMMAND_GO_PROXY_MASTER_KEY`, `COMMAND_GO_PROXY_LOG_LEVEL`, `COMMAND_GO_PROXY_HOME`.

## How routing works

- Default **sticky**: a conversation stays on one account (prompt-cache affinity).
- New sessions pick the healthiest eligible account (quota dominates).
- Quota / auth / 5xx / timeout → cooldown + migrate (max 2 failovers). Invalid requests are not retried.
- Exhausted accounts rejoin automatically after reset.

Quota UI labels **exact** upstream values vs **estimated** local usage vs **unavailable**. It will not invent precision.

## Security

- Default bind `127.0.0.1` (never `0.0.0.0` unless you set it).
- Credentials encrypted at rest; SQLite stores a reference only.
- Admin JSON never includes secrets.
- Prompts are not persisted. Telemetry is off.

## Development

```bash
npm install
npm test
npm run test:e2e
npm run demo
npm run dev
```

Architecture: `docs/architecture.md`. Research: `docs/research.md`. Troubleshooting: `docs/troubleshooting.md`.

## License

MIT
