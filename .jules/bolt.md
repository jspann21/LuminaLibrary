## 2024-05-24 - O(N) array iteration in selection memoization
**Learning:** In `useLibraryAppController`, `selectedLibraryBookIdSet` iterated over all `books` (O(N)) every time the selection changed. This meant that checking a single book box in a 10,000 book library caused an unnecessary O(N) loop just to intersect the sets.
**Action:** Split the memoization: create one `visibleBookIds` Set that memoizes strictly against `books`, and a separate `selectedLibraryBookIdSet` that intersects `selectedLibraryBookIds` with `visibleBookIds` in O(K) time where K is the number of selected items.
