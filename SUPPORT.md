# Support

## First steps

Before opening an issue:

1. Update BurnedWolf to the latest available application version.
2. Check the **Updates** screen for a separate Core/Electron runtime update and install it if one is offered.
3. Fully exit BurnedWolf from the tray and launch it again.
4. If the problem involves bundled runtime files, run **Integrity** from the application.
5. If the problem involves DNS after a crash or forced shutdown, allow BurnedWolf's DNS preflight/recovery to run and use the DNS repair action if offered.
6. Reproduce the problem once and note the exact sequence of actions.

See [Troubleshooting](docs/TROUBLESHOOTING.md) for common cases.

## Where to ask

- Bug reports: https://github.com/iamnoobhasproject/burnedwolf/issues
- Product page: https://burnedwolf.whyscripts.com/
- WhyScripts: https://whyscripts.com/

## What to include

A useful support report includes:

- BurnedWolf version
- Electron/Core version shown in the Updates screen
- Windows version
- affected feature
- exact reproduction steps
- expected result
- actual result
- sanitized logs/screenshots

For update issues, also state whether the problem concerns:

- **Application update** (`app.asar` / v2 channel), or
- **Core update** (full Electron/NSIS runtime update).

Do not post secrets, tokens, passwords, cookies, private credentials, or private update-signing material.
