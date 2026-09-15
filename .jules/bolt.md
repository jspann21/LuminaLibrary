## 2023-10-27 - SQLite N+1 bottlenecks on full table scans
**Learning:** Using correlated scalar subqueries (e.g. `(SELECT COUNT(*) FROM...)`) in the `SELECT` clause for unpaginated queries causes severe N+1 execution bottlenecks.
**Action:** Replace them with early aggregation via a derived table (`LEFT JOIN (SELECT id, COUNT(*) FROM ... GROUP BY id)`) which calculates the aggregate once and then joins it, making it much faster on N>2000 datasets.
