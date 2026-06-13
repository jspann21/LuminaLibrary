## 2024-05-24 - [SQLite N+1 Pagination Bottleneck]
**Learning:** Avoid placing correlated scalar subqueries (like `group_concat`, `COUNT()`) directly in the main `SELECT` clause when paginating or sorting, as they evaluate before the `LIMIT`, causing an N+1 performance bottleneck on large libraries.
**Action:** Always refactor these queries by using a CTE to apply the `WHERE`, `ORDER BY`, `LIMIT`, and `OFFSET` onto the base table first, then evaluate the correlated subqueries in the outer `SELECT` against the limited CTE rows.
