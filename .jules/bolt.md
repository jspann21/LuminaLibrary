## 2026-09-30 - Avoid Correlated Scalar Subqueries in Unpaginated Full-Table Scans
**Learning:** In SQLite, unpaginated full-table scans containing correlated scalar subqueries in the SELECT clause (like `EXISTS(SELECT...)` or `(SELECT COUNT(*)...)`) cause severe N+1 execution bottlenecks. The engine executes the subquery for every single row scanned.
**Action:** Use early aggregation via derived tables (`LEFT JOIN (SELECT id, COUNT(*) FROM ... GROUP BY id)`) to allow SQLite to materialize the aggregates once and merge them efficiently using temporary B-trees.
