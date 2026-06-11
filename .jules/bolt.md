## 2025-06-11 - Optimize SQLite correlated subqueries with subquery limiting
**Learning:** In SQLite, correlated scalar subqueries (like `group_concat` or `COUNT()`) in the `SELECT` clause are evaluated before `LIMIT` and `OFFSET` apply. This causes severe performance degradation on large result sets when paginating or sorting.
**Action:** Always place the sorting and pagination logic into a subquery (`SELECT ... FROM ... ORDER BY ... LIMIT ...`), then select from that subquery (`q`) and evaluate the correlated subqueries on the limited result set (`SELECT q.*, (SELECT ...) FROM (...) q`).
