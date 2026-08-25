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
  noExternal: [/@command-go-pool\//],
  external: ["better-sqlite3", "keytar"],
  esbuildOptions(options) {
    options.alias = {
      "@command-go-pool/shared": resolve(root, "packages/shared/src/index.ts"),
      "@command-go-pool/storage": resolve(root, "packages/storage/src/index.ts"),
      "@command-go-pool/observability": resolve(root, "packages/observability/src/index.ts"),
      "@command-go-pool/transport-commandcode": resolve(root, "packages/transport-commandcode/src/index.ts"),
      "@command-go-pool/protocol-openai": resolve(root, "packages/protocol-openai/src/index.ts"),
      "@command-go-pool/protocol-anthropic": resolve(root, "packages/protocol-anthropic/src/index.ts"),
      "@command-go-pool/account-pool": resolve(root, "packages/account-pool/src/index.ts"),
      "@command-go-pool/session-router": resolve(root, "packages/session-router/src/index.ts"),
      "@command-go-pool/quota-engine": resolve(root, "packages/quota-engine/src/index.ts"),
      "@command-go-pool/server": resolve(root, "packages/server/src/index.ts"),
    };
  },
});
