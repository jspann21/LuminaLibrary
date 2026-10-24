## 2024-10-24 - Avoid COUNT(DISTINCT) on Unique Columns in SQLite
**Learning:** In SQLite, using `COUNT(DISTINCT column)` on a column that already has a `UNIQUE` constraint incurs unnecessary performance overhead because SQLite builds a temporary B-Tree for deduplication. This was discovered when analyzing the `book_files` table where `file_id` is unique.
**Action:** Always substitute `COUNT(DISTINCT column)` with `COUNT(*)` when the column is guaranteed unique by schema constraints. This allows SQLite to use a faster covering index scan.
