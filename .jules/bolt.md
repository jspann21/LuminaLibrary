## 2024-06-11 - Database Early Aggregation
**Learning:** Found correlated subqueries causing full table scan bottlenecks in `src-tauri/src/library/db.rs`. Queries aggregating counts directly in the SELECT clause run thousands of times during full-table operations like dedup and bulk updates.
**Action:** Replace `(SELECT COUNT(*) FROM... WHERE book_id = b.id)` with early aggregation: `LEFT JOIN (SELECT book_id, COUNT(*) as file_count FROM ... GROUP BY book_id) bf ON bf.book_id = b.id` when selecting from all books.
