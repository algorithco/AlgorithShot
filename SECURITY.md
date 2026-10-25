# Security policy

## Supported versions

Only the latest release of the AlgorithShot desktop app gets security fixes.
Please check that you are on the
[latest release](https://github.com/algorithco/algorith-shot/releases/latest)
before you report a problem.

| Version | Supported |
| --- | --- |
| Latest release | Yes |
| Older releases | No |

The HTTP API in [`shot-api/`](shot-api/) is not yet a public service. Reports
about it are still welcome.

## Reporting a vulnerability

Do not report security problems in issues, discussions or pull requests, even
though the repository is private. Instead, email **hello@algorithco.com** with
"Security" in the subject.

Please include:

- the AlgorithShot version (shown in **Settings › About**) and your Windows version;
- what an attacker could do, and the steps or a proof of concept to reproduce it;
- logs or screenshots, with your own private data removed.

We will confirm that we have received your report and keep you informed while
we investigate and fix it. Please do not disclose the problem publicly until a
fix has been released. With your permission, we will credit you in the release
notes.

## Scope

We are especially interested in:

- the in-app updater and release signing (`latest.json` and installer signatures);
- the `shot://` protocol, file handling, and anything that could read, write
  or delete files outside the screenshot folders;
- the privacy check missing personal data that it should hide;
- the installer and uninstaller;
- the HTTP API in `shot-api/`.

Out of scope:

- problems that need an attacker who already controls the user's Windows account
  or has administrator rights;
- reports from automated scanners that show no real impact;
- social engineering and physical attacks.
