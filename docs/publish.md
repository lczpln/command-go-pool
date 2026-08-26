# Publish to npm and GHCR

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
2. Publish once (from a machine after `npm login`, or with a short-lived token) so the package exists.
3. On the npm package page → **Publishing access** → **Trusted Publisher**, add GitHub Actions:

   | Field | Value |
   | --- | --- |
   | Publisher | GitHub Actions |
   | Organization or user | `lczpln` |
   | Repository | `command-go-pool` |
   | Workflow filename | `publish.yml` |
   | Environment name | *(leave empty — the workflow does not use a GitHub environment)* |
   | Allowed actions | Allow `npm publish` only |

4. After the connection is saved, later releases on `v*` tags publish with OIDC. No `NPM_TOKEN` is required.

Do not fill **Environment name** unless `.github/workflows/publish.yml` also has a matching `environment:` field. A mismatch fails publish with `ENEEDAUTH` or a misleading `E404` on `PUT`.

The publish workflow must run on **Node 24** (npm ≥ 11.5.1). Do not set `registry-url` / `NODE_AUTH_TOKEN` on that job: `setup-node` would write an empty `_authToken` and npm would skip OIDC.

## First publish of a new name

If the package name is not on npm yet, create it once from a machine after `npm login` (Trusted Publisher cannot always create the first version):

```bash
npm run build
npm run pack:check
npm publish --access public
```

Then add the Trusted Publisher on the package page. Later versions go out from GitHub on `v*` tags.

## One-time GHCR setup

The `docker` job in `publish.yml` pushes `ghcr.io/lczpln/command-go-pool` with the `GITHUB_TOKEN`. No extra secret is required. The workflow permission `packages: write` is what allows the push.

After the first image lands:

1. Open the package at `https://github.com/users/lczpln/packages/container/package/command-go-pool`.
2. **Package settings → Change visibility → Public** so `docker pull` works without login.
3. Confirm the package is linked to this repository (OCI `org.opencontainers.image.source` from `docker/metadata-action`).

The first GHCR package for a repo is private by default. Leave it private only if you want authenticated pulls.

## Later releases

1. Bump the root `"version"` and `POOL_VERSION` in `packages/shared/src/constants.ts` to the same value.
2. Commit on `master`.
3. Tag and push:

```bash
git tag v0.1.1
git push origin v0.1.1
```

That tag runs both jobs: npm (`command-go-pool@0.1.1`) and Docker (`ghcr.io/lczpln/command-go-pool:0.1.1`, `:0.1`, and `:latest`; `linux/amd64` and `linux/arm64`).

Do not retag a version that already exists on npm; versions are immutable. GHCR tags can be overwritten, but treat `:0.1.1` as immutable anyway.

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
