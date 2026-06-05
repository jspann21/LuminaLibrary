## 2025-02-14 - Fix Potential SQL Injection in Dynamic DB Queries
**Vulnerability:** SQL Injection in SQLite parameter retrieval logic.
**Learning:** The Rust logic for getting specific fields from the books table used dynamic string interpolation (`format!("SELECT {field_name} FROM books ...")`) rather than SQL binding. The `field_name` could potentially be manipulated by an attacker depending on upstream processing, which could cause unwanted SQL execution.
**Prevention:** Avoid dynamic column name interpolation in SQL whenever possible. If it must be done, implement a strict enum or string match allowlist for safety to prevent arbitrary column lookups.
