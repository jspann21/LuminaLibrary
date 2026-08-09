## 2025-08-01 - [Avoid correlated subqueries in list_books]
## 2025-08-01 - [Avoid correlated subqueries in list_books]
**Learning:** SQLite correlated subqueries in the SELECT clause (e.g., COUNT(), group_concat()) evaluate on the full result set before LIMIT/OFFSET are applied, causing N+1 performance bottlenecks for large lists.
**Action:** Use a CTE to evaluate WHERE, ORDER BY, LIMIT, and OFFSET first, then select from the limited rows and apply correlated subqueries.
## 2025-08-01 - [Avoid arbitrary limits on unfiltered subqueries]
**Learning:** Adding an unconditional LIMIT to an unfiltered/unordered subquery (CTE) can arbitrarily hide valid records, causing incomplete matching and duplicate creations.
**Action:** Only apply LIMIT optimizations to queries that are properly ordered or filtered to ensure the necessary records are always retained, such as using a relevance-ordered prefilter.
