# Release Checklist

This document is for maintainers preparing a BurnedWolf release.

## Before building

- Update the version in the source-of-truth version files.
- Update `CHANGELOG.md`.
- Confirm public distribution URLs in `src/main/distribution.js`.
- Ensure no secret/configuration file has been added to the Git index.
- Start from a clean Git working tree.

## Build

Use a disposable clean copy/worktree because the current obfuscation command writes back into its target directory.

```bash
npm ci
npm run dist
```

Expected Windows installer name:

```text
BurnedWolf-Setup.exe
```

## Test

Perform the smoke-test list in [BUILDING.md](BUILDING.md), especially DNS restoration, application quit cleanup, update checks, integrity repair and BurnedCord media/PTT.

## Application update channel

The application update channel is intentionally separate from the main source repository. Keep the manifest, changelog payload and application update package aligned to the release version.

Verify that the update package contains only the files the updater expects before publishing it.

## Large repair assets

Large runtime repair archives should be published as GitHub Release assets rather than committed directly to the small update-manifest repository.

## After publishing

- Install from the public installer once on a clean/representative Windows environment.
- Verify the application reports the new version.
- Verify the public website points to the correct installer/source.
- Verify an older supported build sees the new update.
