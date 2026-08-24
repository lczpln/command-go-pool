import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const alias = {
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

export default defineConfig({
  resolve: { alias },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "packages/**/*.test.ts"],
    exclude: ["tests/e2e/**"],
    fileParallelism: false,
    env: {
      COMMAND_GO_PROXY_LOG_LEVEL: "silent",
    },
  },
});
