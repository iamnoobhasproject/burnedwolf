# Third-Party Notices

BurnedWolf contains, bundles, integrates with, or interoperates with third-party open-source software. BurnedWolf's MIT License applies only to BurnedWolf's original code and does not replace the licenses of these third-party projects.

The list below highlights important runtime/build components. It is not intended to replace the complete license files supplied by each upstream project.

## Zapret

Project: https://github.com/bol-van/zapret

License: MIT License

Copyright (c) 2016-2024 bol-van

BurnedWolf may use Zapret components for DPI-related functionality. Zapret remains licensed under its upstream MIT License. Preserve the upstream copyright and license notice with redistributed copies or substantial portions.

Upstream license:
https://github.com/bol-van/zapret/blob/master/docs/LICENSE.txt

## dnscrypt-proxy

Project: https://github.com/DNSCrypt/dnscrypt-proxy

License: ISC License

Copyright (c) 2018-2026, Frank Denis

BurnedWolf may distribute or invoke dnscrypt-proxy for encrypted DNS functionality. dnscrypt-proxy remains licensed under its upstream ISC License. Preserve its upstream copyright and permission notice when redistributing it.

Upstream license:
https://github.com/DNSCrypt/dnscrypt-proxy/blob/master/LICENSE

## WinDivert

Project: https://github.com/basil00/WinDivert

License: GNU Lesser General Public License version 3 (LGPLv3) OR GNU General Public License version 2 (GPLv2), at the recipient's choice.

WinDivert is used by networking components associated with DPI filtering. WinDivert is not covered by BurnedWolf's MIT License.

When redistributing WinDivert binaries, include the complete upstream WinDivert license text and comply with the applicable redistribution requirements of the license option you rely on.

Upstream license:
https://github.com/basil00/WinDivert/blob/master/LICENSE

## Tor

Project: https://www.torproject.org/

BurnedWolf's build configuration can package Tor runtime files. Tor remains subject to the Tor Project's own license and copyright terms. If Tor binaries are redistributed with BurnedWolf, include the Tor license material supplied with the distributed Tor package.

Tor redistribution information:
https://support.torproject.org/about-tor/using-and-sharing/distributing/

## Electron

Project: https://github.com/electron/electron

BurnedWolf is packaged with Electron. Electron and the Chromium/Node.js components distributed with it remain subject to their respective upstream licenses and notices.

## electron-updater / electron-builder

Project: https://github.com/electron-userland/electron-builder

BurnedWolf uses electron-builder for Windows packaging and electron-updater for modern full Core/runtime updates. These packages retain their own upstream licenses and dependency notices.

## Other npm dependencies

Other npm packages used for development or runtime functionality retain their own upstream licenses. A packaged binary must continue to satisfy the notice and redistribution requirements applicable to all included dependencies.

---

This file is provided as a project notice and is not legal advice. When publishing binary installers, preserve the complete license files that ship with third-party runtime components rather than relying only on this summary.
