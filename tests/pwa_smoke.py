#!/usr/bin/env python3
"""Focused browser checks for save/resume, offline PWA and the share bundle."""

from __future__ import annotations

import contextlib
import functools
import http.server
import subprocess
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
BUNDLE = ROOT / "支了个婷_手机分享版.html"


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, _format: str, *_args: object) -> None:
        pass


@contextlib.contextmanager
def server_url():
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/"
    finally:
        server.shutdown()
        thread.join(timeout=5)
        server.server_close()


def verify_pwa(browser, base_url: str) -> None:
    context = browser.new_context(viewport={"width": 390, "height": 844})
    page = context.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))

    page.goto(base_url, wait_until="domcontentloaded")
    page.evaluate("localStorage.setItem('zlt-tutorial-v1', '1')")
    if page.locator("#modal").is_visible():
        page.locator("#modal-primary").click()
    page.locator("#btn-start-game").wait_for(state="visible")
    page.evaluate("localStorage.setItem('zlt-save-v4', '{broken-json')")
    page.reload(wait_until="domcontentloaded")
    page.locator("#btn-start-game").wait_for(state="visible")

    initial_sound_label = page.locator("#btn-sound").get_attribute("aria-label")
    page.locator("#btn-sound").click()
    muted_sound_label = page.locator("#btn-sound").get_attribute("aria-label")
    page.locator("#btn-sound").click()
    assert initial_sound_label != muted_sound_label

    page.locator("#btn-start-game").click()
    page.locator(".card:not(:disabled)").first.wait_for(state="visible", timeout=10_000)
    page.locator(".card:not(:disabled)").first.click()
    page.wait_for_function("localStorage.getItem('zlt-save-v4') !== null")
    page.reload(wait_until="domcontentloaded")
    page.locator("#btn-start-game").wait_for(state="visible")
    assert "继续" in page.locator("#start-button-label").inner_text()
    page.locator("#btn-start-game").click()
    page.locator("#game-container").wait_for(state="visible")
    page.locator(".card").first.wait_for(state="visible", timeout=10_000)

    page.evaluate("navigator.serviceWorker.ready")
    page.reload(wait_until="domcontentloaded")
    page.wait_for_function("navigator.serviceWorker.controller !== null")
    context.set_offline(True)
    page.reload(wait_until="domcontentloaded", timeout=10_000)
    page.locator("#btn-start-game").wait_for(state="attached")
    context.set_offline(False)

    assert not errors, errors
    context.close()


def verify_share_bundle(browser) -> None:
    context = browser.new_context(viewport={"width": 390, "height": 844})
    page = context.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(BUNDLE.as_uri(), wait_until="load")
    page.evaluate("localStorage.setItem('zlt-tutorial-v1', '1')")
    if page.locator("#modal").is_visible():
        page.locator("#modal-primary").click()
    page.locator("#btn-start-game").click()
    page.locator(".card:not(:disabled)").first.wait_for(state="visible", timeout=10_000)
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    assert not errors, errors
    context.close()


def main() -> int:
    result = subprocess.run([sys.executable, str(ROOT / "build.py")], cwd=ROOT)
    if result.returncode:
        return result.returncode
    with server_url() as base_url, sync_playwright() as playwright:
        try:
            browser = playwright.chromium.launch(channel="chrome", headless=True)
        except Exception:
            browser = playwright.chromium.launch(headless=True)
        try:
            verify_pwa(browser, base_url)
            verify_share_bundle(browser)
        finally:
            browser.close()
    print("PWA and share-bundle smoke checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
