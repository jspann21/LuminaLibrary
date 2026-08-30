## 2024-05-18 - Avoid areSetsEqual complexity
**Learning:** In `VirtualizedLibraryBooks`, there is a custom equality check `areSetsEqual` for checking `selectedBookIds` prop. Since the parent component (`LibraryView`) uses a Zustand store (often immutable references), it is highly probable that `selectedBookIds` triggers re-renders anyway, or we can simply replace it with simpler checks or keep `useVirtualizer` logic clean.
**Action:** Profile `VirtualizedLibraryBooks` to ensure memoization is actually working, or just refine.

## 2024-05-18 - SQLite Subquery vs LEFT JOIN GROUP BY
**Learning:** In SQLite, when querying without pagination (or within a limited CTE), replacing `LEFT JOIN` + `GROUP BY` aggregations (e.g., `COUNT(DISTINCT)`) with correlated scalar subqueries in the `SELECT` clause (e.g., `(SELECT COUNT(DISTINCT file_id) FROM book_files WHERE book_id = b.id)`) avoids building and sorting a massive intermediate result set in memory, utilizing fast index lookups instead.
**Action:** Apply this optimization to `consolidate_duplicate_books` and `find_best_match` where aggregations are causing full table scans + sorts on large tables.
