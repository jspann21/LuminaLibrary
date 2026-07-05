## 2025-07-05 - Avoid O(N) Re-renders in Virtualized Lists with Global State
**Learning:** Passing a global boolean state (like `selectionModeActive`) to every item in a large virtualized list causes the entire visible list to re-render whenever the state changes (e.g., when selecting the first item).
**Action:** For bulk UI toggles in virtualized lists, apply a conditional CSS class to a parent container and use Tailwind descendant selectors (e.g., `[.parent-class_&]:opacity-100`) to toggle child visibility without triggering React re-renders.
