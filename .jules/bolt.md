## 2024-03-22 - Subquery vs Grouping in CTEs
**Learning:** In `db.rs:2190`, the `get_library_books` query uses correlated scalar subqueries (`SELECT COUNT(...) FROM ...`) inside a `SELECT` statement joining to a `limited_books` CTE. Since the CTE size is already limited (e.g. 50-200 rows via pagination), the `N+1` cost is bounded. Replacing this with derived tables and explicit `GROUP BY` inside the limited subset is an option, but the system instruction says: "Conversely, for single-row lookups or limited CTEs, correlated scalar subqueries can be faster than building massive intermediate result sets." Thus, this query is likely already optimized properly per the instructions.

**Action:** Looking for full table scan operations using scalar subqueries without pagination.

## 2024-03-22 - Full Table Scan Subqueries
**Learning:** Found a full table scan in `db.rs:944` `consolidate_duplicate_books`. It performs `SELECT b.id, ..., EXISTS(SELECT 1 FROM manual_overrides mo WHERE mo.book_id = b.id) AS has_manual_overrides, (SELECT COUNT(*) FROM book_files bf WHERE bf.book_id = b.id) AS file_count FROM books b`. This is a classic N+1 problem for SQLite because it executes the subquery for every row in the unpaginated table.
**Action:** Replace `consolidate_duplicate_books` scalar subqueries with early aggregation (`LEFT JOIN`).
## 2024-03-22 - Full Table Scan Subqueries in `find_book_by_title_author_conn`
**Learning:** Found a full table scan query without early aggregation in `db.rs:1340` inside the `else` branch of `find_book_by_title_author_conn`. When `total_books < 2000`, the query executes `SELECT b.id, b.title, b.authors_json, (SELECT COUNT(*) FROM book_files bf WHERE bf.book_id = b.id) AS file_count FROM books b`. This is a correlated scalar subquery executing on the entire `books` table, causing an N+1 issue for smaller libraries which might feel sluggish.
**Action:** Replace this with early aggregation using a `LEFT JOIN (SELECT book_id, COUNT(*) as file_count FROM book_files GROUP BY book_id)`.
