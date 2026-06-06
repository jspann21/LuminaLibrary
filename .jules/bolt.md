## 2026-06-06 - [N+1 DB Query Optimization in Library Search]
**Learning:** Found an N+1 query pattern where fetching library books and hidden books was performing multiple JOINs combined with 'GROUP BY b.id' which created performance bottlenecks. We could push the grouped distinct values down into scalar subqueries on the SELECT clause which was significantly faster.
**Action:** Replace JOIN + GROUP BY combinations with scalar subqueries using '(SELECT COALESCE(group_concat(DISTINCT ...)))' in SQLite when fetching wide lists.
