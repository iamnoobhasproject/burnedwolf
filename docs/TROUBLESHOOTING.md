# Troubleshooting

## BurnedWolf says it is up to date when I expected an update

1. Fully quit BurnedWolf from the tray.
2. Confirm no BurnedWolf process remains in Task Manager.
3. Start it again and check the version displayed in the application.
4. Verify that the official update manifest actually contains a higher version than the installed build.

The current updater compares semantic `MAJOR.MINOR.PATCH` versions rather than treating every different version string as newer.

## Internet/DNS is broken after a crash

BurnedWolf includes crash-safe DNS recovery and a preflight that looks for stale loopback DNS state.

Start BurnedWolf and allow the preflight to complete. If the UI offers a DNS repair action, use it before manually changing adapter settings.

If manual recovery is still necessary, restore your active adapter's DNS configuration to automatic/DHCP or to the static DNS servers you intentionally used before BurnedWolf.

## Integrity check cannot download the repair bundle

- Confirm normal HTTPS access to GitHub is working.
- Confirm the configured repair Release asset still exists.
- Check whether a firewall/security product is blocking the application.
- Do not download a replacement runtime bundle from an untrusted mirror.

## Protection starts but a service is still blocked

Run **Network analysis** and test the recommended profiles. Filtering behaviour can differ by ISP, route and protocol, so a profile that works on one connection may not be the best choice on another.

For advanced users, BurnedWolf also provides custom profile management.

## BurnedCord opens but media does not work

- Make sure both clients are on the latest BurnedWolf version.
- Create a fresh room/session when testing major WebRTC changes.
- Check Windows microphone/camera privacy permissions.
- Confirm the BurnedCord hosted app loads normally from `https://chat.whyscripts.com/app/`.
- Fully quit and relaunch BurnedWolf after changing system media permissions.

## Push-to-talk works only while BurnedCord is focused

Current desktop builds include a Windows-global PTT bridge. If focus is still required, confirm you are running a current 4.6.x-or-newer build and fully restarted after updating.

Some protected/anti-cheat games may apply their own input restrictions; do not attempt to bypass a game's security controls.

## Copy buttons do nothing

Current desktop builds use Electron's native clipboard bridge for BurnedCord desktop actions. Fully restart the application after updating. If the issue remains, include the exact screen/button in a bug report.

## What should I attach to an issue?

Good:

- application version
- Windows version
- exact reproduction steps
- sanitized log excerpts
- screenshots with private information removed

Do not attach:

- API keys
- passwords
- cookies/tokens
- private configuration files containing secrets
