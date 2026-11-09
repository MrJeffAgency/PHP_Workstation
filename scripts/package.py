#!/usr/bin/env python3
"""Build an Acode plugin ZIP from the repository's explicit plugin-file allowlist."""

from __future__ import annotations

import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
PLUGIN_FILES = ("plugin.json", "main.js", "icon.png", "readme.md", "changelogs.md")


def main() -> None:
    manifest_path = ROOT / "plugin.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    version = manifest.get("version")
    if not isinstance(version, str) or not version.strip():
        raise SystemExit("plugin.json must contain a non-empty string version")

    missing = [name for name in PLUGIN_FILES if not (ROOT / name).is_file()]
    if missing:
        raise SystemExit("Missing plugin file(s): " + ", ".join(missing))

    dist = ROOT / "dist"
    dist.mkdir(exist_ok=True)
    output = dist / f"PHP_Workstation_{version}.zip"
    with ZipFile(output, "w", compression=ZIP_DEFLATED) as archive:
        for name in PLUGIN_FILES:
            archive.write(ROOT / name, arcname=name)
    print(f"Built {output.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
