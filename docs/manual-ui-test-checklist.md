# Lumina UI Manual Verification Checklist

## Setup
1. Run `pnpm tauri:dev`.
2. Ensure at least one library source is added with PDF/EPUB files.

## 1. Theme and accent persistence
1. Open `Settings`.
2. Switch theme between `Light`, `Dark`, `System`.
3. Change accent color.
4. Restart app and verify chosen theme/accent persist.

## 2. Sidebar metrics
1. Confirm bottom-left card shows `Total Books` count.
2. Trigger scan (`Add Books` or folder `Scan` action).
3. Verify status changes from `System Idle` to scanning state and back.

## 3. Tag lifecycle
1. Open a book details drawer.
2. Enter edit mode and add tag `Sci-Fi`.
3. Save, reopen, add `sci-fi`.
4. Verify a single canonical tag is shown/counts once.

## 4. Tag filtering
1. Click a sidebar tag.
2. Verify library list/grid filters to tagged books only.
3. Click the same tag again to clear filter.
4. Verify search + format filter still combine correctly with tag filter.

## 5. Details drawer behavior
1. Click a book cover/card.
2. Verify right-side drawer opens and background is blurred.
3. Verify closing by backdrop click and close button.
4. Enter edit mode, change metadata fields, save, and verify persistence.

## 6. Drawer action buttons
1. In drawer, click `Rescan Metadata` and verify metadata refresh occurs.
2. Click `Open File` and verify the primary file opens from disk.
3. Click `Delete`, confirm prompt, and verify book is removed from library view.

## 7. Delete transition integrity
1. After deleting a book, go to `Settings` -> `Metadata`.
2. Verify deleted book file appears in unresolved/discovered list.
3. Verify file status can be matched again.

## 8. Unresolved workflow in settings
1. Use unresolved search box.
2. Edit title/author/isbn guesses.
3. Click `Match` and verify results update.
4. Verify CSV export/import buttons work.

## 9. Sorting and views
1. Toggle between grid and list views.
2. Cycle sort options (`Date`, `Title`, `Author`) and verify ordering changes.

## 10. Migration safety smoke test
1. Start app with existing DB.
2. Verify app boots without schema errors.
3. Verify books remain accessible and editable after startup.

## 11. Google Books API key settings
1. Open `Settings` -> `Integrations`.
2. Enter a test API key and click `Save Key`.
3. Click `Test Key` and verify success/failure feedback appears.
4. Verify status changes to `Key configured` and no raw key is displayed.
5. Restart app and verify key status persists.
6. Click `Clear Key`, confirm prompt, and verify status returns to `No key configured` unless env fallback is active.
