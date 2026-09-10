## 2024-03-24 - Add native form submission to Modals
**Learning:** React dialogs and modals using `form` wrappers with `onSubmit` handlers combined with buttons of `type="submit"` enable native Enter-to-submit behavior, which avoids needing fragile manual `keydown` Enter listeners on every input field. This is an accessibility and usability best practice for form-like dialogs.
**Action:** Always verify if form-like modals can be converted to use `<form>` elements and native submit behaviors.
