## 2024-06-29 - Disabled Tooltip Cursors
**Learning:** In Tailwind, applying `pointer-events-none` natively prevents an element from receiving mouse events, meaning `cursor-not-allowed` on the button itself will have no effect. Removing `pointer-events-none` isn't always viable as it may break surrounding elements.
**Action:** To display a disabled cursor alongside a tooltip, keep `pointer-events-none` on the disabled button and conditionally apply `cursor-not-allowed` to the wrapper element that handles the tooltip.
