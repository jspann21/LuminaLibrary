## 2024-03-24 - Interactive Disabled State
**Learning:** Adding `disabled:cursor-not-allowed` natively on buttons with `pointer-events-none` prevents the cursor from changing properly on the button itself. Wrapping it in a `span` or keeping `pointer-events-none` on the element handles the click, but applying `cursor-not-allowed` on the parent is often cleaner for UX when using tailwind. However, for visual polish and accessibility, maintaining `focus-visible` on interactive elements is crucial for keyboard navigation.
**Action:** Ensure all interactive buttons have `focus-visible` styles.
