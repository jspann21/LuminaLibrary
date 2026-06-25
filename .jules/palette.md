
## 2025-02-12 - Support disabled tooltips with `cursor-not-allowed`
**Learning:** In Tailwind CSS, setting `pointer-events-none` on a disabled button hides the disabled cursor state and breaks hover triggers. You cannot place tooltips directly on the button.
**Action:** When adding tooltips to a disabled element, wrap the button in a `span` or `div` (e.g., `<span className="flex">`). Keep `pointer-events-none` on the button itself to prevent interaction, but conditionally apply `cursor-not-allowed` to the wrapper (e.g., `className={cx('flex', isDisabled && 'cursor-not-allowed')}`) to show the correct cursor state while allowing the tooltip to catch the hover events.
