# Security Policy

BurnedWolf is a privileged Windows network utility. Security reports are taken seriously, especially issues involving command execution, update integrity, privilege boundaries, credential handling, IPC, or network-state restoration.

## Supported versions

| Version | Status |
| --- | --- |
| Latest 4.x release | Supported |
| Older 4.x releases | Update to the latest release first |
| 3.x and earlier | Legacy / unsupported |

## Reporting a vulnerability

Please **do not publish a working exploit, private credential, or sensitive vulnerability details in a public issue**.

Preferred reporting path:

1. Use GitHub's private security-advisory/reporting feature for this repository when available.
2. If private reporting is unavailable, contact the maintainer through the GitHub profile **@iamnoobhasproject** and ask for a private channel before sharing sensitive details.

Include the affected version, affected component, reproduction conditions, security impact, and the minimum proof needed to understand the issue.

## Sensitive information

Never include any of the following in public reports:

- API keys or provider credentials
- authentication/session tokens
- cookies
- private server secrets
- personally identifying logs
- private IP/service credentials

Redact them before attaching screenshots or logs.

## Privileged behaviour

BurnedWolf intentionally requests administrator privileges because some features modify Windows network state and launch low-level networking components. A behaviour requiring elevation is not automatically a vulnerability; unexpected command execution, unsafe argument handling, privilege-boundary bypasses, or failure to restore system state may be.

## Updates and repair bundles

Update and integrity-repair infrastructure is security-sensitive. Reports involving manifest tampering, update replacement, path traversal, arbitrary file write, or repair-bundle validation should be treated as high priority.
