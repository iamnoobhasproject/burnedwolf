# Building BurnedWolf

BurnedWolf is an Electron application targeted at Windows.

## Prerequisites

- Windows 10/11
- Node.js and npm
- Git
- Administrator privileges for testing network-changing features

## Install dependencies

```bash
npm ci
```

## Development run

```bash
npm start
```

Some features require administrator rights or bundled runtime binaries and therefore may not behave exactly like the packaged installer when run from a normal terminal.

## Runtime binary directories

The electron-builder configuration expects these directories to remain unpacked from `app.asar`:

```text
tor-bin/
zapret-bin/
dnsproxy-bin/
```

A development checkout or release-building workspace needs the appropriate runtime assets for the features you intend to test/package.

Do not replace third-party binaries with untrusted downloads. Preserve their upstream license/notice information.

## Build the installer

The package script is:

```bash
npm run dist
```

This produces the NSIS Windows installer configured as:

```text
BurnedWolf-Setup.exe
```

### Important: build from a clean copy

The current `dist` command runs:

```text
npm run obfuscate && electron-builder
```

and the configured `javascript-obfuscator` output target is the project directory itself. In other words, the obfuscation step can modify JavaScript files in your working tree.

Recommended release workflow:

1. Commit/stash all source changes.
2. Make a disposable copy/worktree for the release build.
3. Run `npm ci` in that clean build copy.
4. Run `npm run dist` there.
5. Do not commit the obfuscated build-copy source back over the readable source tree.
6. Verify the generated installer before publishing.

## Smoke-test checklist

Before publishing a build, verify at minimum:

- main window launches;
- tray open/hide/quit works;
- protection can start and stop;
- DNS can enable, disable, and restore cleanly;
- a forced-close/relaunch does not leave dead loopback DNS;
- network analysis can start/cancel;
- integrity check can reach the official repair bundle;
- updater reads the expected channel;
- BurnedCord opens in its own window;
- BurnedCord microphone/camera/screen permissions behave as expected;
- global push-to-talk is released correctly after key-up;
- full quit stops child processes and restores network state.
