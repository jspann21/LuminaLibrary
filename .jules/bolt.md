## 2024-06-18 - Avoid Correlated Subqueries in SQLite `SELECT` for Paged Data
**Learning:** Correlated subqueries like `group_concat` or `COUNT()` placed directly in a `SELECT` clause before a `LIMIT` / `OFFSET` evaluate for all rows matching the `WHERE` condition, leading to an N+1 performance bottleneck.
**Action:** Use a Common Table Expression (CTE) to apply the `WHERE`, `ORDER BY`, `LIMIT`, and `OFFSET` clauses first, then evaluate the correlated subqueries in the outer `SELECT` against only the limited subset of rows.
## 2024-06-18 - Avoid Correlated Subqueries Before Limits
**Learning:** In SQLite, placing correlated scalar subqueries like `COUNT(DISTINCT bf.file_id)` in the SELECT clause before a LIMIT operation evaluates the subquery for all candidate rows (N+1 bottleneck) instead of just the limited subset.
**Action:** Use a Common Table Expression (CTE) to apply the WHERE, ORDER BY, and LIMIT operations first, and then join and calculate correlated queries in the outer SELECT on only the reduced rows.
