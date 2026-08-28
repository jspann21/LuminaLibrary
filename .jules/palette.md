## 2024-05-23 - Accessibility & Async Feedback in LibraryView
**Learning:** Explicitly adding `focus-visible` styles ensures keyboard users can track focus. Including a loading spinner (`Loader2`) inside async buttons gives immediate visual feedback.
**Action:** Always add `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-800` to actionable buttons. Use an `inline-flex` container with a spinner for async actions.
