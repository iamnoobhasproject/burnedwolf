# Security Policy

BurnedWolf is a privileged Windows network utility. Security reports are taken seriously, especially issues involving command execution, update integrity, privilege boundaries, credential handling, IPC, network-state restoration, or Core/runtime migration.

## Supported versions

| Version | Status |
| --- | --- |
| Latest 4.x release | Supported |
| Older 4.x releases | Update to the latest release first |
| 3.x and earlier | Legacy / unsupported |

## Reporting a vulnerability

Please **do not publish a working exploit, private credential, secret update manifest value, or sensitive vulnerability details in a public issue**.

Preferred reporting path:

1. Use GitHub's private security-advisory/reporting feature for this repository when available.
2. If private reporting is unavailable, contact the maintainer through the GitHub profile **@iamnoobhasproject** and ask for a private channel before sharing sensitive details.

Include the affected BurnedWolf version, Electron/Core version, affected component, reproduction conditions, security impact, and the minimum proof needed to understand the issue.

## Sensitive information

Never include any of the following in public reports:

- API keys or provider credentials
- authentication/session tokens
- cookies
- private server secrets
- personally identifying logs
- private IP/service credentials
- unpublished update manifests or release secrets

Redact them before attaching screenshots or logs.

## Privileged behaviour

BurnedWolf intentionally requests administrator privileges because some features modify Windows network state and launch low-level networking components. A behaviour requiring elevation is not automatically a vulnerability; unexpected command execution, unsafe argument handling, privilege-boundary bypasses, or failure to restore system state may be.

## Updates and repair bundles

BurnedWolf has separate application and Core/runtime update paths. Both are security-sensitive.

High-priority reports include issues involving:

- manifest tampering or downgrade/bypass behaviour;
- incompatible `app.asar` delivery to an older Electron runtime;
- Core installer replacement or SHA-256 verification bypass;
- unsafe `electron-updater`/NSIS release handling;
- path traversal or arbitrary file writes during application updates or integrity repair;
- repair-bundle validation failures;
- IPC handlers that allow untrusted renderer content to perform privileged actions.

The legacy-to-Core migration verifies the downloaded Core installer against the SHA-256 value supplied by the Core manifest before launching it. A bypass of that verification should be treated as high severity.
