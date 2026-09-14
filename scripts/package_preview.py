#!/usr/bin/env python3
"""Package existing builds for unpacked installation; never builds or publishes."""
import argparse
import hashlib
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--browser", choices=("chrome", "firefox", "all"), default="all")
args = parser.parse_args()
browsers = ("chrome", "firefox") if args.browser == "all" else (args.browser,)
version = json.loads((root / "package.json").read_text())["version"]
output = root / "artifacts"
output.mkdir(exist_ok=True)
checksums = []
for browser in browsers:
    build = root / ".output" / f"{browser}-mv3"
    if not (build / "manifest.json").is_file():
        raise SystemExit(f"Missing {browser} build. Run bun run build:{browser} first.")
    archive = output / f"auto-tab-groups-linked-{version}-{browser}.zip"
    with ZipFile(archive, "w", ZIP_DEFLATED) as bundle:
        for source in sorted(build.rglob("*")):
            if source.is_file():
                bundle.write(source, source.relative_to(build))
        bundle.write(root / "README.md", "README.md")
        for source in sorted((root / "docs").glob("*.md")):
            bundle.write(source, Path("docs") / source.name)
    with ZipFile(archive) as bundle:
        if bundle.testzip() is not None:
            raise SystemExit(f"Corrupt archive: {archive.name}")
    checksums.append(f"{hashlib.sha256(archive.read_bytes()).hexdigest()}  {archive.name}\n")
    print(archive.relative_to(root))
(output / "SHA256SUMS.txt").write_text("".join(checksums))
