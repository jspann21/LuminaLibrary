## 2024-05-15 - Missing Native Form Submit on Modals
**Learning:** React dialogs and modals using plain `<div role="dialog">` for forms miss native HTML form features like hitting "Enter" to submit.
**Action:** Always wrap the modal's input elements within a `<form onSubmit={...}>` and use an explicit submit button so users can intuitively press Enter to save/submit forms without needing custom keyboard event listeners for every single field.

## 2024-05-15 - Missing Tooltips for Disabled States
**Learning:** In Tailwind CSS, applying `pointer-events-none` prevents an element from receiving mouse events, which intrinsically breaks `cursor-not-allowed` hover states and tooltip rendering via the `title` attribute.
**Action:** To safely display a disabled cursor with a tooltip, keep `pointer-events-none` on the disabled button element and apply `cursor-not-allowed` conditionally (along with the `title` attribute) to a wrapper element (e.g. `<span className={cx('inline-flex', isDisabled && 'cursor-not-allowed')} title={...}>`).

## 2024-05-15 - Focus Visibility For Keyboard Navigation on Disabled Elements
**Learning:** Adding `disabled:pointer-events-none` removes pointer events, but when paired with `disabled:opacity-50`, it can sometimes leave the focus state unclear if a user tabs to a disabled button. Wait, `pointer-events-none` does not affect keyboard focus. Actually, standard HTML `disabled` attribute inherently prevents focus. But some custom interactive elements use `aria-disabled` instead.
**Action:** Ensure native `disabled` attribute is used on `<button>` elements to properly remove them from the tab order.
