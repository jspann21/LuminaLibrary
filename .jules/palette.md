## 2023-10-24 - Inline Keyboard Shortcut Discoverability
**Learning:** Hardcoded keyboard shortcuts (like Ctrl+F for search) in background event listeners are completely invisible to users, reducing feature usage.
**Action:** When a global or component-specific keyboard shortcut exists, always surface it visually within the target UI element itself (e.g., using small `<kbd>` tags inside search inputs) to improve discoverability without adding clutter.
