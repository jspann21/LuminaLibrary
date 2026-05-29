## 2026-05-29 - Add aria-labels to unlabeled inputs
**Learning:** Screen reader users need context when traversing data tables or complex modals with inputs that do not have an associated `<label>` element. Using `aria-label` with dynamic data (like filename) provides critical context.
**Action:** When adding inline inputs without visible labels, always include a descriptive `aria-label`, leveraging contextual data where appropriate.
