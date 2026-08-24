import { defineConfig } from "tsup";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  entry: { cli: "packages/cli/src/index.ts" },
  format: ["esm"],
  platform: "node",
  target: "node20",
  sourcemap: true,
  clean: false,
  splitting: false,
  dts: false,
  banner: { js: "#!/usr/bin/env node" },
  noExternal: [/@command-go-proxy\//],
  external: ["better-sqlite3", "keytar"],
  esbuildOptions(options) {
    options.alias = {
      "@command-go-proxy/shared": resolve(root, "packages/shared/src/index.ts"),
      "@command-go-proxy/storage": resolve(root, "packages/storage/src/index.ts"),
      "@command-go-proxy/observability": resolve(root, "packages/observability/src/index.ts"),
      "@command-go-proxy/transport-commandcode": resolve(root, "packages/transport-commandcode/src/index.ts"),
      "@command-go-proxy/protocol-openai": resolve(root, "packages/protocol-openai/src/index.ts"),
      "@command-go-proxy/protocol-anthropic": resolve(root, "packages/protocol-anthropic/src/index.ts"),
      "@command-go-proxy/account-pool": resolve(root, "packages/account-pool/src/index.ts"),
      "@command-go-proxy/session-router": resolve(root, "packages/session-router/src/index.ts"),
      "@command-go-proxy/quota-engine": resolve(root, "packages/quota-engine/src/index.ts"),
      "@command-go-proxy/server": resolve(root, "packages/server/src/index.ts"),
    };
  },
});
