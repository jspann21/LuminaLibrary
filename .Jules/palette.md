## 2024-05-23 - Accessibility improvements for labels
**Learning:** Many form inputs in the app were missing `id` and `htmlFor` attributes connecting them to their corresponding `label` elements. The inputs also weren't wrapped in the label tags.
**Action:** Always verify that every `label` has a `htmlFor` property that corresponds to an `id` on the target `input`, `textarea`, or `select` element to ensure screen readers can announce the input purpose.
