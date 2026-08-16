## 2024-08-16 - Deferred Join Pagination in Unresolved Files Query
**Learning:** SQLite may compute heavy LEFT JOINs for the entire table before applying a LIMIT clause if the joins are included in the main SELECT block alongside the LIMIT.
**Action:** Apply LIMIT and OFFSET inside a CTE on the base table first, then join peripheral tables (like library_folders and enrichment_jobs) outside the CTE so they only evaluate for the paginated rows.
