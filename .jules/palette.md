## 2024-08-16 - Prevent overlapping modal closures on Escape key
**Learning:** When creating global `keydown` event listeners for modal or overlay interactions (such as pressing `Escape` to close), multiple modals open at the same time (like ConfirmDialog over CoverPickerModal) can close simultaneously if `event.defaultPrevented` is not checked.
**Action:** Always check `if (event.defaultPrevented) return` at the beginning of global `keydown` event listeners for `Escape` to prevent nested or overlapping UI elements from being closed simultaneously.
