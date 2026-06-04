## 2024-06-04 - SQLite Dynamic Column Name Injection
**Vulnerability:** SQL injection vulnerability in dynamic column name interpolation (`format!("SELECT {field_name} FROM books ...")`) in `get_book_field`, `get_book_i64_field`, and `get_book_field_value_for_lock`.
**Learning:** Rust's `format!` macro for SQL queries allows injection if the interpolated variable (`field_name`) isn't validated. Column names can't be parameterized in standard SQLite, leading to developers occasionally interpolating them directly.
**Prevention:** Implement strict string validation (e.g., `field_name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')`) before injecting dynamic values like column names or table names into raw SQL strings.
