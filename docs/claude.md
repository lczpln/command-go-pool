# Claude Code

```bash
command-go-pool client connect claude
# alias
command-go-pool setup claude
```

Writes `~/.claude/command-go-pool.json`. It only sets `ANTHROPIC_*` for the pool and does **not** modify `~/.claude/settings.json` (that file is user-global and would hijack every Claude session).

```bash
claude --settings ~/.claude/command-go-pool.json
```

Disconnect:

```bash
command-go-pool client disconnect claude
```

Claude Code maps three tiers onto pool models:

| Tier | Env var | Default |
| --- | --- | --- |
| Sonnet | `ANTHROPIC_DEFAULT_SONNET_MODEL` | `deepseek/deepseek-v4-pro` |
| Opus | `ANTHROPIC_DEFAULT_OPUS_MODEL` | `deepseek/deepseek-v4-pro` |
| Haiku | `ANTHROPIC_DEFAULT_HAIKU_MODEL` | `deepseek/deepseek-v4-flash` |

`ANTHROPIC_BASE_URL` is the origin (`http://127.0.0.1:8787`), not `/v1`. Claude Code appends `/v1/messages` itself.

A pool API key is optional. The file uses `pool-managed` until you generate a key; rotate then updates this file automatically.

## `/usage`

Claude Code `/usage` (and the in-memory rate-limit HUD) reads `anthropic-ratelimit-unified-*` headers on `POST /v1/messages`:

| Header | Meaning |
| --- | --- |
| `anthropic-ratelimit-unified-5h-utilization` | 5-hour window used, `0.0`–`1.0` |
| `anthropic-ratelimit-unified-7d-utilization` | Weekly window used, `0.0`–`1.0` |
| `*-reset` | Unix timestamp |
| `*-status` | `allowed`, `allowed_warning`, or `rejected` |

The pool fills those from aggregated account windows. If Command Code did not report a window, the header is omitted rather than faked.

A lightweight probe (`max_tokens: 1`, user text exactly `quota`) is answered locally so `/usage` does not spend Go quota.

JSON for scripts and statuslines (same auth as other `/api` and `/v1` routes):

```bash
curl -s http://127.0.0.1:8787/api/oauth/usage
curl -s http://127.0.0.1:8787/v1/usage \
  -H "Authorization: Bearer $COMMAND_GO_POOL_API_KEY"
```

`/api/oauth/usage` uses Claude Code's OAuth shape (`five_hour.utilization` is 0–100). `/v1/usage` uses the OpenCode Go shape. Both omit invented precision.
