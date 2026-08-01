## YYYY-MM-DD - Initial Explore
**Learning:** Found several input fields without explicit `aria-label` or missing `htmlFor` association, such as in `LibraryHeader.tsx` and `UnresolvedFilesSection.tsx`. We will improve the accessibility of one of them.
**Action:** Enhance accessibility by properly associating labels and adding clear focus states.
## 2024-05-18 - Tooltips for Disabled States
**Learning:** We often disable buttons (like "Match All" when there are no unresolved files), but without a tooltip, users might not understand *why* the button is disabled, leading to frustration. By wrapping the disabled button in a span with a title attribute, we can provide immediate, contextual help. Also applying pointer-events-none on the button ensures the wrapper catches the hover.
**Action:** Always add a descriptive `title` tooltip wrapper around buttons that can be conditionally disabled to explain the reason to the user.
