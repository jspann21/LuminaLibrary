## 2024-08-24 - Escape key for modals
**Learning:** Users expect large modals and detail panels to close when pressing the Escape key, but this is sometimes forgotten when migrating or building complex panels without a dialog primitive.
**Action:** Always add a global keydown event listener for Escape that respects `event.defaultPrevented` to close large overlay panels.
