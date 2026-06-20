
## 2024-05-24 - N+1 Issue Avoidance during Search with COUNT in SQLite
**Learning:** SQLite processes correlated subqueries or aggregations with joins (like `COUNT()`) in the outer `SELECT` clause before applying outer `LIMIT`. Using `COUNT` combined with `LIMIT` on a large result set scans and counts more rows than necessary if joined directly on the base table.
**Action:** Always refactor queries containing `LIMIT` and correlated counts to use a Common Table Expression (CTE) which applies the `WHERE` filter and the `LIMIT` on the base table first, then joins/counts on the limited subquery.
