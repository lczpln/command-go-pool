# Command Go Pool

Local inference gateway that pools **user-owned** Command Code Go subscriptions into one sticky, quota-aware endpoint.

Clients (OpenCode, Claude Code, Cline, Roo Code, curl) see a single OpenAI- and Anthropic-compatible URL. You see every account, quota window, session, and failover on the dashboard.

```bash
npx command-go-pool@latest
```

```text
API        http://127.0.0.1:8787/v1
Dashboard  http://127.0.0.1:8787
```

**Requirements:** Node.js 20 or later.

This project does **not** create accounts, purchase plans, scrape browser sessions, forge quota, or bypass upstream limits. Every request is executed against one credential you supplied.

---

## Table of contents

- [Install](#install)
- [Quick start](#quick-start)
- [CLI reference](#cli-reference)
- [Dashboard](#dashboard)
- [Inference API](#inference-api)
- [Client integrations](#client-integrations)
- [Configuration](#configuration)
- [Environment variables](#environment-variables)
- [How routing works](#how-routing-works)
- [Security](#security)
- [Data directory](#data-directory)
- [Docker](#docker)
- [Development](#development)
- [Documentation](#documentation)
- [License](#license)

---

## Install

### npx (no install)

```bash
npx command-go-pool@latest
```

### Global CLI

```bash
npm install -g command-go-pool
command-go-pool --help
```

### Docker

Published images are on GHCR. Tags match npm (`0.1.6`, `latest`).

```bash
docker pull ghcr.io/lczpln/command-go-pool:latest
```

See [Docker](#docker) for `docker run` and Compose.

### From source

```bash
git clone https://github.com/lczpln/command-go-pool.git
cd command-go-pool
npm install
npm run build
node dist/cli.js
```

During development you can skip the build step with `npm run dev` (see [Development](#development)).

---

## Quick start

Start the pool, then add Command Code keys in the dashboard — not the CLI.

1. Run `command-go-pool` (or `npx command-go-pool@latest`).
2. Open [http://127.0.0.1:8787](http://127.0.0.1:8787).
3. On **Accounts**, paste a Studio API key (`user_…`).
4. The key is encrypted at rest and never shown again.

Optional: generate a local pool key on **Settings** if you want clients to send `Authorization: Bearer`. It is never required. Generating or rotating it updates every connected CLI on the **Clients** page.

On a VPS or any non-loopback bind, set `COMMAND_GO_POOL_DASHBOARD_PASSWORD` before start so the UI asks for a login. See [Dashboard](#dashboard).

`command-go-pool init` and `command-go-pool account add` still work if you prefer the terminal.

Use a Studio API key (`user_…`), not a browser cookie. The pool never reads `~/.commandcode/auth.json` unless you paste that key yourself.

---

## CLI reference

The binary is `command-go-pool`. Running it with no subcommand is the same as `start`.

```bash
command-go-pool --help
command-go-pool --version
```

| Command | Description |
| --- | --- |
| `command-go-pool` | Start the gateway (same as `start`) |
| `command-go-pool start` | Start the gateway; add accounts in the dashboard |
| `command-go-pool init` | Create `config.yaml`, wire local CLIs, and optionally add accounts interactively |
| `command-go-pool status` | Print bind URL, account counts, sessions, and quota meters |
| `command-go-pool doctor` | Check the data directory, SQLite, config, secrets, and auth |
| `command-go-pool rotate` | Generate a pool API key and write it into connected CLIs |
| `command-go-pool account …` | Add, list, remove, enable, disable, or test accounts |
| `command-go-pool client …` | List, connect, or disconnect local CLIs |
| `command-go-pool setup opencode` | Alias of `client connect opencode` |
| `command-go-pool setup claude` | Alias of `client connect claude` |

### Start the pool

```bash
command-go-pool
# equivalent
command-go-pool start
```

Creates a default config on first run if none exists. On an interactive TTY it also detects compatible CLIs (OpenCode, Claude Code), lets you Space-select which to wire, then writes pool config into each selected CLI folder. It does **not** generate a pool API key. Then serves:

- Inference at `http://<host>:<port>/v1`
- Dashboard at `http://<host>:<port>`

Press `Ctrl+C` to stop. On startup the CLI prints loaded accounts, available models, and pooled 5h / weekly / monthly quota.

Host and port come from `~/.command-go-pool/config.yaml` and can be overridden with `COMMAND_GO_POOL_HOST` / `COMMAND_GO_POOL_PORT`. Set `COMMAND_GO_POOL_DASHBOARD_PASSWORD` to lock the dashboard.

### First-run wizard

```bash
command-go-pool init
```

Writes the default config, then prompts for account labels and Studio API keys. Each key is tested against Command Code before it is kept. You can add more than one account. On a TTY it then detects local CLIs and asks which ones to wire (Space to select, Enter to confirm). You can start the pool from the same prompt.

Prefer the dashboard for day-to-day account management; `init` is the terminal path.

### Rotate pool key

```bash
command-go-pool rotate
```

Optional. Prints a new `cgp_…` key once and writes it into every connected CLI. Same as **Generate** / **Rotate** on Settings.

### Client connections

```bash
command-go-pool client list
command-go-pool client connect
command-go-pool client connect opencode claude
command-go-pool client disconnect opencode
```

`connect` without ids opens the same Space-to-select prompt as first-run. `setup opencode` / `setup claude` remain as aliases.

### Status

```bash
command-go-pool status
```

Prints a compact snapshot without starting the HTTP server:

```text
Command Go Pool

API        http://127.0.0.1:8787/v1
Dashboard  http://127.0.0.1:8787

Accounts   3
Available  2
Cooldown   1
Sessions   4

Pool status
5h        ██████░░░░   61% available
Weekly    ████████░░   80% available
Monthly   Unavailable
```

Quota lines prefixed with `~` are **estimated** from local usage, not an upstream meter. `Unavailable` means Command Code did not return that window.

### Doctor

```bash
command-go-pool doctor
```

Health checks for the local install. Exit code `0` if all pass, `1` otherwise.

| Check | What it verifies |
| --- | --- |
| `data directory` | `~/.command-go-pool` (or `COMMAND_GO_POOL_HOME`) exists |
| `sqlite` | `state.db` is present |
| `config` | `config.yaml` is present |
| `secret store` | `secrets.bin` exists, or no accounts are configured yet |
| `pool API key` | Optional. Reports whether a pool API key is stored |
| `accounts` | At least one account is stored |
| `auth` | No stored account is stuck in `auth_error` |

Example:

```text
✓ data directory    /home/you/.command-go-pool
✓ sqlite            /home/you/.command-go-pool/state.db
✓ config            /home/you/.command-go-pool/config.yaml
✓ secret store      /home/you/.command-go-pool/secrets.bin
✓ pool API key      set
✓ accounts          2 configured
✓ auth              2 without auth_error
```

### Account management

```bash
command-go-pool account add
command-go-pool account list
command-go-pool account test <id>
command-go-pool account enable <id>
command-go-pool account disable <id>
command-go-pool account remove <id>
```

#### `account add`

Interactive. Prompts for:

1. **Label** — display name (default `Go #01`, `Go #02`, …)
2. **Credential** — Studio API key (`user_…`), masked in the terminal
3. **Monthly subscription cost** — optional, used for subsidy math on the dashboard (default `1`)

The key is tested immediately. On success the account is stored encrypted and models are discovered. On failure the account is **not** kept.

#### `account list`

```text
acc_01HZX…  Go #01           available        sessions=2
acc_01HZY…  Go #02           cooldown         sessions=0
```

IDs from this list are the arguments for `test`, `enable`, `disable`, and `remove`.

#### `account test <id>`

Calls Command Code with the stored credential and prints `✓` or `✗` plus the transport message. Does not change account state by itself.

#### `account enable` / `account disable`

Toggle whether the router may pick the account. Disabled accounts stay in the database and keep their encrypted key.

#### `account remove <id>`

Deletes the account row and its stored secret. Sessions bound to it are no longer routed there.

### Client setup

```bash
command-go-pool client list
command-go-pool client connect
command-go-pool setup opencode
command-go-pool setup claude
```

These write **local client config** that points at the pool. They do not start the server. See [Client integrations](#client-integrations).

---

## Dashboard

With the pool running, open [http://127.0.0.1:8787](http://127.0.0.1:8787).

On loopback the UI is open. To lock it, set `COMMAND_GO_POOL_DASHBOARD_PASSWORD` and restart:

```bash
export COMMAND_GO_POOL_DASHBOARD_PASSWORD=change-me
command-go-pool
```

Sign in at the UI. The password is env-only — not stored in `config.yaml`, and it cannot be set, changed, or removed from Settings or the CLI. Change or unset the env var and restart. The login cookie does **not** authorize `/v1` inference; that still uses the optional pool API key.

| Page | Purpose |
| --- | --- |
| Overview | Pool health, quota bars, live account mix |
| Accounts | Paste Studio keys, inspect, test, enable/disable |
| Clients | Connect or disconnect local CLIs (OpenCode, Claude Code) |
| Models | Toggle which model ids the pool exposes; Sync with clients |
| Sessions | Sticky bindings, migrations, token usage |
| Usage | Request/cost rollups over time |
| Events | Live stream of cooldowns, failovers, errors |
| Settings | Optional pool API key, bind/routing snapshot |

Admin JSON never includes secrets. Rotate a key from Accounts (or `PATCH /api/accounts/:id`) rather than editing files by hand.

---

## Inference API

Base URL: `http://127.0.0.1:8787/v1`

| Method | Path | Protocol |
| --- | --- | --- |
| `GET` | `/v1/models` | OpenAI-style catalog |
| `POST` | `/v1/chat/completions` | OpenAI Chat Completions (SSE when `stream: true`) |
| `POST` | `/v1/messages` | Anthropic Messages (SSE when `stream: true`) |
| `GET` | `/v1/usage` | Pooled 5h / weekly / monthly windows (OpenCode Go shape) |

`GET /v1/models` is the union of models usable by at least one **available** account, minus `config.models.disabled`. Aliases (`flash`, `vision`, `pro`) appear only when their target is enabled. Disabled or unknown models return `400 unsupported_model` — the pool never silently substitutes.

Inference responses also carry Anthropic `anthropic-ratelimit-unified-*` headers (and OpenAI `x-ratelimit-*` when a window is known) so Claude Code `/usage` can render the same meters. Unknown windows are omitted — the pool will not invent a percentage.

`GET /api/oauth/usage` is the Claude Code OAuth usage JSON (`five_hour` / `seven_day`). Same auth rules as other `/api` routes. Dashboard rollups stay on `GET /api/usage`.

### Auth

A pool API key is **optional**. Inference works without one, including when bound outside localhost. Lock the dashboard separately with `COMMAND_GO_POOL_DASHBOARD_PASSWORD` (see [Dashboard](#dashboard)). The login cookie does not authorize `/v1`.

If you generate one (`command-go-pool rotate` or Settings), clients must send:

```http
Authorization: Bearer <pool API key>
```

or:

```http
x-api-key: <pool API key>
```

Generating or rotating the key updates every connected CLI automatically. This is the **pool** key, not a Command Code `user_…` key. Upstream credentials never leave the gateway.

### Sticky and routing headers

| Header | Effect |
| --- | --- |
| `X-Command-Go-Session` | Sticky session id (preferred) |
| `X-Command-Go-Sticky: 0` | Opt out of stickiness for this request |
| `X-Command-Go-Routing` | Per-request override: `sticky`, `balanced`, `most-available`, `round-robin` |

If the client cannot set extra headers, the pool fingerprints `model + system + first user text` (with a collision suffix) so a conversation still stays on one account.

Session id priority: `X-Command-Go-Session` → OpenAI/Anthropic metadata → `prompt_cache_key` → client hints → fingerprint.

### curl

If you generated a pool API key, set `COMMAND_GO_POOL_API_KEY` to that `cgp_…` value. Skip the header when no key is set.

List models:

```bash
curl -s http://127.0.0.1:8787/v1/models \
  -H "Authorization: Bearer $COMMAND_GO_POOL_API_KEY"
```

OpenAI-compatible chat (non-streaming):

```bash
curl -s http://127.0.0.1:8787/v1/chat/completions \
  -H "Authorization: Bearer $COMMAND_GO_POOL_API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Command-Go-Session: my-coding-session" \
  -d '{
    "model": "deepseek/deepseek-v4-flash",
    "messages": [{"role": "user", "content": "Say hello in one sentence."}]
  }'
```

Streaming:

```bash
curl -N http://127.0.0.1:8787/v1/chat/completions \
  -H "Authorization: Bearer $COMMAND_GO_POOL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "flash",
    "stream": true,
    "messages": [{"role": "user", "content": "Count to three."}]
  }'
```

Anthropic-compatible messages:

```bash
curl -s http://127.0.0.1:8787/v1/messages \
  -H "Authorization: Bearer $COMMAND_GO_POOL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek/deepseek-v4-pro",
    "max_tokens": 256,
    "messages": [{"role": "user", "content": "Say hello in one sentence."}]
  }'
```

Admin routes live under `/api` (health, accounts, models, sessions, usage, events, config). Same auth rules. Contracts: [`docs/api-contracts.md`](docs/api-contracts.md).

---

## Client integrations

### OpenCode

With the pool running:

```bash
command-go-pool setup opencode
```

This command:

1. Reads `~/.config/opencode/opencode.json` (or `$OPENCODE_CONFIG`)
2. Writes a timestamped `.bak.<timestamp>` copy if the file exists
3. Fetches enabled models from `GET /v1/models` (falls back to the three DeepSeek Go models if the pool is down)
4. Adds provider `command-go-pool` pointing at `http://127.0.0.1:8787/v1`
5. Leaves other providers in place

Select **Command Go Pool** in the OpenCode model picker.

The picker does **not** poll `/v1/models`. After toggling models on the dashboard, run setup again or use **Sync with clients** on the Models page (updates every connected client config, including OpenCode).

Manual provider (model ids come from the pool):

```json
{
  "provider": {
    "command-go-pool": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Command Go Pool",
      "options": {
        "baseURL": "http://127.0.0.1:8787/v1",
        "apiKey": "pool-managed"
      }
    }
  }
}
```

Use `pool-managed` until you generate a pool API key (`cgp_…`). `setup opencode` writes the saved key, or the placeholder if none is set.

Pool quota for OpenCode and plugins:

```bash
curl -s http://127.0.0.1:8787/v1/usage \
  -H "Authorization: Bearer $COMMAND_GO_POOL_API_KEY"
```

Returns `{ usage: { rolling, weekly, monthly } }` with used `percent` and `resetsAt`, matching OpenCode Go. A window Command Code did not report is `{ "status": "unavailable" }`.

### Claude Code

```bash
command-go-pool setup claude
```

Writes `~/.claude/command-go-pool.json`. It only sets `ANTHROPIC_*` for the pool and does **not** modify `~/.claude/settings.json`.

```bash
claude --settings ~/.claude/command-go-pool.json
```

Manual equivalent:

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:8787
export ANTHROPIC_API_KEY=pool-managed
export ANTHROPIC_DEFAULT_SONNET_MODEL=deepseek/deepseek-v4-pro
export ANTHROPIC_DEFAULT_OPUS_MODEL=deepseek/deepseek-v4-pro
export ANTHROPIC_DEFAULT_HAIKU_MODEL=deepseek/deepseek-v4-flash
```

`/usage` in Claude Code reads `anthropic-ratelimit-unified-*` headers on `POST /v1/messages`. The pool sets those from aggregated account windows. A `max_tokens: 1` ping whose only user text is `quota` is answered locally so it does not spend Go quota.

JSON for scripts and statuslines:

```bash
curl -s http://127.0.0.1:8787/api/oauth/usage
curl -s http://127.0.0.1:8787/v1/usage \
  -H "Authorization: Bearer $COMMAND_GO_POOL_API_KEY"
```

More detail: [`docs/claude.md`](docs/claude.md).

### Other OpenAI-compatible clients

Point Cline, Roo Code, Continue, or any OpenAI SDK at:

```text
base URL  http://127.0.0.1:8787/v1
API key   pool-managed   (or your COMMAND_GO_POOL_API_KEY if you generated one)
```

Do **not** point Go accounts at `https://api.commandcode.ai/provider/v1` for generation. Official Provider API chat is not included on Go (`upgrade_required`). This pool uses an isolated generation adapter instead.

---

## Configuration

File: `~/.command-go-pool/config.yaml`  
Example: [`examples/config.yaml`](examples/config.yaml)

```yaml
server:
  host: 127.0.0.1
  port: 8787
  # apiKey is optional. Generate with `command-go-pool rotate` or Settings. Override with COMMAND_GO_POOL_API_KEY.
routing:
  mode: sticky                 # sticky | balanced | most-available | round-robin
  sessionTtlHours: 24
  maxFailoversPerRequest: 2
quota:
  refreshIntervalSeconds: 60
dashboard:
  enabled: true
models:
  disabled: []                 # model ids hidden from GET /v1/models
transport:
  apiBase: https://api.commandcode.ai
  timeoutMs: 600000
  idleTimeoutMs: 120000
fallback:
  enabled: false               # external PAYG fallback is out of MVP
```

Environment variables override `server.host`, `server.port`, and `server.apiKey` at load time.

---

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `COMMAND_GO_POOL_HOST` | `127.0.0.1` | Bind address |
| `COMMAND_GO_POOL_PORT` | `8787` | Bind port |
| `COMMAND_GO_POOL_API_KEY` | unset | Optional. If set, gate inference (and admin when not on loopback) |
| `COMMAND_GO_POOL_DASHBOARD_PASSWORD` | unset | Optional. Locks the dashboard. Env only; restart to change. |
| `COMMAND_GO_POOL_MASTER_KEY` | generated `master.key` | AES-256-GCM key for `secrets.bin` |
| `COMMAND_GO_POOL_HOME` | `~/.command-go-pool` | Data directory (`state.db`, config, secrets, logs) |
| `COMMAND_GO_POOL_LOG_LEVEL` | `info` | Pino log level |
| `OPENCODE_CONFIG` | `~/.config/opencode/opencode.json` | Path written by `setup opencode` |

A template lives in [`.env.example`](.env.example). Docker typically sets `COMMAND_GO_POOL_HOST=0.0.0.0`. A pool API key is optional. Set `COMMAND_GO_POOL_DASHBOARD_PASSWORD` if the dashboard will be reachable from the network.

---

## How routing works

- Default **sticky**: a conversation stays on one account (prompt-cache affinity).
- New sessions pick the healthiest eligible account (quota dominates).
- Quota / auth / 5xx / timeout → cooldown + migrate (max 2 failovers per request). Invalid client requests are not retried.
- Exhausted accounts rejoin automatically after reset.

Quota UI labels **exact** upstream values vs **estimated** local usage vs **unavailable**. It will not invent precision.

`~61%` or “Estimated from local usage” means the number is derived from observed tokens/cost, not an upstream meter.

---

## Security

- Default bind is `127.0.0.1`. A pool API key is optional on any bind. If you set one, inference requires it; off-loopback admin routes require it too. Generate/rotate updates connected CLIs.
- `COMMAND_GO_POOL_DASHBOARD_PASSWORD` locks the dashboard (login cookie). It is not stored in `config.yaml` and cannot be changed from the UI or CLI. Use TLS in front of a public bind.
- Credentials are encrypted at rest (AES-256-GCM in `secrets.bin`). SQLite stores a `credential_ref` only.
- Optional OS keychain when the `keytar` native module loads.
- Admin JSON never includes secrets. The dashboard never returns credentials.
- Prompts are not persisted. Telemetry is off.
- Data directory mode `0700`; db / config / secrets mode `0600`.

---

## Data directory

Default: `~/.command-go-pool/` (`COMMAND_GO_POOL_HOME` override). If an older `~/.command-go-proxy` directory already exists, it is reused.

| File | Contents |
| --- | --- |
| `config.yaml` | Bind, routing, disabled models, connected CLIs |
| `state.db` | Accounts metadata, sessions, usage, events |
| `secrets.bin` | Encrypted Command Code keys |
| `master.key` | Local wrapping key (unless `COMMAND_GO_POOL_MASTER_KEY` is set) |
| `logs/` | Process logs |

Schema: [`docs/schema.md`](docs/schema.md).

---

## Docker

The container binds `0.0.0.0`. A pool API key is optional; generate one if you want to lock the endpoint. Set `COMMAND_GO_POOL_DASHBOARD_PASSWORD` to lock the UI. Persist `/data`. Put TLS in front of a public port.

Images are published to GHCR on each `v*` release tag, or by running the **publish** workflow with target **docker** (`linux/amd64` and `linux/arm64`). See [`docs/publish.md`](docs/publish.md).

```text
ghcr.io/lczpln/command-go-pool:latest
ghcr.io/lczpln/command-go-pool:0.1.6
```

```bash
docker run \
  -p 8787:8787 \
  -e COMMAND_GO_POOL_HOST=0.0.0.0 \
  -e COMMAND_GO_POOL_DASHBOARD_PASSWORD=change-me \
  -v command-go-pool:/data \
  ghcr.io/lczpln/command-go-pool:latest
```

Compose (pulls the published image):

```bash
docker compose up
```

Build locally instead of pulling:

```bash
docker compose up --build
```

[`docker-compose.yml`](docker-compose.yml) maps port `8787` and a named volume onto `/data`. Inside the image, `COMMAND_GO_POOL_HOME=/data`. A pool API key is optional; generate one on Settings or with `command-go-pool rotate` if you want to lock the endpoint. Set `COMMAND_GO_POOL_DASHBOARD_PASSWORD` in the environment to lock the dashboard.

If data looks empty after a restart, the volume was not mounted. See [`docs/troubleshooting.md`](docs/troubleshooting.md).

---

## Development

```bash
npm install
npm test                 # Vitest (unit, integration, chaos)
npm run test:e2e         # Playwright against the mock transport
npm run typecheck
npm run build            # CLI + dashboard → dist/
npm run dev              # tsx packages/cli/src/index.ts
npm run dev:dashboard    # Vite dashboard only
npm run demo             # mock-transport demo with sample accounts
```

```text
cli → server → protocol-openai
             → protocol-anthropic
             → session-router → account-pool → quota-engine
             → transport-commandcode
             → storage
             → observability
             → shared
dashboard (Vite static) ──served by── server
```

CI (`.github/workflows/ci.yml`) runs install, unit tests, build, and Playwright on Node 20.

---

## Documentation

| Doc | Topic |
| --- | --- |
| [`docs/architecture.md`](docs/architecture.md) | ADRs: transport isolation, sticky sessions, quota honesty, secrets |
| [`docs/api-contracts.md`](docs/api-contracts.md) | `/v1` inference and `/api` admin routes |
| [`docs/opencode.md`](docs/opencode.md) | OpenCode setup details |
| [`docs/claude.md`](docs/claude.md) | Claude Code setup and `/usage` |
| [`docs/troubleshooting.md`](docs/troubleshooting.md) | Auth, quota, Docker, protocol drift |
| [`docs/schema.md`](docs/schema.md) | SQLite tables |
| [`docs/research.md`](docs/research.md) | Upstream Command Code behavior |
| [`docs/implementation-plan.md`](docs/implementation-plan.md) | Milestone history |
| [`docs/publish.md`](docs/publish.md) | npm and GHCR publish on `v*` tags |

---

## License

[MIT](LICENSE)
