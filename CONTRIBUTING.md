# Contributing to BurnedWolf

Thanks for taking the time to improve BurnedWolf.

## Before opening a pull request

For a small bug fix, a focused pull request is fine. For a large feature, architecture change, new bundled binary, or behaviour that modifies networking/security-sensitive code, open an issue first.

## Local setup

Requirements:

- Windows 10/11
- Node.js + npm
- Git
- Administrator privileges for testing features that change network configuration

```bash
git clone https://github.com/iamnoobhasproject/burnedwolf.git
cd burnedwolf
npm ci
npm start
```

## Development rules

1. Keep changes focused. Avoid unrelated formatting or refactors in the same pull request.
2. Do not commit credentials, API keys, tokens, cookies, private endpoints, or local configuration containing secrets.
3. Preserve the cleanup path when changing DNS, Tor, DPI, proxy, or application quit behaviour.
4. Preserve the current IPC contract unless the renderer and main process are updated together.
5. Treat update URLs and integrity/repair URLs as distribution infrastructure; keep them centralized rather than hard-coding new copies around the codebase.
6. Do not commit `node_modules`, build output, temporary archives, or locally generated logs.
7. If you add a third-party binary or library, document its upstream project and license.

## JavaScript checks

At minimum, syntax-check changed JavaScript files before submitting. Example:

```bash
node --check path/to/changed-file.js
```

The repository CI also performs a basic JavaScript syntax scan.

## Building

Read [docs/BUILDING.md](docs/BUILDING.md) first.

The current distribution command is:

```bash
npm run dist
```

The `dist` script runs an obfuscation step before `electron-builder`. Because the configured obfuscator writes to the working tree, build from a clean/disposable working copy and verify `git status` before and after building.

## Pull request checklist

- [ ] The app starts successfully with `npm start`.
- [ ] Changed JS files pass syntax checks.
- [ ] Network cleanup/recovery behaviour is still intact.
- [ ] No secret or local-only file is included.
- [ ] User-facing changes are reflected in the changelog when appropriate.
- [ ] New dependencies or bundled binaries are documented.

## Bug reports

Use the GitHub bug-report template and include:

- BurnedWolf version
- Windows version
- feature involved
- exact reproduction steps
- expected vs actual behaviour
- relevant logs with secrets removed

Never post passwords, API keys, tokens, private cookies, or other credentials in an issue.
