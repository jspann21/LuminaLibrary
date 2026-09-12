## 2025-01-20 - Avoid repository pollution with benchmark scripts
**Learning:** Checking in temporary test scripts and binary dummy databases (like `benchmark.py` and `test.db`) during development is considered a blocking issue for merges as it pollutes the repository.
**Action:** Always place temporary testing artifacts in `/tmp/` and clean them up before requesting code review or submitting changes.
