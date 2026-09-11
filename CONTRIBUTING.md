# Contributing to BurnedWolf

Thanks for taking the time to improve BurnedWolf.

## Before opening a pull request

For a small bug fix, a focused pull request is fine. For a large feature, architecture change, new bundled binary, updater/Core-migration change, or behaviour that modifies networking/security-sensitive code, open an issue first.

## Local setup

Requirements:

- Windows 10/11
- Node.js + npm
- Git
- Administrator privileges for testing features that change network configuration

```bash
git clone https://github.com/iamnoobhasproject/burnedwolf.git
cd burnedwolf
npm install
npm start
```

For the Electron 44 source line, the production dependency audit should be clean:

```bash
npm audit --omit=dev
```

Do **not** use `npm audit fix --force` as part of a contribution/release workflow. Dependency upgrades should be deliberate and tested.

## Development rules

1. Keep changes focused. Avoid unrelated formatting or refactors in the same pull request.
2. Do not commit credentials, API keys, tokens, cookies, private endpoints, release secrets, or local configuration containing secrets.
3. Preserve the cleanup path when changing DNS, Tor, DPI, proxy, or application quit behaviour.
4. Preserve the current IPC contract unless the renderer and main process are updated together.
5. Treat update URLs, Core manifests, and integrity/repair URLs as distribution infrastructure; keep them centralized rather than hard-coding new copies around the codebase.
6. Do not commit `node_modules`, build output, temporary archives, locally generated logs, or release installers unless a repository policy explicitly requires them.
7. If you add a third-party binary or library, document its upstream project and license.
8. Changes to `updater.js`, `coreUpdate.js`, `distribution.js`, Electron versions, or NSIS packaging require migration/release testing.

## JavaScript checks

At minimum, syntax-check changed JavaScript files before submitting. Example:

```bash
node --check path/to/changed-file.js
```

The repository CI also performs basic JavaScript syntax checks.

## Electron 44 source preflight

Before a Core/runtime build, run:

```bat
TEST_CORE44_SOURCE.bat
```

This checks the pinned runtime/update dependencies, production audit, source compatibility, update endpoints, and Electron/Chromium network path before starting the app for manual testing.

Warnings from transitive build tooling are not automatically a failure. A non-zero production audit or a failed preflight is a failure.

## Building

Read [docs/BUILDING.md](docs/BUILDING.md) first.

Build the Windows NSIS Core installer:

```bash
npm run dist:core
```

Build a lightweight v2 application update:

```bash
npm run pack:app-v2
```

If you use the obfuscated distribution command, build from a clean/disposable working copy and verify `git status` before and after building because the configured obfuscator targets the working tree.

## Update architecture rules

BurnedWolf deliberately has two update channels:

- lightweight application updates (`version-v2.json` + `app-v2.zip`), and
- full Core/Electron updates (`core-version.json` + NSIS/electron-updater release assets).

The old `version.json` + `update.zip` channel is the frozen Electron-26 migration bridge and must not be repointed to an Electron-44-only `app.asar`.

When changing the update system, preserve the minimum-runtime/bridge compatibility checks. A user on an old Electron runtime must never be offered an incompatible application package.

## Pull request checklist

- [ ] The app starts successfully with `npm start`.
- [ ] Changed JS files pass syntax checks.
- [ ] `npm audit --omit=dev` reports no production vulnerability.
- [ ] Network cleanup/recovery behaviour is still intact.
- [ ] No secret or local-only file is included.
- [ ] User-facing changes are reflected in the changelog when appropriate.
- [ ] New dependencies or bundled binaries are documented.
- [ ] Updater/Core changes were tested on an existing installation, not only a clean development tree.

## Bug reports

Use the GitHub bug-report template and include:

- BurnedWolf version
- Electron/Core version
- Windows version
- feature involved
- exact reproduction steps
- expected vs actual behaviour
- relevant logs with secrets removed

Never post passwords, API keys, tokens, private cookies, or other credentials in an issue.
