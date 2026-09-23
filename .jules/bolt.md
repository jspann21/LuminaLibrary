## 2026-09-23 - SQLite Early Aggregation vs Correlated Subqueries
**Learning:** Correlated scalar subqueries (e.g. `SELECT (SELECT COUNT(...) FROM...) FROM main_table`) trigger N+1 execution bottlenecks during full table operations.
**Action:** Use early aggregation via a derived table (e.g., `LEFT JOIN (SELECT id, COUNT(*) FROM ... GROUP BY id)`) for fast bulk query processing across large datasets.
