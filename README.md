# PHP Workstation

PHP + MariaDB + phpMyAdmin/Adminer dev environment for Acode.

1. Open the side bar and tap the PHP icon.
2. Tap **Install / Check** once. The plugin opens Acode's server-backed Alpine terminal and runs the PHP, MariaDB, phpMyAdmin and Adminer setup directly there (internet required). Keep that terminal open until it prints **INSTALL FINISHED**. The PHP server Start/Stop controls run in the same Acode terminal session.
3. Pick a **Root** folder and tap **Start** on Server, then **Open in App** or **Browser**.
4. Start MySQL, then open phpMyAdmin or Adminer.

Default DB user: `root`, empty password (changeable in MySQL ⚙). MariaDB, phpMyAdmin and Adminer listen on `127.0.0.1` only, so they are reachable from this device but not from other devices on the network. The PHP server itself listens on `0.0.0.0` so you can open it from another device on the same Wi-Fi.

Plugin settings: Acode → Settings → Plugins → PHP Workstation (linter mode, snippets, Prettier JSON rules).

Notes: use projects under shared storage (`/sdcard`) or type a path manually via Root. License: MIT.
