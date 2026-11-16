# Security

MapNG is a website (mapng.com) and a desktop app (Windows and Linux) that build BeamNG.drive levels from
public map data. This page says how to report a problem and how to check what you downloaded. What MapNG
connects to, what it stores and what the desktop app writes on your computer are on
[mapng.com/data.html](https://mapng.com/data.html).

## Reporting a problem

Please report security problems privately:
[open a private report](https://github.com/nikkiluzader/mapng/security/advisories/new) (GitHub's private
vulnerability reporting). Say what you found, how to reproduce it and which version or page it concerns.
Please do not open a public issue for something that could put users at risk before it is fixed.

Fixes go to the newest release; older desktop versions are updated by installing the newest one.

## Checking a desktop download

You never need the desktop app: the website does the same work in the browser. If you do install it:

- **Where it was built.** Releases are built by
  [a GitHub Actions workflow](.github/workflows/desktop-release.yml) from a tagged commit of this
  repository. The run's log is public, and only the project's admin can create a release tag.
- **Checksums.** Each release (from the one after 0.3.2) has `SHA256SUMS-win32.txt` and
  `SHA256SUMS-linux.txt`. Compare with `sha256sum <file>` (Linux) or
  `Get-FileHash <file> -Algorithm SHA256` (Windows PowerShell).
- **Build provenance.** From the same release on:
  `gh attestation verify <file> --repo nikkiluzader/mapng` shows the commit and the workflow run that
  produced the file.
- **Updates.** The app accepts an update only when its update file carries MapNG's signature
  (`desktop/updateSignature.js`).
- **Not yet signed for Windows.** The installer has no Windows code signature, so SmartScreen warns
  about it. A certificate is planned.

## What the app can reach

- Every address in the code is listed in [`desktop/networkHosts.js`](desktop/networkHosts.js) and on
  [mapng.com/data.html](https://mapng.com/data.html#addresses); a test fails when one is added without
  being listed. The desktop app shows what it has contacted under **Help > Network Activity** and marks
  anything that is not on the list. The list is documentation and a check, not a block: the app can
  also reach an Overpass server you set as your own.
- The desktop window runs sandboxed with context isolation and no Node access. Only MapNG's own pages
  may call the app's native side, the window cannot navigate elsewhere, and file writes are confined to
  the app's own folder, your Downloads folder and the BeamNG mods folder you chose.
- The website and the app ship a content security policy: scripts only from MapNG itself.
- Reports, usage stats and export locations are sent only when you opt in or press Send.

## What has and has not been reviewed

The project reviewed its own server, desktop app and website in November 2026 and fixed what it found.
There has been no outside audit.
