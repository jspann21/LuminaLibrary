use serde::{Deserialize, Serialize};

#[derive(Clone)]
pub struct AppState {
  pub service: crate::library::service::LibraryService,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LibraryFolder {
  pub id: String,
  pub path: String,
  pub recursive: bool,
  pub enabled: bool,
  pub added_at: String,
  pub last_scan_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScanSummary {
  pub scanned_files: u64,
  pub new_files: u64,
  pub updated_files: u64,
  pub unchanged_files: u64,
  pub matched_files: u64,
  pub discovered_files: u64,
  pub removed_files: u64,
  pub errors: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct LibraryMaintenanceResult {
  pub checked_files: u64,
  pub missing_files_found: u64,
  pub removed_files: u64,
  pub removed_orphan_books: u64,
  pub merged_duplicate_books: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
  pub google_books_api_key_configured: bool,
  pub google_books_api_key_managed_by_app: bool,
  pub google_books_api_key_from_environment: bool,
  pub scan_on_startup: bool,
  pub library_thing_enabled: bool,
  pub library_thing_catalog_label: Option<String>,
  pub library_thing_last_import_at: Option<String>,
  pub library_thing_book_count: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeyTestResult {
  pub ok: bool,
  pub message: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct BookFilters {
  pub formats: Vec<String>,
  pub tags: Vec<String>,
  pub authors: Vec<String>,
  pub publisher: Option<String>,
  pub year_from: Option<i32>,
  pub year_to: Option<i32>,
  pub folder_ids: Vec<String>,
  pub status: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SortSpec {
  pub field: String,
  pub direction: String,
}

impl Default for SortSpec {
  fn default() -> Self {
    Self {
      field: "title".to_string(),
      direction: "asc".to_string(),
    }
  }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Paged<T> {
  pub items: Vec<T>,
  pub total: i64,
  pub page: u32,
  pub page_size: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BookCard {
  pub id: String,
  pub title: String,
  pub authors: Vec<String>,
  pub tags: Vec<String>,
  pub publisher: Option<String>,
  pub publish_date: Option<String>,
  pub cover_url: Option<String>,
  pub cover_local_path: Option<String>,
  pub confidence: Option<f64>,
  pub formats: Vec<String>,
  pub file_count: i64,
  pub missing_files: i64,
  pub library_thing_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BookFile {
  pub file_id: String,
  pub abs_path: String,
  pub format: String,
  pub status: String,
  pub folder_path: String,
  pub size_bytes: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BookDetail {
  pub id: String,
  pub title: String,
  pub subtitle: Option<String>,
  pub authors: Vec<String>,
  pub tags: Vec<String>,
  pub publisher: Option<String>,
  pub publish_date: Option<String>,
  pub added_at: String,
  pub isbn10: Option<String>,
  pub isbn13: Option<String>,
  pub description: Option<String>,
  pub language: Option<String>,
  pub page_count: Option<i64>,
  pub series: Option<String>,
  pub series_index: Option<i64>,
  pub cover_url: Option<String>,
  pub cover_local_path: Option<String>,
  pub metadata_source: String,
  pub confidence: Option<f64>,
  pub files: Vec<BookFile>,
  pub library_thing_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LibraryThingImportResult {
  pub imported_rows: usize,
  pub matched_rows: usize,
  pub created_rows: usize,
  pub skipped_rows: usize,
  pub path: String,
  pub imported_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredFile {
  pub file_id: String,
  pub abs_path: String,
  pub file_name: String,
  pub folder_path: String,
  pub guessed_title: Option<String>,
  pub guessed_author: Option<String>,
  pub guessed_isbn: Option<String>,
  pub status: String,
  pub parser_error: Option<String>,
  pub reason: String,
  pub last_seen_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MatchResult {
  pub file_id: String,
  pub matched: bool,
  pub book_id: Option<String>,
  pub confidence: Option<f64>,
  pub reason: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BulkMatchInput {
  pub file_id: String,
  pub title: Option<String>,
  pub author: Option<String>,
  pub isbn: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BulkMatchResult {
  pub results: Vec<MatchResult>,
  pub matched_count: usize,
  pub failed_count: usize,
  pub skipped_count: usize,
  pub error_count: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct BookPatch {
  pub title: Option<String>,
  pub subtitle: Option<String>,
  pub authors: Option<Vec<String>>,
  pub publisher: Option<String>,
  pub publish_date: Option<String>,
  pub isbn10: Option<String>,
  pub isbn13: Option<String>,
  pub description: Option<String>,
  pub language: Option<String>,
  pub page_count: Option<i64>,
  pub series: Option<String>,
  pub series_index: Option<i64>,
  pub cover_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum MetadataField {
  Title,
  Subtitle,
  Authors,
  Publisher,
  PublishDate,
  Isbn10,
  Isbn13,
  Description,
  Language,
  PageCount,
  Series,
  SeriesIndex,
  CoverUrl,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MetadataCandidate {
  pub id: String,
  pub source: String,
  pub title: Option<String>,
  pub subtitle: Option<String>,
  pub authors: Option<Vec<String>>,
  pub publisher: Option<String>,
  pub publish_date: Option<String>,
  pub isbn10: Option<String>,
  pub isbn13: Option<String>,
  pub description: Option<String>,
  pub language: Option<String>,
  pub page_count: Option<i64>,
  pub series: Option<String>,
  pub series_index: Option<i64>,
  pub cover_url: Option<String>,
  pub confidence: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MetadataSourceStatus {
  pub source: String,
  pub status: String,
  pub message: Option<String>,
  pub candidate_count: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MetadataFieldSelection {
  pub field: MetadataField,
  pub candidate_id: Option<String>,
  pub value: Option<String>,
  pub values: Option<Vec<String>>,
  pub int_value: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MetadataLockUpdate {
  pub field: MetadataField,
  pub locked: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MetadataRescanPreview {
  pub book_id: String,
  pub file_id: String,
  pub candidates: Vec<MetadataCandidate>,
  pub source_statuses: Vec<MetadataSourceStatus>,
  pub locked_fields: Vec<MetadataField>,
  pub suggested_selections: Vec<MetadataFieldSelection>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MatchPreview {
  pub file_id: String,
  pub file_name: String,
  pub candidates: Vec<MetadataCandidate>,
  pub source_statuses: Vec<MetadataSourceStatus>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CoverCandidate {
  pub url: String,
  pub source: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TagCount {
  pub tag: String,
  pub count: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TagMergeResult {
  pub target_tag: String,
  pub merged_tag_count: i64,
  pub affected_books: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TagDeleteResult {
  pub deleted_tag_count: i64,
  pub affected_books: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FolderRemovalPreview {
  pub folder_id: String,
  pub path: String,
  pub file_count: u64,
  pub book_count: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
  pub exported_rows: usize,
  pub path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
  pub imported_rows: usize,
  pub matched_rows: usize,
  pub updated_rows: usize,
  pub path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileRecord {
  pub id: String,
  pub folder_id: String,
  pub abs_path: String,
  pub ext: String,
  pub size_bytes: i64,
  pub mtime_utc: String,
  pub hash_sha256: Option<String>,
  pub status: String,
  pub first_seen_at: String,
  pub last_seen_at: String,
  pub parser_error: Option<String>,
  pub guessed_title: Option<String>,
  pub guessed_author: Option<String>,
  pub guessed_isbn: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct ParsedMetadata {
  pub title: Option<String>,
  pub subtitle: Option<String>,
  pub authors: Vec<String>,
  pub publisher: Option<String>,
  pub publish_date: Option<String>,
  pub isbn10: Option<String>,
  pub isbn13: Option<String>,
  pub description: Option<String>,
  pub language: Option<String>,
  pub page_count: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct EnrichedBook {
  pub title: String,
  pub subtitle: Option<String>,
  pub authors: Vec<String>,
  pub publisher: Option<String>,
  pub publish_date: Option<String>,
  pub isbn10: Option<String>,
  pub isbn13: Option<String>,
  pub description: Option<String>,
  pub language: Option<String>,
  pub page_count: Option<i64>,
  pub cover_url: Option<String>,
  pub confidence: f64,
}

#[derive(Debug, Clone)]
pub struct FileProcessingOutcome {
  pub file: FileRecord,
  pub book_id: Option<String>,
  pub confidence: Option<f64>,
  pub reason: String,
}

#[derive(Debug, Clone)]
pub struct UpsertFilePayload {
  pub folder_id: String,
  pub abs_path: String,
  pub ext: String,
  pub size_bytes: i64,
  pub mtime_utc: String,
  pub hash_sha256: Option<String>,
  pub status: String,
  pub parser_error: Option<String>,
  pub guessed_title: Option<String>,
  pub guessed_author: Option<String>,
  pub guessed_isbn: Option<String>,
}

#[derive(Debug, Clone)]
pub struct UpsertBookInput {
  pub title: String,
  pub subtitle: Option<String>,
  pub authors: Vec<String>,
  pub publisher: Option<String>,
  pub publish_date: Option<String>,
  pub isbn10: Option<String>,
  pub isbn13: Option<String>,
  pub description: Option<String>,
  pub language: Option<String>,
  pub page_count: Option<i64>,
  pub series: Option<String>,
  pub series_index: Option<i64>,
  pub cover_url: Option<String>,
  pub metadata_source: String,
  pub confidence: Option<f64>,
}
