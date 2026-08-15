
## 2023-10-27 - Escape Key Stack Ownership
**Learning:** `BookDetailsPanel` remains mounted beneath other modals (`ConfirmDialog`, `CoverPickerModal`, etc.). Adding a global `Escape` key handler to a background panel causes it to intercept `Escape` presses intended for topmost dialogs, incorrectly closing the underlying panel or canceling edits.
**Action:** Escape ownership needs to be centralized across the overlay stack before adding shortcuts to background panels. Avoid adding global keydown handlers for `Escape` on components that can have other modals mounted on top of them.
