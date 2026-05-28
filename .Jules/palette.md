## 2024-05-28 - OS-specific Keyboard Shortcuts
**Learning:** Adding `Ctrl+F` shortcut hints works well visually, but users on macOS might expect `⌘` (Cmd).
**Action:** When adding keyboard shortcut hints in the future, consider dynamically rendering the correct modifier key based on the user's OS, or verify if the app is strictly Windows-only (as memory indicates this is a "Windows desktop app", `Ctrl` is appropriate here).
