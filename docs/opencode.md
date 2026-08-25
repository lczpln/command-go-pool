# OpenCode

```bash
command-go-pool setup opencode
```

This command:

1. Detects `~/.config/opencode/opencode.json` (or `$OPENCODE_CONFIG`)
2. Writes a timestamped `.bak.*` copy if the file exists
3. Fetches enabled models from `GET /v1/models` (falls back to the three DeepSeek Go models if the pool is down)
4. Adds provider `command-go-pool` pointing at `http://127.0.0.1:8787/v1`
5. Leaves other providers in place
6. Prints the path and the keys it changed

The dashboard **Models** page can rewrite the same file with **Sync OpenCode** after you enable or disable models. OpenCode itself does not poll `/v1/models`; re-run setup (or Sync) whenever the catalog changes.

If you prefer to edit by hand, see the README example.

Select **Command Go Pool** in the OpenCode model picker. Prefer `X-Command-Go-Session` if your client can set extra headers; otherwise the pool fingerprints `model + system + first user message`.
