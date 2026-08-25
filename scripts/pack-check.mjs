import { execSync } from "node:child_process";
import { readFileSync, unlinkSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const tarball = `${pkg.name}-${pkg.version}.tgz`;

function fail(message) {
  console.error(message);
  process.exit(1);
}

try {
  execSync("npm pack --ignore-scripts", { stdio: "inherit" });
  const listing = execSync(`tar -tzf ${tarball}`, { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const required = [
    "package/dist/cli.js",
    "package/dist/dashboard/index.html",
    "package/package.json",
    "package/README.md",
    "package/LICENSE",
  ];
  for (const file of required) {
    if (!listing.includes(file)) fail(`npm pack is missing ${file}`);
  }

  const cliHead = execSync(`tar -xOf ${tarball} package/dist/cli.js | head -c 40`, {
    encoding: "utf8",
  });
  if (!cliHead.startsWith("#!/usr/bin/env node")) {
    fail("dist/cli.js is missing the node shebang required for npx");
  }

  const packed = JSON.parse(execSync(`tar -xOf ${tarball} package/package.json`, { encoding: "utf8" }));
  if (packed.bin?.["command-go-pool"] !== "dist/cli.js") {
    fail("package.json bin.command-go-pool must point at dist/cli.js");
  }
  if (packed.name !== "command-go-pool") {
    fail(`published name must be command-go-pool, got ${packed.name}`);
  }

  const tag = process.env.GITHUB_REF_NAME ?? "";
  if (/^v\d+\.\d+\.\d+/.test(tag) && tag !== `v${pkg.version}`) {
    fail(`git tag ${tag} does not match package.json version ${pkg.version}`);
  }

  console.log(`pack ok: ${tarball} (${listing.length} files) → npx ${packed.name}`);
} finally {
  try {
    unlinkSync(tarball);
  } catch {
    // ignore missing tarball when npm pack fails first
  }
}
