## 2024-03-24 - Focus Rings

**Learning:** Tailwind CSS classes for focus rings often require offsets to be properly visible against both light and dark backgrounds. A standard focus ring without `focus-visible:ring-offset-2` can blend into the background, making keyboard navigation difficult. This project uses `dark:focus-visible:ring-offset-slate-900` or `800` to manage dark mode contrast.
**Action:** Always ensure that when implementing custom interactive elements, the full suite of offset classes (`focus-visible:ring-offset-2`, `focus-visible:ring-offset-white`, and the corresponding dark variant) is included, and consolidate these into shared class variables when possible to prevent inline drift.
