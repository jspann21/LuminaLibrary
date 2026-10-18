## 2023-10-18 - Optimize SQLite COUNT(DISTINCT) for unique columns
**Learning:** In SQLite, `COUNT(DISTINCT column)` on a column that already has a `UNIQUE` constraint incurs unnecessary performance overhead because SQLite builds a temporary B-Tree for deduplication.
**Action:** Always substitute it with `COUNT(*)` in these cases for measurable performance gains, as it can often utilize a covering index scan, whereas `COUNT(DISTINCT)` forces full row lookups.
