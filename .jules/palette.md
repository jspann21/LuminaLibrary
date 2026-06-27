## 2024-05-24 - Disabled cursor feedback with tooltips
**Learning:** Applying pointer-events-none prevents an element from receiving mouse events, which intrinsically breaks cursor-not-allowed hover states. Removing it can break wrapper elements (like tooltips) that need to catch mouse events.
**Action:** Keep pointer-events-none on the disabled element and apply cursor-not-allowed conditionally to its wrapper element.
