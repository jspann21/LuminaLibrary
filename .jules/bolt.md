## 2024-10-24 - Avoid COUNT(DISTINCT) on UNIQUE columns in SQLite
**Learning:** In SQLite, using `COUNT(DISTINCT column)` when the column already has a `UNIQUE` constraint forces full row lookups (preventing covering index scans) and builds unnecessary temporary B-Trees for deduplication. This is especially impactful in correlated scalar subqueries executed per-row in paginated results.
**Action:** Always verify schema constraints and substitute `COUNT(DISTINCT)` with `COUNT(*)` on unique columns to enable covering index scans and avoid temporary table overhead.
