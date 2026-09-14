#!/usr/bin/env python3
"""Build the minimal GitHub Pages artifact for MarketVivi.

The repository contains engineering records and audit material that must never
become web content.  This script deliberately copies only the PWA runtime
files into a new, empty output directory.  It is used by the manual Pages
workflow after the repository's Pages source is switched to GitHub Actions.
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RUNTIME_FILES = (
    "index.html",
    "app.js",
    "api.js",
    "log-viewer.js",
    "style.css",
    "manifest.json",
)


def output_path(raw: str) -> Path:
    out = Path(raw).resolve()
    if out == ROOT or ROOT not in out.parents:
        raise SystemExit("output must be a child of the MarketVivi repository")
    if out.exists() and any(out.iterdir()):
        raise SystemExit("output directory must be absent or empty")
    return out


def build(output: Path) -> list[str]:
    output.mkdir(parents=True, exist_ok=True)
    copied: list[str] = []
    for relative in RUNTIME_FILES:
        source = ROOT / relative
        if not source.is_file() or source.is_symlink():
            raise SystemExit(f"required runtime file missing or unsafe: {relative}")
        shutil.copy2(source, output / relative)
        copied.append(relative)
    (output / ".nojekyll").write_text("\n", encoding="utf-8")
    return copied


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    copied = build(output_path(args.output))
    print("Pages artifact contains: " + ", ".join(copied))


if __name__ == "__main__":
    main()
