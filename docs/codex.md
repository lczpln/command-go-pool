# Codex Desktop

```bash
command-go-pool client connect codex
# alias
command-go-pool setup codex
```

Writes the user-level `~/.codex/config.toml` (or `$CODEX_HOME/config.toml`). Codex Desktop ignores provider keys in a project `.codex/config.toml`, so this command only edits the user file.

The writer:

1. Detects `codex` on `PATH`, or `~/.codex`
2. Backs up the existing file to `.bak.<timestamp>`
3. Fetches enabled models from `GET /v1/models` (falls back to DeepSeek Go ids if the pool is down)
4. Sets `model_provider = "command-go-pool"` and a matching `model`
5. Adds `[model_providers.command-go-pool]` with `wire_api = "responses"` pointing at `http://127.0.0.1:8787/v1`
6. Leaves other tables (`projects`, MCP, profiles) in place

Restart Codex Desktop after connect. Select **Command Go Pool** / the written model.

Disconnect:

```bash
command-go-pool client disconnect codex
```

That removes only the pool provider table and, if it was selected, resets `model_provider` to `openai`. It does not delete `~/.codex/config.toml`.

After toggling models on the dashboard, **Sync with clients** (or setup again) rewrites the `model` id if the current one is no longer enabled.

## Manual config

Edit `~/.codex/config.toml`:

```toml
model = "deepseek/deepseek-v4-flash"
model_provider = "command-go-pool"

[model_providers.command-go-pool]
name = "Command Go Pool"
base_url = "http://127.0.0.1:8787/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false
stream_idle_timeout_ms = 600000
experimental_bearer_token = "pool-managed"
```

Notes:

- `wire_api = "responses"` is required. Current Codex only speaks the OpenAI Responses API (`POST /v1/responses`). Chat Completions is not enough.
- Do not name the provider `openai`, `ollama`, or `lmstudio` — those ids are reserved.
- Do not set `openai_base_url` unless you want to hijack the built-in OpenAI provider. A custom `command-go-pool` provider is safer.
- `requires_openai_auth = false` keeps Codex from using ChatGPT login for this provider.
- `supports_websockets = false` — the pool is HTTP SSE only.
- `stream_idle_timeout_ms = 600000` matches the pool generate timeout. Reasoning models can sit quiet before the first token.
- A pool API key is optional. `pool-managed` is a placeholder. If you generate a `cgp_…` key, setup / rotate writes it into `experimental_bearer_token`. You can also export `COMMAND_GO_POOL_API_KEY` and set `env_key = "COMMAND_GO_POOL_API_KEY"` instead of an inline token.

Prefer a real Go model id from `GET /v1/models`:

| Typical id | Role |
| --- | --- |
| `deepseek/deepseek-v4-flash` | Fast |
| `deepseek/deepseek-v4-pro` | Default quality |
| `flash` / `pro` | Aliases, only when the target is enabled |

Default Codex models (`gpt-5`, `codex-…`) are not in the pool catalog. The pool returns `400` rather than substituting.

## Auth

Same rules as other `/v1` clients. If no pool key is set, Codex can send any bearer (including `pool-managed`). If you generated a key, Codex must send it.

## Sticky sessions

Codex sends `thread-id` / `session-id` / `conversation_id`. The pool binds those to one Go account so prompt cache stays warm. You can also set:

```toml
http_headers = { "X-Command-Go-Session" = "my-codex-session" }
```
