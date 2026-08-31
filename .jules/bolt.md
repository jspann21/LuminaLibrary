
## 2024-08-31 - Refactoring GROUP BY to Correlated Scalar Subqueries
**Learning:** In SQLite, queries using `JOIN` and `GROUP BY` aggregations like `COUNT()` can cause large intermediate result sets to be built and sorted in memory. Replacing them with correlated scalar subqueries in the `SELECT` clause avoids this bottleneck and leverages fast index lookups.
**Action:** When optimizing SQLite queries without pagination, replace `LEFT JOIN` or `JOIN` + `GROUP BY` aggregations with correlated scalar subqueries in the `SELECT` clause, optionally wrapped in an outer query if filtering on the aggregated result is needed.
