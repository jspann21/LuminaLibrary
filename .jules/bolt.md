## 2023-10-27 - Unnecessary DISTINCT in COUNT queries
**Learning:** In SQLite, `COUNT(DISTINCT column)` on a column that already has a `UNIQUE` constraint (like a primary key or explicitly unique column) incurs unnecessary performance overhead because SQLite builds a temporary B-Tree for deduplication. This is especially impactful within correlated subqueries that run per row (like computing file counts for paginated results).
**Action:** Always substitute `COUNT(DISTINCT column)` with `COUNT(*)` when the counted column is known to be unique.
