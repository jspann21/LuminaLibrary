## 2024-05-24 - Add Title Tooltips to Truncated Text
**Learning:** Text truncation (`truncate`, `line-clamp`) is commonly used in grid/list views to keep UI uniform, but it prevents users from seeing the full content (especially long book titles, authors, or paths) unless they open a detail view.
**Action:** Always add an HTML `title` attribute with the full text value to any element that uses Tailwind's `truncate` or `line-clamp` utilities to ensure accessibility and provide a native tooltip on hover.
