## 2024-06-12 - Prevent O(N) re-renders in virtualized lists with bulk state toggles
**Learning:** Passing a global boolean state (like `selectionModeActive`) to every item in a large virtualized list causes O(N) React re-renders when the state changes, breaking `React.memo` for all visible items.
**Action:** For bulk UI visibility toggles, apply a CSS class to a parent container and use Tailwind CSS descendant selectors (e.g., `[.selection-mode-active_&]:opacity-100`) instead of passing props to children, preserving memoization and keeping changes in the CSS layout engine.
