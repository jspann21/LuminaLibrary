## 2024-07-06 - Safe Disabled Cursors with Tooltips
**Learning:** In Tailwind CSS, applying `pointer-events-none` to a disabled element (often done to disable hover states or interactions) intrinsically breaks the `cursor-not-allowed` style because the element no longer receives mouse events.
**Action:** To display a disabled cursor while preserving a tooltip and safely disabling interactions, keep `pointer-events-none` on the disabled button element, and apply `cursor-not-allowed` conditionally on its parent wrapper (e.g. `className={cx('flex', isDisabled && 'cursor-not-allowed')}`).
