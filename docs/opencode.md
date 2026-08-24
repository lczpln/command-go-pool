# OpenCode

```bash
command-go-proxy setup opencode
```

This command:

1. Detects `~/.config/opencode/opencode.json` (or `$OPENCODE_CONFIG`)
2. Writes a timestamped `.bak.*` copy if the file exists
3. Adds provider `command-go-pool` pointing at `http://127.0.0.1:8787/v1`
4. Leaves other providers in place
5. Prints the path and the keys it changed

If you prefer to edit by hand, see the README example.

Select **Command Go Pool** in the OpenCode model picker. Prefer `X-Command-Go-Session` if your client can set extra headers; otherwise the proxy fingerprints `model + system + first user message`.
