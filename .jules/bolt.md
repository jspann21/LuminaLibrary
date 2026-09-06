## 2025-02-09 - SQLite Correlated Subquery Optimization
**Learning:** In SQLite, when querying without pagination (or within a limited CTE), replace `LEFT JOIN` + `GROUP BY` aggregations (e.g., `COUNT(DISTINCT)`) with correlated scalar subqueries in the `SELECT` clause. This avoids building and sorting a massive intermediate result set in memory, utilizing fast index lookups instead.
**Action:** Always prefer correlated scalar subqueries over post-join grouping for 1:N aggregations on large datasets, unless early aggregation (pre-join grouping) is feasible.
