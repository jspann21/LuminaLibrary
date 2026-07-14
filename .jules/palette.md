## 2024-07-14 - Tooltips for Disabled Buttons
**Learning:** Native `<button disabled>` elements swallow pointer events like hover, which prevents CSS tooltips (like the native `title` attribute) and `cursor-not-allowed` styles from activating on them.
**Action:** Wrap disabled buttons in a container (e.g., `<span>`) that applies the tooltip and cursor styles. Apply `disabled:pointer-events-none` to the button itself so the hover events successfully propagate to the parent wrapper.
