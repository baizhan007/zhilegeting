from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "playwright"
BASE_URL = "http://127.0.0.1:4173/"
SHARE_URL = (ROOT / "支了个婷_手机分享版.html").as_uri()


def assert_inside_viewport(page, selector: str, width: int) -> None:
    box = page.locator(selector).bounding_box()
    assert box, f"Missing box for {selector}"
    assert box["x"] >= -0.5, f"{selector} leaves viewport on the left: {box}"
    assert box["x"] + box["width"] <= width + 0.5, f"{selector} leaves viewport on the right: {box}"


def open_challenge(page) -> dict:
    page.goto(BASE_URL, wait_until="networkidle")
    page.evaluate("localStorage.clear()")
    page.wait_for_timeout(100)
    # Dismiss tutorial if it's open
    if page.locator("#modal").is_visible():
        page.locator("#modal-primary").click()
    page.locator("#btn-start-game").click()
    page.wait_for_timeout(250)
    audio_state = page.evaluate("window.AudioEngine.state")
    page.evaluate("startStage(1)")
    page.wait_for_timeout(200)
    return audio_state


def verify_viewport(browser, width: int, height: int, name: str) -> None:
    context = browser.new_context(
        viewport={"width": width, "height": height},
        device_scale_factor=1,
        reduced_motion="reduce",
    )
    page = context.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))

    page.goto(BASE_URL, wait_until="networkidle")
    start_box = page.locator(".start-content").bounding_box()
    assert start_box and start_box["x"] >= 20
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    page.screenshot(path=OUTPUT / f"release-start-{name}.png")

    audio_state = open_challenge(page)
    assert audio_state["supported"]
    assert audio_state["contextState"] == "running"
    assert audio_state["musicWanted"]
    assert page.locator('.card[data-location="pile"]').count() == 126
    assert page.locator('.card[data-location="pile"]:not(.blocked)').count() == 7
    assert page.locator('.card[data-location="pile"].blocked').count() == 119
    assert page.locator("#remaining-count").inner_text() == "126 张"
    assert page.locator("#stage-name").inner_text() == "挑战局"
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")

    for selector in (".game-header", ".tray-panel", ".toolbar", ".board-meta"):
        assert_inside_viewport(page, selector, width)
    cards_inside = page.evaluate(
        """
        () => {
            const area = document.querySelector('#game-area').getBoundingClientRect();
            return [...document.querySelectorAll('.card[data-location="pile"]')].every((card) => {
                const box = card.getBoundingClientRect();
                return box.left >= area.left - 1 && box.right <= area.right + 1 &&
                    box.top >= area.top - 1 && box.bottom <= area.bottom + 1;
            });
        }
        """
    )
    assert cards_inside
    page.screenshot(path=OUTPUT / f"release-challenge-{name}.png")
    assert not errors, errors
    context.close()


def verify_witness_and_tools(browser) -> None:
    context = browser.new_context(viewport={"width": 390, "height": 844}, reduced_motion="reduce")
    page = context.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))

    open_challenge(page)
    page.locator("#btn-shuffle").click()
    page.wait_for_timeout(250)
    assert page.evaluate("hasUsedShuffle")
    assert page.locator('.card[data-location="pile"]:not(.blocked)').count() >= 4

    shuffled_solution = page.evaluate(
        "allCards.filter((card) => card.status === 'pile').sort((a, b) => a.solutionRank - b.solutionRank).map((card) => card.id)"
    )
    for card_id in shuffled_solution:
        page.locator(f"#{card_id}").click()
        page.wait_for_function("!isResolving", timeout=1500)

    page.locator("#modal[open]").wait_for(timeout=2000)
    assert page.locator("#modal-title").inner_text() == "婷婷支棱住了"
    assert page.locator('.card[data-location="pile"]').count() == 0
    assert page.locator('.card[data-location="slot"]').count() == 0
    page.screenshot(path=OUTPUT / "release-win-390x844.png")
    assert not errors, errors
    context.close()


def verify_share_bundle(browser) -> None:
    context = browser.new_context(viewport={"width": 390, "height": 844}, reduced_motion="reduce")
    page = context.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(SHARE_URL, wait_until="load")
    page.evaluate("localStorage.setItem('zlt-tutorial-v1', '1')")
    if page.locator("#modal").is_visible():
        page.locator("#modal-primary").click()
    assert page.evaluate("[...document.scripts].every((script) => !script.src)")
    page.locator("#btn-start-game").click()
    page.wait_for_timeout(200)
    page.evaluate("startStage(1)")
    page.wait_for_timeout(200)
    assert page.locator('.card[data-location="pile"]').count() == 126
    assert page.locator('.card[data-location="pile"]:not(.blocked)').count() == 7
    page.screenshot(path=OUTPUT / "release-share-390x844.png")
    assert not errors, errors
    context.close()


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        try:
            browser = playwright.chromium.launch(channel="chrome", headless=True)
        except Exception:
            browser = playwright.chromium.launch(headless=True)
        verify_viewport(browser, 320, 568, "320x568")
        verify_viewport(browser, 390, 844, "390x844")
        verify_viewport(browser, 844, 390, "844x390")
        verify_witness_and_tools(browser)
        verify_share_bundle(browser)
        browser.close()
    print("Browser smoke checks passed")


if __name__ == "__main__":
    main()
