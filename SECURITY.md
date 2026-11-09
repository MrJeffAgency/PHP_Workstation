# Security notes

PHP Workstation is a development tool with shell access. It is not a hardened production server manager.

## Capabilities and data flow

- The plugin uses Acode’s server-terminal API and `Executor` API. Installer and PHP server-control scripts are authored in the plugin source, written to temporary files under `/tmp/pw`, and invoked with `/bin/sh` in the Acode Alpine terminal. Other shell operations use the Executor API.
- Setup uses Alpine `apk` to install PHP, extensions, MariaDB, and optionally phpMyAdmin. It initializes MariaDB’s local data directory.
- Setup and the Adminer re-download action fetch `https://www.adminer.org/latest-mysql.php` using `wget` or `curl`, then save the response as `/opt/adminer/adminer.php`. The URL is unpinned and may serve a newer file later. PHP executes this downloaded application when the Adminer page is opened.
- Prettier and its PHP plugin are loaded from jsDelivr when formatting is used. Eruda is loaded from jsDelivr only when the developer-tools option is enabled.
- The PHP development server binds to `0.0.0.0`; MariaDB and the phpMyAdmin/Adminer helper servers bind to `127.0.0.1` in version 1.1.3. Network reachability of the PHP server depends on device and network firewall configuration.
- The default database credentials shown by the plugin are `root` with an empty password unless the user changes them.

Do not expose the development server to untrusted networks. Set a database password and use the smallest network scope practical. Do not place production credentials or production data in this development environment.

## Reporting a vulnerability

Do not include passwords, tokens, database dumps, or other sensitive data in a public issue. Use the repository host’s private vulnerability-reporting feature if it is enabled. Otherwise contact the maintainer through the project’s published contact channel and provide a minimal reproduction.
