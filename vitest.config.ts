import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const alias = {
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

export default defineConfig({
  resolve: { alias },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "packages/**/*.test.ts"],
    exclude: ["tests/e2e/**"],
    fileParallelism: false,
    env: {
      COMMAND_GO_POOL_LOG_LEVEL: "silent",
    },
  },
});
