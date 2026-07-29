## 2024-05-18 - Adding Form Semantics to Modals
**Learning:** Relying on custom 'Enter' keydown listeners for forms is less robust and less accessible than simply converting the wrapper div into a standard HTML `<form>` tag with `onSubmit`.
**Action:** Use native `<form>` semantics with `onSubmit` combined with a `type="submit"` button for inputs in modals. This ensures native browser affordances work flawlessly without custom keydown logic, improving accessibility.
