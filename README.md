<div align="center">
  <img src="icon.png" alt="BurnedWolf" width="104" height="104">

# BurnedWolf

**A Windows network utility for DPI filtering, encrypted DNS, diagnostics, integrity repair, and BurnedCord.**

Built and maintained under **[whyscripts.com](https://whyscripts.com/)**.

[![Version](https://img.shields.io/github/package-json/v/iamnoobhasproject/burnedwolf?filename=package.json&style=flat-square)](package.json)
[![Platform](https://img.shields.io/badge/platform-Windows-111111?style=flat-square&logo=windows11&logoColor=white)](#requirements)
[![Electron](https://img.shields.io/badge/Electron-26-111111?style=flat-square&logo=electron&logoColor=white)](package.json)
[![Source](https://img.shields.io/badge/source-public-111111?style=flat-square&logo=github&logoColor=white)](https://github.com/iamnoobhasproject/burnedwolf)

[Website](https://burnedwolf.whyscripts.com/) · [Report a bug](https://github.com/iamnoobhasproject/burnedwolf/issues) · [WhyScripts](https://whyscripts.com/)
</div>

---

## What is BurnedWolf?

BurnedWolf is a Windows desktop utility that brings several network tools into one interface. It can manage DPI-bypass profiles, encrypted DNS, network analysis, file-integrity repair, Tor helpers, and the integrated BurnedCord desktop voice client.

The project is designed around a simple idea: common network fixes should be easy to turn on, inspect, undo, and repair without manually juggling scripts and command-line tools.

> **Important:** BurnedWolf changes system/network state and therefore runs with administrator privileges. Only install builds from the official project links and review the source if you want to understand exactly what a feature changes.

## Highlights

| Feature | What it does |
| --- | --- |
| **DPI protection** | Runs the bundled DPI engine with selectable profiles and automatic profile handling. |
| **ISP-aware profiles** | Detects the active ISP and can recommend an appropriate protection profile. |
| **Encrypted DNS** | Runs a local encrypted DNS resolver and can use providers such as Cloudflare or Quad9. |
| **Crash-safe DNS restore** | Saves the original DNS configuration and repairs stale loopback DNS state after an abnormal shutdown. |
| **Network analysis** | Tests profiles against real services and ranks the results before applying the best option. |
| **Custom profiles** | Create, clone, import, export, and manage custom DPI profiles. |
| **Integrity repair** | Compares bundled runtime files with the official repair bundle and restores missing/corrupt files. |
| **Tor tools** | Manages the bundled Tor process and supports bridge/pluggable-transport configuration. |
| **BurnedCord** | Separate desktop voice window with camera/screen sharing integration and global Windows push-to-talk support. |
| **Updater** | Checks the dedicated WhyScripts update channel and applies application updates without replacing the full installation. |

## BurnedCord

BurnedCord is integrated into BurnedWolf but opens in its own desktop window and tray entry. The desktop shell uses the canonical `https://chat.whyscripts.com/app/` client and adds Electron-specific capabilities such as native screen-source selection, system-audio capture support, native clipboard access, and Windows-global push-to-talk.

The hosted BurnedCord service is a separate component; this repository contains the BurnedWolf desktop integration layer.

## Requirements

- **Windows 10 or Windows 11 (64-bit recommended)**
- Administrator privileges
- Internet connection for update checks and online-backed features
- A network adapter supported by the Windows networking commands used by the application

BurnedWolf is currently Windows-focused. Its networking layer relies on Windows APIs, PowerShell, `netsh`, WinDivert-based tooling, and Windows-specific runtime binaries.

## Installation

### Recommended

Download the current Windows installer from the official BurnedWolf page:

**https://burnedwolf.whyscripts.com/**

The installer is built as `BurnedWolf-Setup.exe` and requests administrator privileges because the application may change DNS configuration and run network filtering components.

### Run from source

```bash
git clone https://github.com/iamnoobhasproject/burnedwolf.git
cd burnedwolf
npm ci
npm start
```

For full packaged functionality, the runtime binary directories expected by the project must be present. See [Building from source](docs/BUILDING.md) before producing a distributable build.

## Project structure

```text
burnedwolf/
├─ main.js                 # Small Electron entry shim
├─ src/main/               # Main-process modules
│  ├─ zapret/              # DPI engine, profiles, hostlists, payloads, blockcheck
│  ├─ ai/                  # Optional AI integration helpers
│  ├─ dns.js               # DNS + dnscrypt-proxy lifecycle and recovery
│  ├─ tor.js               # Tor lifecycle
│  ├─ burnedcord.js        # BurnedCord desktop shell / native bridge
│  ├─ updater.js           # Update pipeline
│  ├─ verify.js            # Integrity verification / repair
│  └─ windows.js           # Windows, tray, IPC
├─ renderer/               # Main BurnedWolf interface
├─ i18n/                   # Localized UI strings
├─ brand/                  # WhyScripts/BurnedWolf brand assets
└─ package.json            # Electron + electron-builder configuration
```

For a deeper overview, see [Architecture](docs/ARCHITECTURE.md).

## Safety and recovery

Network utilities can leave the system in a bad state if they are terminated at the wrong moment. BurnedWolf includes explicit cleanup and recovery paths:

- the original DNS configuration is captured before encrypted DNS takes control;
- DNS is restored on a normal quit;
- stale `127.0.0.1` / `::1` resolver state can be detected and repaired on the next launch;
- Tor, DPI, DNS and local proxy processes are included in the application shutdown cleanup order;
- the integrity tool can re-download the official repair bundle for missing or corrupt runtime files.

If something goes wrong, read [Troubleshooting](docs/TROUBLESHOOTING.md) before manually changing system settings.

## Updates

Public distribution endpoints are centralized in `src/main/distribution.js`. The current application checks the WhyScripts update channel for a newer semantic version and downloads the corresponding application update package.

Runtime integrity repair is intentionally separate from application updates. Large repair assets can be hosted as GitHub Release assets while the update manifest remains lightweight.

## Development

Useful commands:

```bash
npm ci
npm start
```

To build a Windows installer:

```bash
npm run dist
```

**Do not run the distribution command on uncommitted source without reading the build guide first.** The current `dist` script runs the JavaScript obfuscator before `electron-builder`, and the obfuscation step targets the working tree.

See:

- [Building from source](docs/BUILDING.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Release notes](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## Contributing

Bug reports and focused pull requests are welcome. For larger changes, open an issue first so the approach can be discussed before a large patch is written.

Please keep changes scoped, avoid committing secrets or generated runtime bundles, and preserve cleanup/recovery behaviour when touching DNS, DPI, Tor, updater, or Electron lifecycle code.

## Third-party components

BurnedWolf integrates or interoperates with third-party open-source components, including Electron, Zapret/WinDivert-based networking components, dnscrypt-proxy, and Tor. Those projects retain their own licenses, trademarks, and notices.

## License

This repository does **not currently declare a project license**. Publicly visible source code is not automatically the same thing as granting an open-source license. Until a license is added, no additional permissions should be assumed beyond those required by applicable law.

Third-party components remain subject to their respective licenses.

## Links

- BurnedWolf: **https://burnedwolf.whyscripts.com/**
- WhyScripts: **https://whyscripts.com/**
- BurnedCord service: **https://chat.whyscripts.com/**
- Source: **https://github.com/iamnoobhasproject/burnedwolf**

<div align="center">
  <sub>BurnedWolf · a WhyScripts project</sub>
</div>
