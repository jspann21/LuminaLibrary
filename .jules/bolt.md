
## 2024-07-04 - Prevent O(N) re-renders in virtualized lists via CSS descendant selectors
**Learning:** In React virtualized lists (like `VirtualizedLibraryBooks`), passing a global boolean state (like `selectionModeActive`) to every child component forces an O(N) re-render for all visible items when that state changes, breaking `React.memo` bailout.
**Action:** Replace the global boolean prop with a CSS class applied to the parent container (e.g., `.selection-active`), and use Tailwind CSS descendant selectors (`[.selection-active_&]:opacity-100`) on the children to toggle visibility visually without triggering React re-renders.
