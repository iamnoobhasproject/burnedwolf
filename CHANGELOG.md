# Changelog

Notable BurnedWolf changes are recorded here.

The project currently uses `MAJOR.MINOR.PATCH` version numbers. Dates below document the public 4.x development line.

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

The previous 3.x BurnedWolf line is considered legacy. The current WhyScripts-branded application is the maintained 4.x line.
