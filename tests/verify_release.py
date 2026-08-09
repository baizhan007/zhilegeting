#!/usr/bin/env python3
"""Zero-dependency release checks for the PWA and single-file build."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import struct
import subprocess
import sys
import tempfile
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BUNDLE = ROOT / "支了个婷_手机分享版.html"


class AssetParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.assets: list[tuple[str, str, str]] = []
        self.buttons: list[dict[str, str | None]] = []
        self.scripts: list[str] = []
        self.viewport: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag == "meta" and values.get("name") == "viewport":
            self.viewport = values.get("content")
        if tag == "button":
            self.buttons.append(values)
        if tag == "script" and values.get("src"):
            self.scripts.append(values["src"] or "")
        for attribute in ("src", "href", "poster"):
            value = values.get(attribute)
            if value:
                self.assets.append((tag, attribute, value))


def args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skip-build", action="store_true", help="验证现有单文件，不重新构建")
    return parser.parse_args()


def local_reference(reference: str) -> str | None:
    if reference.startswith(("data:", "http:", "https:", "//", "#", "mailto:", "tel:")):
        return None
    return re.split(r"[?#]", reference, maxsplit=1)[0]


def png_size(path: Path) -> tuple[int, int]:
    with path.open("rb") as stream:
        header = stream.read(24)
    if len(header) < 24 or header[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"Not a PNG: {path}")
    return struct.unpack(">II", header[16:24])


def check_javascript(path: Path, failures: list[str]) -> None:
    node = shutil.which("node")
    if not node:
        print("WARN: node is unavailable; JavaScript syntax checks were skipped")
        return
    result = subprocess.run(
        [node, "--check", str(path)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if result.returncode:
        failures.append(f"JavaScript syntax error in {path.name}: {result.stderr.strip()}")


def parse_shell(sw_text: str, failures: list[str]) -> set[str]:
    match = re.search(r"const\s+APP_SHELL\s*=\s*\[(.*?)\]\s*;", sw_text, re.DOTALL)
    if not match:
        failures.append("sw.js does not declare APP_SHELL")
        return set()
    return {item for _, item in re.findall(r"([\"'])(.*?)(?:\1)", match.group(1))}


def check_manifest(failures: list[str]) -> None:
    manifest_path = ROOT / "manifest.webmanifest"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        failures.append(f"Invalid manifest.webmanifest: {error}")
        return

    for key in ("id", "name", "short_name", "start_url", "scope", "display", "theme_color", "icons"):
        if not manifest.get(key):
            failures.append(f"Manifest is missing {key}")
    if manifest.get("lang") != "zh-CN":
        failures.append("Manifest lang must be zh-CN")
    if manifest.get("display") not in {"standalone", "fullscreen", "minimal-ui"}:
        failures.append("Manifest display is not installable")

    declared_sizes: set[int] = set()
    for icon in manifest.get("icons", []):
        source = icon.get("src", "")
        local = local_reference(source)
        if not local:
            continue
        path = ROOT / local
        if not path.is_file():
            failures.append(f"Manifest icon does not exist: {source}")
            continue
        match = re.fullmatch(r"(\d+)x(\d+)", icon.get("sizes", ""))
        if not match:
            failures.append(f"Manifest icon has invalid sizes: {source}")
            continue
        declared = (int(match.group(1)), int(match.group(2)))
        try:
            actual = png_size(path)
        except ValueError as error:
            failures.append(str(error))
            continue
        if declared != actual:
            failures.append(f"Manifest icon size mismatch for {source}: declared {declared}, actual {actual}")
        if declared[0] == declared[1]:
            declared_sizes.add(declared[0])
    if not {192, 512}.issubset(declared_sizes):
        failures.append("Manifest must provide square 192px and 512px icons")


def check_source_page(failures: list[str]) -> set[str]:
    index = (ROOT / "index.html").read_text(encoding="utf-8")
    parser = AssetParser()
    parser.feed(index)

    if not parser.viewport or "viewport-fit=cover" not in parser.viewport:
        failures.append("Viewport must include viewport-fit=cover for safe-area support")
    for button in parser.buttons:
        if button.get("type") != "button":
            failures.append(f"Button #{button.get('id', '<unknown>')} must set type=button")

    required_ids = {
        "btn-sound",
        "btn-start-game",
        "game-container",
        "game-area",
        "slot-area",
        "game-status",
    }
    for element_id in sorted(required_ids):
        if not re.search(rf'\bid=["\']{re.escape(element_id)}["\']', index):
            failures.append(f"Missing critical UI element #{element_id}")
    sound_button = re.search(r'<button\b[^>]*\bid=["\']btn-sound["\'][^>]*>', index, re.IGNORECASE)
    if not sound_button or "aria-label=" not in sound_button.group(0):
        failures.append("Sound control needs an accessible aria-label")

    runtime_order = [local_reference(reference) for reference in parser.scripts]
    expected_runtime = ["challenge-engine.js", "audio-engine.js", "script.js"]
    if runtime_order != expected_runtime:
        failures.append(
            "Runtime scripts must load in order: " + " -> ".join(expected_runtime)
            + f"; found {runtime_order}"
        )

    local_assets: set[str] = set()
    for _, _, reference in parser.assets:
        local = local_reference(reference)
        if not local:
            continue
        path = ROOT / local
        if not path.is_file():
            failures.append(f"index.html references a missing file: {reference}")
        local_assets.add("./" + local.replace("\\", "/").lstrip("./"))
    return local_assets


def check_service_worker(page_assets: set[str], failures: list[str]) -> None:
    path = ROOT / "sw.js"
    text = path.read_text(encoding="utf-8")
    check_javascript(path, failures)
    cache_match = re.search(r"CACHE_NAME\s*=\s*[\"']([^\"']+)[\"']", text)
    if not cache_match or not re.search(r"-v\d+$", cache_match.group(1)):
        failures.append("Service worker CACHE_NAME needs an explicit numeric release version")

    shell = parse_shell(text, failures)
    for reference in sorted(shell):
        local = local_reference(reference)
        if local in {None, "", ".", "./"}:
            continue
        if not (ROOT / local).is_file():
            failures.append(f"APP_SHELL contains a missing file: {reference}")
    missing = sorted(page_assets - shell - {"./manifest.webmanifest"})
    if missing:
        failures.append("APP_SHELL misses page dependencies: " + ", ".join(missing))
    if "./manifest.webmanifest" not in shell:
        failures.append("APP_SHELL must cache manifest.webmanifest")


def check_bundle(skip_build: bool, failures: list[str]) -> None:
    if not skip_build:
        result = subprocess.run(
            [sys.executable, str(ROOT / "build.py")],
            cwd=ROOT,
            capture_output=True,
            text=True,
            errors="replace",
        )
        if result.returncode:
            failures.append(f"Single-file build failed: {result.stderr.strip()}")
            return
        print(f"Built {DEFAULT_BUNDLE.name} ({DEFAULT_BUNDLE.stat().st_size:,} bytes)")
    if not DEFAULT_BUNDLE.is_file():
        failures.append(f"Single-file output does not exist: {DEFAULT_BUNDLE.name}")
        return

    text = DEFAULT_BUNDLE.read_text(encoding="utf-8")
    parser = AssetParser()
    parser.feed(text)
    unresolved = [
        f"{tag}[{attribute}]={reference}"
        for tag, attribute, reference in parser.assets
        if local_reference(reference)
    ]
    unresolved.extend(
        match.group(1)
        for match in re.finditer(r"url\(\s*[\"']?([^\"')]+)", text, re.IGNORECASE)
        if local_reference(match.group(1))
    )
    if unresolved:
        failures.append("Single-file build has unresolved local assets: " + ", ".join(unresolved[:8]))
    if '<link rel="manifest"' in text.lower():
        failures.append("Single-file build must not include a web manifest link")
    if DEFAULT_BUNDLE.stat().st_size > 10 * 1024 * 1024:
        failures.append("Single-file build exceeds the 10 MiB sharing budget")


def check_storage_contract(failures: list[str]) -> None:
    sources = "\n".join(
        path.read_text(encoding="utf-8")
        for path in sorted(ROOT.glob("*.js"))
        if path.name != "sw.js"
    )
    storage_keys = re.findall(r"[\"'](zlt-[a-z0-9-]+)[\"']", sources, re.IGNORECASE)
    for key in storage_keys:
        if not re.search(r"-v\d+$", key):
            failures.append(f"Persistent storage key is not versioned: {key}")


def main() -> int:
    options = args()
    failures: list[str] = []
    page_assets = check_source_page(failures)
    check_manifest(failures)
    check_service_worker(page_assets, failures)
    check_storage_contract(failures)
    for script in sorted(ROOT.glob("*.js")):
        if script.name != "sw.js":
            check_javascript(script, failures)
    check_bundle(options.skip_build, failures)

    if failures:
        print("\nRELEASE CHECK FAILED", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1
    print("Release checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
