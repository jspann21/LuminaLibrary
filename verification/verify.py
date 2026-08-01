from playwright.sync_api import sync_playwright
import time

def verify():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto("file:///app/verification/index.html")

        # Start recording trace if needed, wait for load
        page.wait_for_load_state('networkidle')

        # Hover to trigger the tooltip. force=True is needed because the button is technically inside, but the span catches the hover.
        page.locator('span[title]').hover(force=True)
        time.sleep(1) # Give time for native tooltip
        page.screenshot(path="/app/verification/tooltip.png")

        browser.close()

if __name__ == "__main__":
    verify()
