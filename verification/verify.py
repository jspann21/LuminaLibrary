from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto("file:///app/verification/test.html")
    page.wait_for_timeout(1000)
    page.screenshot(path="/home/jules/verification/screenshot.png")

    # Hover over Match All button wrapper
    page.locator("span[title='No unresolved files to match']").hover(force=True)
    page.wait_for_timeout(500)
    page.screenshot(path="/home/jules/verification/match_all_hover.png")

    # Hover over Approve Match button wrapper
    page.locator("span[title='Select a candidate to approve']").hover(force=True)
    page.wait_for_timeout(500)
    page.screenshot(path="/home/jules/verification/approve_match_hover.png")

    browser.close()
