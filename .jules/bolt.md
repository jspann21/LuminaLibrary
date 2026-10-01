
## 2024-05-18 - Avoid Correlated Subqueries on Full Table Scans in SQLite
**Learning:** In SQLite, when executing full-table scans or operating on large intermediate result sets, using correlated scalar subqueries (like `(SELECT COUNT(*) FROM... WHERE id = parent.id)`) introduces a severe N+1 execution bottleneck. Our benchmarks showed a query with these dropping from ~73 seconds down to ~0.3 seconds simply by rewriting the queries to use Early Aggregation via derived tables (`LEFT JOIN (SELECT parent_id, COUNT(*) GROUP BY parent_id)`).
**Action:** Always prefer early aggregation/derived tables when fetching computed relationship data across a large number of rows.
