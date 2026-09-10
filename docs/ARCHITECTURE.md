# Architecture

BurnedWolf is an Electron desktop application split into a main process, a renderer, bundled networking runtimes, and an integrated BurnedCord desktop shell.

## Entry point

`main.js` is intentionally small and forwards startup to `src/main/index.js`.

`src/main/index.js` acts as the composition root. Domain modules register IPC handlers, startup tasks, background checks, and shutdown cleanup.

## Main-process modules

| Module | Responsibility |
| --- | --- |
| `constants.js` | Application name/version/root constants |
| `distribution.js` | Official website, source, update, changelog, repair endpoints and version comparison |
| `settings.js` | Persistent application settings |
| `windows.js` | Main windows, tray and window IPC |
| `quit.js` | Ordered full-shutdown cleanup registry |
| `dns.js` | DNS presets, dnscrypt-proxy lifecycle, original-DNS snapshots and crash recovery |
| `tor.js` | Tor process lifecycle |
| `isp.js` | ISP/ASN detection and profile recommendation |
| `autostart.js` | Windows logon/startup integration |
| `updater.js` | Update check/download/apply pipeline |
| `verify.js` | Runtime file verification and repair |
| `proxy.js` | Local proxy lifecycle/helpers |
| `burnedcord.js` | BurnedCord BrowserWindow, tray, permissions, native desktop capture/clipboard/PTT bridge |
| `zapret/` | DPI profiles, engine, hostlists, payloads, health/failover and blockcheck |
| `ai/` | Optional AI-related application helpers |

## Renderer

The main BurnedWolf UI lives under `renderer/`.

The UI communicates with privileged functionality through IPC. Keep the existing IPC contract stable when changing visual structure; renaming an element or channel without updating both sides can break otherwise unrelated controls.

## DPI engine

The `src/main/zapret/` area separates profile data from engine lifecycle and diagnostics. The application can select profiles automatically, let users choose a profile manually, run profile analysis, and manage custom profiles.

Low-level packet-processing binaries are treated as runtime assets rather than ordinary renderer code.

## DNS lifecycle

Encrypted DNS is deliberately defensive because changing the Windows adapter to a local loopback resolver can cut off connectivity if the local resolver disappears.

The DNS path therefore includes:

1. detecting the active adapter;
2. capturing the current DNS configuration;
3. starting the local encrypted resolver;
4. pointing the adapter at the loopback resolver;
5. restoring the original state on clean shutdown;
6. persisting enough recovery state to repair an abnormal shutdown;
7. performing an independent loopback-residue preflight on later launches.

Changes to this module should be tested with both DHCP DNS and statically configured DNS.

## BurnedCord

BurnedCord is a separate Electron `BrowserWindow` with its own tray entry and persistent partition.

The renderer is loaded from the canonical HTTPS service at:

```text
https://chat.whyscripts.com/app/
```

The native desktop bridge adds capabilities that a normal web page cannot provide as cleanly, including:

- controlled media permissions;
- native screen/window source selection;
- Windows system-audio loopback for supported screen-share flows;
- native clipboard operations;
- Windows-global push-to-talk state using `GetAsyncKeyState`.

The voice/WebRTC service itself is hosted separately from this repository.

## Distribution

Public URLs are centralized in `src/main/distribution.js` to avoid different features drifting onto different release channels.

Application updates and runtime repair are separate concepts:

- the updater replaces application code through the application update package;
- integrity repair downloads the official runtime repair bundle when bundled files are missing or corrupt.

## Shutdown order

The application registers cleanup tasks so network-changing child processes and DNS state are cleaned up during a full quit. When changing process lifecycle code, preserve idempotency and cleanup ordering.
