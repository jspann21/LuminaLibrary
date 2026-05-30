## 2024-06-25 - Replace mapping over characters with Regex

**Learning:** Array manipulation pipelines (split, map, join) are disproportionately slow in JavaScript when processing strings for individual character checking. V8's regex engine is highly optimized for contiguous character sets like control characters \`[\\x00-\\x1F\\x7F]\` combined with whitespace \`\\s+\` . Doing it in a single pass is ~3x faster.
**Action:** When filtering out or normalizing characters in a string, always prefer a single well-crafted regular expression over array manipulations like `.split('').map(...).join('')`.
