# Publish to npm (`npx command-go-pool`)

`npx command-go-pool` works once the **root** package is on the public npm registry. Workspace packages under `apps/` and `packages/` stay `private`; tsup bundles them into `dist/cli.js`.

The published tarball is what npx installs. It must contain:

| Field / file | Why |
| --- | --- |
| `"name": "command-go-pool"` | `npx command-go-pool` resolves this name |
| `"bin": { "command-go-pool": "dist/cli.js" }` | npx runs this file when the bin name matches the package name |
| `dist/cli.js` with `#!/usr/bin/env node` | executable entry |
| `dist/dashboard/` | static UI served by the bundled server |

`prepack` runs `npm run build` so a local `npm publish` never ships an empty `dist/`.

## One-time npm setup

1. Create an [npmjs.com](https://www.npmjs.com) account and enable 2FA.
2. Create a **granular access token** (Automation): permission to publish `command-go-pool`, bypass 2FA on CI.
3. In the GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `NPM_TOKEN`
   - Value: the token
4. Optional: on the npm package page after the first publish, add a **Trusted Publisher** for GitHub Actions (`lczpln/command-go-pool`, workflow `publish.yml`) so later releases can use OIDC provenance without a long-lived token.

## First publish

The name `command-go-pool` is not taken on npm yet. Either path creates it.

### From a machine (after `npm login`)

```bash
npm run build
npm run pack:check
npm publish --access public
```

### From GitHub (recommended)

`package.json` is already `0.1.0`. After `NPM_TOKEN` is set:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The `publish` workflow tests, builds, checks the tarball, then runs `npm publish`. After it is green:

```bash
npx command-go-pool
```

## Later releases

1. Bump the root `"version"` and `POOL_VERSION` in `packages/shared/src/constants.ts` to the same value.
2. Commit on `master`.
3. Tag and push:

```bash
git tag v0.1.1
git push origin v0.1.1
```

Do not retag a version that already exists on npm; versions are immutable.

`npm version` in this repo is easy to get wrong because of workspaces. Prefer a manual bump + `git tag vX.Y.Z`.

## Local dry run (no publish)

```bash
npm run build
npm run pack:check
```

`pack:check` runs `npm pack --ignore-scripts` (so it does not rebuild), asserts the bin/shebang/dashboard files, then deletes the tarball.

To install the packed tarball the same way npx would:

```bash
npm run build
npm pack --ignore-scripts
npx --yes ./command-go-pool-0.1.0.tgz --help
```
