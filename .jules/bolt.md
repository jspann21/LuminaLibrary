## 2025-01-20 - Optimize many-to-many relationship counts
**Learning:** In SQLite, when querying `GROUP BY` across multiple joined tables for large datasets (e.g. tags mapped to books), post-join grouping causes significant memory expansion and slow sorting for the intermediate result set.
**Action:** Push the `GROUP BY` aggregation into a subquery/CTE (early aggregation) before joining it with the main table. This prevents building the large intermediate result set.
