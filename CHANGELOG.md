# Changelog

## 1.1.3

- Write shell payloads to temporary files and execute those files instead of piping decoded content directly into a shell.

## 1.1.2

- Make the shared status file fall back to `/sdcard/Download` when the primary location is read-only.
- Verify dependency status live when the shared status is stale.

## 1.1.1

- Show PHP linter errors through CodeMirror 6 diagnostics, with an Ace fallback on older Acode versions.
- Merge stored settings with defaults so new options work after upgrades.
- Clear status intervals, lint timers, editor listeners, and registered snippets when the plugin is unmounted.

## 1.1.0

- Improve service status checks and phpMyAdmin detection.
- Escape credentials robustly in phpMyAdmin, Adminer, and MariaDB grant operations.
- Bind MariaDB, phpMyAdmin, and Adminer to localhost.

## 1.0.9

- Run PHP server start/stop in Acode’s server-backed terminal and sync runtime status through shared storage.
