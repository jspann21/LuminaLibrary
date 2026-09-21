## 2024-05-24 - SQLite N+1 during Full Table Scans
**Learning:** Using correlated scalar subqueries (like `(SELECT COUNT(*) FROM table WHERE id = main.id)`) inside the SELECT clause of a full table scan query in SQLite acts as a hidden N+1 loop, severely impacting performance for large datasets.
**Action:** Always rewrite full-table aggregations to use derived tables with early aggregation (`LEFT JOIN (SELECT id, COUNT(*) FROM table GROUP BY id)`). Do not replace early aggregations with scalar subqueries.
