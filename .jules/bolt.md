## 2024-09-07 - Optimize get_library_tags with CTE
**Learning:** In SQLite, when calculating aggregations on large tables (like counting books per tag), pushing the GROUP BY into a subquery/derived table before joining (early aggregation) is essential.
**Action:** Always refactor LEFT JOIN + GROUP BY queries into CTEs with early aggregation for faster query execution.
