## $(date +%Y-%m-%d) - SQLite: Drive highly selective queries from relationship tables

**Learning:** When trying to filter a parent table based on a highly selective condition in a related table (e.g., finding books associated with a specific folder ID being deleted), starting the query with a full scan of the parent table (`SELECT ... FROM books b`) and applying correlated `EXISTS` subqueries is an anti-pattern. This forces SQLite to execute the subquery for every single row in the parent table (O(N)), which scales poorly.

**Action:** Drive the query directly from the filtered relationship tables (`SELECT ... FROM book_files bf JOIN files f ... WHERE f.folder_id = ?1`), and apply any negative checks (`NOT EXISTS`) only to the much smaller resulting subset. This allows SQLite to use indexes on the selective condition to jump directly to the relevant rows, dramatically speeding up the query (e.g., ~136ms vs ~44ms on 100k books).
