# Changelog

Notable BurnedWolf changes are recorded here.

The project uses `MAJOR.MINOR.PATCH` version numbers. Dates below document the maintained 4.x development line.

## [4.7.0] - 2026-09-11

### Added
- Full Core/Electron update channel, separate from lightweight application updates.
- `electron-updater` integration for modern NSIS Core releases.
- Core update manifest support with minimum bridge version and SHA-256 metadata.
- Electron 44 source/release preflight tooling and migration checks.
- Dedicated v2 application update channel (`version-v2.json` + `app-v2.zip`).

### Changed
- Updated the desktop runtime to Electron 44.3.0.
- Full runtime updates and lightweight `app.asar` updates now have independent release paths.
- Renderer clipboard access is routed through the main-process IPC bridge for Electron 44 compatibility.
- Core update networking uses the modern Electron/Chromium-compatible request path.

### Security
- Legacy-to-Core migration verifies the downloaded NSIS installer against the SHA-256 value in the Core manifest before launching it.
- The original legacy app-update channel remains frozen to prevent incompatible `app.asar` packages from reaching untouched Electron-26 installations.

## [4.6.6] - 2026-09-11

### Added
- Final Electron-26 migration bridge for the Electron 44 Core transition.
- Separate Core update status/check/download/install flow in the updater UI.
- Bridge-side compatibility checks so a user cannot receive an application package that requires a newer runtime.

### Changed
- Legacy `version.json` + `update.zip` is treated as a frozen bridge channel.
- New application patches use the v2 channel after the bridge has been installed.

## [4.6.0] - 2026-09-09

### Added
- Windows-global BurnedCord push-to-talk support, including common keyboard keys and Mouse 4 / Mouse 5.
- Desktop bridge support for stronger voice-processing controls in the hosted BurnedCord client.

### Changed
- Improved BurnedCord desktop/media integration while keeping the hosted HTTPS renderer introduced in 4.5.x.

## [4.5.0] - 2026-09-09

### Changed
- BurnedCord now runs its renderer from the canonical `https://chat.whyscripts.com/app/` origin inside the Electron desktop shell.
- Simplified the remote audio playback path.
- Kept native Electron integration for screen-source selection, clipboard, tray behaviour, and desktop capture.

## [4.4.0] - 2026-09-09

### Added
- Screen-share system-audio bridge support on Windows.
- Separate screen-audio control support in the BurnedCord desktop integration.

### Fixed
- Electron media-permission handling for BurnedCord.
- Remote audio autoplay configuration.
- WebRTC signaling reliability improvements for the desktop workflow.

## [4.3.0] - 2026-09-09

### Fixed
- BurnedCord desktop clipboard operations moved to the native Electron clipboard bridge.
- Signaling reconnect/retry behaviour improved.

### Changed
- Added WebRTC relay fallback support to the companion BurnedCord service configuration path.

## [4.2.0] - 2026-09-09

### Changed
- Removed the sponsored/free-registration-key experiment from BurnedCord.
- Returned registration to the normal invite-only flow.

## [4.1.x] - 2026-09-09

### Fixed
- Screen-share picker layout and modal sizing fixes.
- Integrity repair bundle URL fixes.

### Notes
- A sponsored invite/reward experiment was tested during this line and later removed in 4.2.0.

## [4.0.0] - 2026-09-09

### Changed
- Major WhyScripts visual refresh.
- Centralized public distribution/update endpoints.
- Split the main Electron process into focused modules.

### Added
- Integrated BurnedCord desktop entry point.
- WhyScripts branding and dedicated product/update channels.

## Legacy

The previous 3.x BurnedWolf line is considered legacy. The maintained WhyScripts-branded application is the 4.x line.
