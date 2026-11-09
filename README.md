# PHP Workstation for Acode

PHP Workstation is an Acode editor plugin that sets up PHP and MariaDB in Acode’s Alpine environment and provides controls for a PHP development server, database tools, PHP linting, snippets, and formatting.

This repository contains the source for plugin version **1.1.3**, matching the supplied ZIP. The plugin bundle uses the lowercase `readme.md` file named in `plugin.json`; this README adds implementation and security details for maintainers and reviewers.

## Install and terminal behavior

In Acode, open the PHP Workstation sidebar panel and tap **Install / Check**. The plugin opens Acode’s server-backed terminal. It writes the locally assembled installer to `/tmp/pw/install-pw.sh`, asks the visible terminal to run `/bin/sh /tmp/pw/install-pw.sh`, and removes the temporary script after execution. The installer output is visible in the Acode terminal; keep that terminal open until it prints `INSTALL FINISHED`.

The installer uses Alpine’s `apk` package manager to update package indexes and install PHP packages and extensions, MariaDB packages, and phpMyAdmin when available. It initializes MariaDB’s data directory. These operations require network access and sufficient terminal privileges. The script content is authored in `main.js`; the plugin does not fetch a shell installer from a remote host.

The PHP server **Start** and **Stop** controls also write short scripts under `/tmp/pw` and send commands to Acode’s server-backed terminal. The PHP built-in server binds to `0.0.0.0` on the configured port. Its process ID, log, and injected PHP support file are stored under `/tmp/pw`. phpMyAdmin and Adminer helper servers bind to `127.0.0.1`. MariaDB is started with `--bind-address=127.0.0.1`.

The plugin uses Acode’s `Executor` API for other shell operations, including package/status checks, PHP linting, and some utility tasks. On some Acode installations, the Executor environment may differ from the visible server terminal. The source also writes runtime status to shared storage paths, including `/sdcard/.php-workstation-status.json` and `/sdcard/Download/.php-workstation-status.json`, when writable.

## Adminer download

Adminer is **not bundled in this repository or the plugin ZIP**. During installation, if `/opt/adminer/adminer.php` is missing or empty, the plugin tries `wget` and then `curl` to download:

`https://www.adminer.org/latest-mysql.php`

The response is saved as `/opt/adminer/adminer.php`. The **Re-download Adminer** setting uses the same URL. This is an unpinned “latest” URL, so the downloaded PHP application can change over time and setup requires network access to that host. PHP executes the downloaded Adminer application when the Adminer page is opened. Review its release and security information before using it with sensitive data.

The plugin also loads Prettier and its PHP parser from jsDelivr when formatting is first used. The optional Eruda developer console is loaded from jsDelivr only when that debug option is enabled.

## Security notes

This plugin has intentionally powerful capabilities. It uses Acode’s terminal and shell-execution APIs to install packages, start and stop services, write configuration files, and run PHP. Review `main.js` before installing it, and do not install a build from an untrusted source. The 1.1.3 change writes shell payloads to temporary files before executing them instead of piping decoded content directly into a shell. This improves scanner visibility, but it does not remove the plugin’s shell capability or guarantee approval by Acode’s scanner or reviewers.

The PHP development server binds to `0.0.0.0`, so other devices on the same Wi-Fi may be able to connect depending on device and network firewall rules. MariaDB and the phpMyAdmin/Adminer helper servers bind to `127.0.0.1` in this version. Do not expose the development server to the public internet. The documented default database account is `root` with an empty password; configure a password before using the database on any network you do not fully trust.

Package files are installed from the configured Alpine repositories. Adminer is downloaded from the unpinned URL above and then executed by PHP when its page is opened. Prettier and the PHP parser are loaded from jsDelivr; Eruda is fetched only when its debug option is enabled.

## Build the Acode plugin ZIP

Python 3 is the only build requirement. From the repository root, run:

```sh
python3 scripts/package.py
```

The script reads the version from `plugin.json` and creates `dist/PHP_Workstation_<version>.zip` from an explicit allowlist: `plugin.json`, `main.js`, `icon.png`, `readme.md`, and `changelogs.md`. Repository documentation and build files are not included in the plugin archive.

Before publishing an update, increment `version` in `plugin.json` and update `changelogs.md`. Review the resulting archive and scanner report before submitting it to Acode.

## License

The source is distributed under the MIT License; see [`LICENSE`](LICENSE).
