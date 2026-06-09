## 2025-02-28 - SQLite FTS5 Match Query Injection

**Vulnerability:** The SQLite FTS5 MATCH query allows unescaped terms to be passed from the user's search string. For example, keywords like "NEAR", "AND", "OR", etc. could cause an unintended FTS5 operator to be used, and syntax combinations like unquoted punctuation marks caused the entire SQLite query to crash when the user provided malformed queries.
**Learning:** Raw string split parameters separated by "AND" and using "*" prefix are not robust for user inputs since FTS5 features a complex operator syntax. When these tokens are converted to `token*`, SQLite parses them as expressions which may result in FTS syntax error exceptions at runtime, denying service.
**Prevention:** Always wrap arbitrary text search tokens in double quotes `"{term}"*` to force SQLite FTS5 parser to treat them strictly as string literals prefix matches, avoiding keyword conflicts or syntax errors.
