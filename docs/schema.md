# SQLite schema

Default directory: `~/.command-go-pool/` (`COMMAND_GO_POOL_HOME` override). Files: `state.db`, `config.yaml`, `secrets.bin`, `master.key`, `logs/`. Connected CLIs are listed under `clients.connected` in `config.yaml`, not in SQLite.

`config.yaml` may include `server.apiKey` (optional, mode `0600`). It is not generated on first start.

Mode `0700` on the directory, `0600` on db/config/secrets.

## Tables

### schema_migrations

`id integer primary key`, `name text unique`, `applied_at integer`

### accounts

| Column | Type |
| --- | --- |
| id | text pk |
| label | text not null |
| enabled | integer not null default 1 |
| credential_ref | text not null |
| status | text not null |
| last_success_at | integer |
| last_failure_at | integer |
| cooldown_until | integer |
| cooldown_reason | text |
| health_score | real not null default 1 |
| monthly_subscription_cost | real |
| created_at | integer not null |
| updated_at | integer not null |

### quota_snapshots

| Column | Type |
| --- | --- |
| id | integer pk |
| account_id | text not null |
| window | text not null — `fiveHour` \| `weekly` \| `monthly` |
| used | real |
| remaining | real |
| total | real |
| used_percent | real |
| remaining_percent | real |
| reset_at | integer |
| source | text not null |
| confidence | text not null |
| captured_at | integer not null |

### sessions

| Column | Type |
| --- | --- |
| id | text pk |
| account_id | text not null |
| model | text not null |
| label | text |
| created_at | integer not null |
| last_request_at | integer not null |
| requests | integer not null default 0 |
| input_tokens | integer not null default 0 |
| cache_read_tokens | integer not null default 0 |
| cache_write_tokens | integer not null default 0 |
| output_tokens | integer not null default 0 |
| reasoning_tokens | integer not null default 0 |
| estimated_cost | real |
| cost_estimated | integer not null default 1 |
| migrations | integer not null default 0 |
| sticky | integer not null default 1 |

### session_account_bindings

History of binds/migrations: `id`, `session_id`, `account_id`, `reason`, `at`.

### usage_events

Per-request metrics only (no prompt text): account, model, session, tokens, latency_ms, ttft_ms, error, estimated_cost, at.

### pool_events

Dashboard stream: `id`, `level`, `category`, `type`, `payload_json`, `at`.

### settings

`key text pk`, `value_json text not null`.
