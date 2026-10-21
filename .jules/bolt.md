
## $(date +%Y-%m-%d) - Optimize COUNT(DISTINCT) on UNIQUE columns
**Learning:** In SQLite, `COUNT(DISTINCT column)` on a column that already has a `UNIQUE` constraint incurs unnecessary performance overhead because SQLite builds a temporary B-Tree for deduplication. In cases where the column is part of an index, `COUNT(*)` can often utilize a covering index scan, whereas `COUNT(DISTINCT)` forces full row lookups.
**Action:** Always substitute `COUNT(DISTINCT)` with `COUNT(*)` when querying columns that are guaranteed unique (e.g. by unique constraints or primary keys) for measurable performance gains, such as utilizing covering index scans and avoiding temporary B-Trees.
