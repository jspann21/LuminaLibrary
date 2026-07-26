## 2024-12-05 - Modal Keyboard Accessibility

**Learning:** Modals require native keyboard support (Escape to close, Enter to submit) to be usable and accessible without a mouse. Wrapping inputs in a `<form>` and linking it to a `type="submit"` button is the cleanest way to support Enter-to-submit behavior without needing custom keydown event listeners on every input field.

**Action:** When creating or modifying modals and form-like dialogs, always ensure an `Escape` key listener is present to trigger the close action, provide `role="dialog"` attributes, and use a `<form>` wrapper for inputs.
