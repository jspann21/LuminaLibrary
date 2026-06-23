## 2024-05-18 - Avoid pointer-events-none with disabled cursors
**Learning:** In Tailwind CSS, applying `pointer-events-none` (or `disabled:pointer-events-none`) prevents an element from receiving mouse events, which intrinsically breaks `cursor-not-allowed` hover states.
**Action:** To display a disabled cursor, remove `pointer-events-none` and rely on the native HTML `disabled` attribute to prevent clicks.
