## 2024-05-24 - SSRF vulnerability in metadata fetching
**Vulnerability:** Found an SSRF vulnerability where the application verified that user-provided cover URLs belonged to a trusted domain using `.contains()` instead of proper URL parsing (`url.contains("books.google.")`). This allows an attacker to bypass domain restrictions (e.g. `http://attacker.com/?books.google.`).
**Learning:** Checking for substrings in URLs is unsafe for enforcing domain constraints, as subdomains, paths, or query parameters can be crafted to bypass these naive checks.
**Prevention:** Always use a proper URL parsing library (like `url::Url` in Rust) and explicitly check the parsed `host()` and `path()` when enforcing origin restrictions.
