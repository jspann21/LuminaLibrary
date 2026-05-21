use tauri::State;

use crate::library::types::{
  ApiKeyTestResult, AppSettings, AppState, BookCard, BookDetail, BookFilters, BookPatch, BulkMatchInput,
  BulkMatchResult, CoverCandidate, DiscoveredFile, ExportResult, FileRecord, FolderRemovalPreview, ImportResult,
  LibraryFolder, LibraryMaintenanceResult, MatchPreview, MatchResult, MetadataFieldSelection, MetadataLockUpdate,
  MetadataRescanPreview, Paged, ScanSummary, SortSpec, TagCount, TagDeleteResult, TagMergeResult,
};

fn to_result<T>(result: anyhow::Result<T>) -> Result<T, String> {
  result.map_err(|err| err.to_string())
}

#[tauri::command]
pub fn add_library_folder(
  state: State<'_, AppState>,
  path: String,
  recursive: Option<bool>,
) -> Result<LibraryFolder, String> {
  to_result(
    state
      .service
      .add_library_folder(path, recursive.unwrap_or(true)),
  )
}

#[tauri::command]
pub fn remove_library_folder(state: State<'_, AppState>, folder_id: String) -> Result<(), String> {
  to_result(state.service.remove_library_folder(folder_id))
}

#[tauri::command]
pub fn get_folder_removal_preview(
  state: State<'_, AppState>,
  folder_id: String,
) -> Result<FolderRemovalPreview, String> {
  to_result(state.service.get_folder_removal_preview(folder_id))
}

#[tauri::command]
pub fn get_library_folders(state: State<'_, AppState>) -> Result<Vec<LibraryFolder>, String> {
  to_result(state.service.get_library_folders())
}

#[tauri::command]
pub fn get_app_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
  to_result(state.service.get_app_settings())
}

#[tauri::command]
pub fn set_scan_on_startup(state: State<'_, AppState>, enabled: bool) -> Result<AppSettings, String> {
  to_result(state.service.set_scan_on_startup(enabled))
}

#[tauri::command]
pub fn set_google_books_api_key(
  state: State<'_, AppState>,
  api_key: String,
) -> Result<AppSettings, String> {
  to_result(state.service.set_google_books_api_key(api_key))
}

#[tauri::command]
pub fn clear_google_books_api_key(state: State<'_, AppState>) -> Result<AppSettings, String> {
  to_result(state.service.clear_google_books_api_key())
}

#[tauri::command]
pub fn test_google_books_api_key(
  state: State<'_, AppState>,
  api_key: Option<String>,
) -> Result<ApiKeyTestResult, String> {
  to_result(state.service.test_google_books_api_key(api_key))
}

#[tauri::command]
pub async fn start_scan(
  state: State<'_, AppState>,
  folder_id: Option<String>,
) -> Result<ScanSummary, String> {
  let service = state.service.clone();
  tauri::async_runtime::spawn_blocking(move || service.start_scan(folder_id))
    .await
    .map_err(|err| format!("scan task join error: {err}"))?
    .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn rescan_missing_metadata(state: State<'_, AppState>) -> Result<ScanSummary, String> {
  let service = state.service.clone();
  tauri::async_runtime::spawn_blocking(move || service.rescan_missing_metadata())
    .await
    .map_err(|err| format!("metadata rescan task join error: {err}"))?
    .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn refresh_missing_covers(state: State<'_, AppState>) -> Result<ScanSummary, String> {
  let service = state.service.clone();
  tauri::async_runtime::spawn_blocking(move || service.refresh_missing_covers())
    .await
    .map_err(|err| format!("cover refresh task join error: {err}"))?
    .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn get_library_books(
  state: State<'_, AppState>,
  query: Option<String>,
  filters: Option<BookFilters>,
  sort: Option<SortSpec>,
  page: Option<u32>,
  page_size: Option<u32>,
) -> Result<Paged<BookCard>, String> {
  to_result(
    state
      .service
      .get_library_books(query, filters, sort, page, page_size),
  )
}

#[tauri::command]
pub async fn cache_book_covers(state: State<'_, AppState>, book_ids: Vec<String>) -> Result<u32, String> {
  let service = state.service.clone();
  tauri::async_runtime::spawn_blocking(move || service.cache_book_covers(book_ids))
    .await
    .map_err(|err| format!("cover cache task join error: {err}"))?
    .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn get_hidden_books(
  state: State<'_, AppState>,
  query: Option<String>,
  page: Option<u32>,
  page_size: Option<u32>,
) -> Result<Paged<BookCard>, String> {
  to_result(state.service.get_hidden_books(query, page, page_size))
}

#[tauri::command]
pub fn get_book_detail(state: State<'_, AppState>, book_id: String) -> Result<BookDetail, String> {
  to_result(state.service.get_book_detail(book_id))
}

#[tauri::command]
pub fn get_discovered_files(
  state: State<'_, AppState>,
  query: Option<String>,
  page: Option<u32>,
  page_size: Option<u32>,
) -> Result<Paged<DiscoveredFile>, String> {
  to_result(state.service.get_discovered_files(query, page, page_size))
}

#[tauri::command]
pub fn attempt_match(
  state: State<'_, AppState>,
  file_id: String,
  isbn: Option<String>,
  title: Option<String>,
  author: Option<String>,
) -> Result<MatchResult, String> {
  to_result(state.service.attempt_match(file_id, isbn, title, author))
}

#[tauri::command]
pub async fn batch_attempt_match(
  state: State<'_, AppState>,
  items: Vec<BulkMatchInput>,
) -> Result<BulkMatchResult, String> {
  let service = state.service.clone();
  tauri::async_runtime::spawn_blocking(move || service.batch_attempt_match(items))
    .await
    .map_err(|err| format!("batch match task join error: {err}"))?
    .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn preview_match(
  state: State<'_, AppState>,
  file_id: String,
  isbn: Option<String>,
  title: Option<String>,
  author: Option<String>,
) -> Result<MatchPreview, String> {
  let service = state.service.clone();
  tauri::async_runtime::spawn_blocking(move || service.preview_match(file_id, isbn, title, author))
    .await
    .map_err(|err| format!("preview match task join error: {err}"))?
    .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn apply_manual_book_edit(
  state: State<'_, AppState>,
  book_id: String,
  patch: BookPatch,
) -> Result<BookDetail, String> {
  to_result(state.service.apply_manual_book_edit(book_id, patch))
}

#[tauri::command]
pub fn create_manual_book(
  state: State<'_, AppState>,
  file_id: String,
  patch: BookPatch,
  tags: Vec<String>,
) -> Result<BookDetail, String> {
  to_result(state.service.create_manual_book(file_id, patch, tags))
}

#[tauri::command]
pub fn mark_file_missing(
  state: State<'_, AppState>,
  file_id: String,
  missing: bool,
) -> Result<(), String> {
  to_result(state.service.mark_file_missing(file_id, missing))
}

#[tauri::command]
pub async fn reconcile_local_files(state: State<'_, AppState>) -> Result<LibraryMaintenanceResult, String> {
  let service = state.service.clone();
  tauri::async_runtime::spawn_blocking(move || service.reconcile_local_files())
    .await
    .map_err(|err| format!("maintenance task join error: {err}"))?
    .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn export_unresolved_csv(state: State<'_, AppState>, path: String) -> Result<ExportResult, String> {
  to_result(state.service.export_unresolved_csv(path))
}

#[tauri::command]
pub async fn import_enrichment_csv(state: State<'_, AppState>, path: String) -> Result<ImportResult, String> {
  let service = state.service.clone();
  tauri::async_runtime::spawn_blocking(move || service.import_enrichment_csv(path))
    .await
    .map_err(|err| format!("csv import task join error: {err}"))?
    .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn rescan_file(state: State<'_, AppState>, file_id: String) -> Result<FileRecord, String> {
  to_result(state.service.rescan_file(file_id))
}

#[tauri::command]
pub async fn preview_rescan_metadata(
  state: State<'_, AppState>,
  book_id: String,
  file_id: String,
) -> Result<MetadataRescanPreview, String> {
  let service = state.service.clone();
  tauri::async_runtime::spawn_blocking(move || service.preview_rescan_metadata(book_id, file_id))
    .await
    .map_err(|err| format!("metadata preview task join error: {err}"))?
    .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn apply_curated_metadata(
  state: State<'_, AppState>,
  book_id: String,
  selection: Vec<MetadataFieldSelection>,
  lock_updates: Vec<MetadataLockUpdate>,
) -> Result<BookDetail, String> {
  to_result(
    state
      .service
      .apply_curated_metadata(book_id, selection, lock_updates),
  )
}

#[tauri::command]
pub fn open_local_file(state: State<'_, AppState>, abs_path: String) -> Result<(), String> {
  to_result(state.service.open_local_file(abs_path))
}

#[tauri::command]
pub fn open_local_file_folder(state: State<'_, AppState>, abs_path: String) -> Result<(), String> {
  to_result(state.service.open_local_file_folder(abs_path))
}

#[tauri::command]
pub fn get_library_tags(state: State<'_, AppState>) -> Result<Vec<TagCount>, String> {
  to_result(state.service.get_library_tags())
}

#[tauri::command]
pub fn set_book_tags(
  state: State<'_, AppState>,
  book_id: String,
  tags: Vec<String>,
) -> Result<BookDetail, String> {
  to_result(state.service.set_book_tags(book_id, tags))
}

#[tauri::command]
pub fn hide_books(state: State<'_, AppState>, book_ids: Vec<String>) -> Result<u64, String> {
  to_result(state.service.hide_books(book_ids))
}

#[tauri::command]
pub fn restore_books(state: State<'_, AppState>, book_ids: Vec<String>) -> Result<u64, String> {
  to_result(state.service.restore_books(book_ids))
}

#[tauri::command]
pub fn merge_tags(
  state: State<'_, AppState>,
  source_tags: Vec<String>,
  target_tag: String,
) -> Result<TagMergeResult, String> {
  to_result(state.service.merge_tags(source_tags, target_tag))
}

#[tauri::command]
pub fn delete_tags(state: State<'_, AppState>, tags: Vec<String>) -> Result<TagDeleteResult, String> {
  to_result(state.service.delete_tags(tags))
}

#[tauri::command]
pub fn delete_book(state: State<'_, AppState>, book_id: String) -> Result<(), String> {
  to_result(state.service.delete_book(book_id))
}

#[tauri::command]
pub async fn search_cover_candidates(
  state: State<'_, AppState>,
  book_id: String,
) -> Result<Vec<CoverCandidate>, String> {
  let service = state.service.clone();
  tauri::async_runtime::spawn_blocking(move || service.search_cover_candidates(book_id))
    .await
    .map_err(|err| format!("cover search task join error: {err}"))?
    .map_err(|err| err.to_string())
}
