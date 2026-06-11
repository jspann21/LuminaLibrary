## 2025-06-11 - Adding Keyboard Shortcut Hints

**Learning:** When creating visual keyboard shortcut hints using `<kbd>` tags inside input containers, it's important to use `pointer-events-none` to prevent them from interfering with user clicks meant for the input. Using `hidden sm:flex` is also crucial to avoid cluttering the UI on small screens where keyboard shortcuts are irrelevant. Hardcoding "Ctrl" is acceptable given Lumina's Windows desktop app focus.

**Action:** Always add `pointer-events-none` to absolute-positioned UI overlays within inputs, consider responsive visibility for keyboard hints, and stick to Windows-specific key conventions.
