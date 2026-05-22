use std::{
  collections::HashMap,
  fs::{self, File},
  path::Path,
  process::Command,
  time::{Duration, Instant, SystemTime},
};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use anyhow::{anyhow, ensure, Context};
use chrono::{DateTime, Utc};
use reqwest::{blocking::Client as HttpClient, StatusCode, Url};
use serde_json::json;
use tauri::{AppHandle, Emitter};

use crate::library::cover_cache::CoverCache;
use crate::library::db::Repository;
use crate::library::metadata::{
  env_google_books_api_key, infer_metadata_from_filename, normalize_isbn, normalize_valid_isbn, parse_metadata,
  OpenLibraryEnricher,
};
use crate::library::scanner::{Scanner, FolderWatcher};
use crate::library::secrets::SecretStore;
use crate::library::types::{
  ApiKeyTestResult, AppSettings, BookDetail, BookFilters, BookPatch, ExportResult,
  FileRecord, FolderRemovalPreview, ImportResult, LibraryFolder, LibraryMaintenanceResult, MatchPreview, MatchResult, Paged,
  MetadataCandidate, MetadataField, MetadataFieldSelection, MetadataLockUpdate, MetadataRescanPreview, MetadataSourceStatus,
  ParsedMetadata, ScanSummary, SortSpec,
  TagCount, TagDeleteResult, TagMergeResult,
  UpsertBookInput,
};

const MAX_CSV_IMPORT_BYTES: u64 = 25 * 1024 * 1024;
const MAX_BOOK_IDS_PER_REQUEST: usize = 500;
const MAX_METADATA_FIELD_UPDATES: usize = 32;
const MAX_SEARCH_QUERY_CHARS: usize = 256;
const MAX_TAGS_PER_REQUEST: usize = 100;
const MAX_TAG_LABEL_CHARS: usize = 80;

#[derive(Clone)]
pub struct LibraryService {
  pub repository: Repository,
  secret_store: SecretStore,
  scanner: Scanner,
  watcher: FolderWatcher,
  cover_cache: CoverCache,
}

impl LibraryService {
  pub fn new(app_data_dir: std::path::PathBuf, app_handle: AppHandle) -> anyhow::Result<Self> {
    let db_path = app_data_dir.join("lumina-library.db");
    let repository = Repository::new(db_path)?;
    repository.init_schema()?;
    let startup_now = now_iso();
    let merged_duplicate_books = repository.consolidate_duplicate_books(&startup_now)?;
    let removed_orphan_books = repository.cleanup_orphan_books()?;
    if merged_duplicate_books > 0 || removed_orphan_books > 0 {
      log::info!(
        "startup_maintenance merged_duplicate_books={} removed_orphan_books={}",
        merged_duplicate_books,
        removed_orphan_books
      );
    }
    if let Err(err) = repository.optimize_storage() {
      log::warn!("startup_storage_maintenance_failed error={err}");
    }

    let secret_store = SecretStore::new();
    let enricher = OpenLibraryEnricher::new();
    if let Ok(Some(stored_api_key)) = secret_store.get_google_books_api_key() {
      enricher.set_google_books_api_key(Some(stored_api_key));
    }

    let cover_cache = CoverCache::new(app_data_dir.join("covers"))?;
    let scanner = Scanner::new(repository.clone(), enricher, app_handle.clone(), cover_cache.clone());
    let watcher = FolderWatcher::new(scanner.clone(), repository.clone(), app_handle)?;
    Ok(Self {
      repository,
      secret_store,
      scanner,
      watcher,
      cover_cache,
    })
  }

  pub fn start_existing_folder_watchers(&self) -> anyhow::Result<()> {
    for folder in self.repository.list_folders()? {
      self.watcher.watch_folder(&folder)?;
    }
    Ok(())
  }

  pub fn add_library_folder(&self, path: String, recursive: bool) -> anyhow::Result<LibraryFolder> {
    let canonical = fs::canonicalize(&path)
      .with_context(|| format!("failed to canonicalize {path}"))?
      .to_string_lossy()
      .to_string();
    let folder = self.repository.add_folder(&canonical, recursive, &now_iso())?;
    self.watcher.watch_folder(&folder)?;
    Ok(folder)
  }

  pub fn remove_library_folder(&self, folder_id: String) -> anyhow::Result<()> {
    let folder = self
      .repository
      .get_folder(&folder_id)?
      .ok_or_else(|| anyhow!("folder not found"))?;
    self.watcher.unwatch_folder(&folder.path)?;
    let file_ids: Vec<String> = self
      .repository
      .list_files_for_folder(&folder_id)?
      .into_iter()
      .map(|file| file.id)
      .collect();
    let now = now_iso();
    let _ = self
      .repository
      .remove_files_and_cleanup_orphan_books(&file_ids, &now)?;
    self.repository.remove_folder(&folder_id)?;
    self.run_storage_maintenance();
    Ok(())
  }

  pub fn get_folder_removal_preview(&self, folder_id: String) -> anyhow::Result<FolderRemovalPreview> {
    let folder = self
      .repository
      .get_folder(&folder_id)?
      .ok_or_else(|| anyhow!("folder not found"))?;
    let file_count = self.repository.count_files_for_folder(&folder_id)?;
    let book_count = self.repository.count_books_orphaned_by_folder_removal(&folder_id)?;
    Ok(FolderRemovalPreview {
      folder_id,
      path: folder.path,
      file_count,
      book_count,
    })
  }

  pub fn get_library_folders(&self) -> anyhow::Result<Vec<LibraryFolder>> {
    self.repository.list_folders()
  }

  pub fn start_scan(&self, folder_id: Option<String>) -> anyhow::Result<ScanSummary> {
    let summary = self.scanner.scan(folder_id)?;
    self.run_post_match_maintenance()?;
    Ok(summary)
  }

  pub fn rescan_missing_metadata(&self) -> anyhow::Result<ScanSummary> {
    let summary = self.scanner.rescan_missing_metadata()?;
    self.run_post_match_maintenance()?;
    Ok(summary)
  }

  pub fn refresh_missing_covers(&self) -> anyhow::Result<ScanSummary> {
    self.scanner.refresh_missing_covers()
  }

  pub fn get_app_settings(&self) -> anyhow::Result<AppSettings> {
    Ok(AppSettings {
      google_books_api_key_configured: self.scanner.google_books_api_key_configured(),
      google_books_api_key_managed_by_app: self.secret_store.has_google_books_api_key()?,
      google_books_api_key_from_environment: env_google_books_api_key().is_some(),
      scan_on_startup: self.repository.get_scan_on_startup()?,
    })
  }

  pub fn set_scan_on_startup(&self, enabled: bool) -> anyhow::Result<AppSettings> {
    self.repository.set_scan_on_startup(enabled, &now_iso())?;
    self.get_app_settings()
  }

  pub fn set_google_books_api_key(&self, api_key: String) -> anyhow::Result<AppSettings> {
    let normalized = normalize_google_books_api_key(&api_key)?;
    self.secret_store.set_google_books_api_key(&normalized)?;
    self.scanner.set_google_books_api_key(Some(normalized));
    self.get_app_settings()
  }

  pub fn clear_google_books_api_key(&self) -> anyhow::Result<AppSettings> {
    self.secret_store.clear_google_books_api_key()?;
    self.scanner.set_google_books_api_key(env_google_books_api_key());
    self.get_app_settings()
  }

  pub fn test_google_books_api_key(&self, api_key: Option<String>) -> anyhow::Result<ApiKeyTestResult> {
    let (resolved_key, source_label) = if let Some(candidate) = api_key {
      (normalize_google_books_api_key(&candidate)?, "provided input")
    } else if let Some(stored) = self.secret_store.get_google_books_api_key()? {
      (stored, "secure storage")
    } else if let Some(environment) = env_google_books_api_key() {
      (environment, "environment variable")
    } else {
      return Ok(ApiKeyTestResult {
        ok: false,
        message: "No API key provided. Enter a key or save one in secure storage first.".to_string(),
      });
    };

    let client = HttpClient::builder()
      .timeout(Duration::from_secs(12))
      .user_agent("lumina-library-desktop/0.1")
      .build()
      .context("failed to initialize http client for API key test")?;

    let response = client
      .get("https://www.googleapis.com/books/v1/volumes")
      .query(&[
        ("q", "isbn:9780140328721"),
        ("maxResults", "1"),
        ("printType", "books"),
        ("key", resolved_key.as_str()),
      ])
      .send();

    let response = match response {
      Ok(value) => value,
      Err(_) => {
        return Ok(ApiKeyTestResult {
          ok: false,
          message: "Could not reach Google Books API. Check internet connection and try again.".to_string(),
        });
      }
    };

    if response.status().is_success() {
      return Ok(ApiKeyTestResult {
        ok: true,
        message: format!("API key test succeeded ({source_label})."),
      });
    }

    let status = response.status();
    let message = if matches!(
      status,
      StatusCode::BAD_REQUEST | StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN
    ) {
      "Google Books rejected the API key. Verify the key and API access settings in Google Cloud."
        .to_string()
    } else if status == StatusCode::TOO_MANY_REQUESTS {
      "Google Books rate limit reached while testing the key. Try again later.".to_string()
    } else {
      format!("Google Books API test failed with status {}.", status.as_u16())
    };

    Ok(ApiKeyTestResult { ok: false, message })
  }

  pub fn get_library_books(
    &self,
    query: Option<String>,
    filters: Option<BookFilters>,
    sort: Option<SortSpec>,
    page: Option<u32>,
    page_size: Option<u32>,
  ) -> anyhow::Result<Paged<crate::library::types::BookCard>> {
    validate_search_query(&query)?;
    self
      .repository
      .get_library_books(query, filters.unwrap_or_default(), sort.unwrap_or_default(), page, page_size)
  }

  pub fn cache_book_covers(&self, book_ids: Vec<String>) -> anyhow::Result<u32> {
    validate_book_id_batch(&book_ids)?;
    let mut updated = 0;
    for book_id in book_ids {
      if self.cache_book_cover_if_needed(&book_id)? {
        updated += 1;
      }
    }
    Ok(updated)
  }

  pub fn get_hidden_books(
    &self,
    query: Option<String>,
    page: Option<u32>,
    page_size: Option<u32>,
  ) -> anyhow::Result<Paged<crate::library::types::BookCard>> {
    validate_search_query(&query)?;
    self.repository.get_hidden_books(query, page, page_size)
  }

  pub fn get_book_detail(&self, book_id: String) -> anyhow::Result<BookDetail> {
    self.repository.get_book_detail(&book_id)
  }

  pub fn get_library_tags(&self) -> anyhow::Result<Vec<TagCount>> {
    self.repository.get_library_tags()
  }

  pub fn get_discovered_files(
    &self,
    query: Option<String>,
    page: Option<u32>,
    page_size: Option<u32>,
  ) -> anyhow::Result<Paged<crate::library::types::DiscoveredFile>> {
    validate_search_query(&query)?;
    self.repository.get_discovered_files(query, page, page_size)
  }

  pub fn attempt_match(
    &self,
    file_id: String,
    isbn: Option<String>,
    title: Option<String>,
    author: Option<String>,
  ) -> anyhow::Result<MatchResult> {
    let result = self.attempt_match_single(&file_id, isbn, title, author)?;
    self.run_post_match_maintenance()?;
    Ok(result)
  }

  pub fn batch_attempt_match(
    &self,
    items: Vec<crate::library::types::BulkMatchInput>,
    app_handle: Option<AppHandle>,
  ) -> anyhow::Result<crate::library::types::BulkMatchResult> {
    use crate::library::types::{BulkMatchResult, MatchResult as MR};

    let total_files = items.len();
    let mut results: Vec<MR> = Vec::with_capacity(items.len());
    let mut matched_count: usize = 0;
    let mut failed_count: usize = 0;
    let mut skipped_count: usize = 0;
    let mut error_count: usize = 0;
    let mut processed_files: usize = 0;

    if let Some(app) = app_handle.as_ref() {
      emit_bulk_match_progress(
        app,
        "progress",
        total_files,
        processed_files,
        matched_count,
        failed_count,
        skipped_count,
        error_count,
        None,
      );
    }

    for item in items {
      let file_id = item.file_id;
      let current_path = self
        .repository
        .get_file_by_id(&file_id)
        .ok()
        .flatten()
        .map(|file| file.abs_path)
        .unwrap_or_else(|| file_id.clone());

      match self.attempt_match_single(&file_id, item.isbn, item.title, item.author) {
        Ok(result) => {
          if result.matched {
            matched_count += 1;
          } else if result.reason == "file_no_longer_unresolved" {
            skipped_count += 1;
          } else {
            failed_count += 1;
          }
          results.push(result);
        }
        Err(err) => {
          error_count += 1;
          results.push(MR {
            file_id,
            matched: false,
            book_id: None,
            confidence: None,
            reason: format!("error: {err}"),
          });
        }
      }
      processed_files += 1;
      if let Some(app) = app_handle.as_ref() {
        emit_bulk_match_progress(
          app,
          "progress",
          total_files,
          processed_files,
          matched_count,
          failed_count,
          skipped_count,
          error_count,
          Some(current_path.clone()),
        );
      }
    }

    // Run maintenance once after the entire batch instead of per-file
    self.run_post_match_maintenance()?;

    if let Some(app) = app_handle.as_ref() {
      emit_bulk_match_progress(
        app,
        "completed",
        total_files,
        processed_files,
        matched_count,
        failed_count,
        skipped_count,
        error_count,
        None,
      );
    }

    Ok(BulkMatchResult {
      results,
      matched_count,
      failed_count,
      skipped_count,
      error_count,
    })
  }

  /// Internal helper used by both single and batch match — does NOT call
  /// `run_post_match_maintenance` so the caller can defer it.
  fn attempt_match_single(
    &self,
    file_id: &str,
    isbn: Option<String>,
    title: Option<String>,
    author: Option<String>,
  ) -> anyhow::Result<MatchResult> {
    let file = self
      .repository
      .get_file_by_id(file_id)?
      .ok_or_else(|| anyhow!("file not found"))?;
    if !matches!(file.status.as_str(), "discovered" | "error") {
      return Ok(MatchResult {
        file_id: file_id.to_string(),
        matched: false,
        book_id: None,
        confidence: None,
        reason: "file_no_longer_unresolved".to_string(),
      });
    }

    let mut metadata = ParsedMetadata {
      title: title.or(file.guessed_title.clone()),
      authors: file
        .guessed_author
        .as_ref()
        .map(|name| vec![name.clone()])
        .unwrap_or_default(),
      ..Default::default()
    };

    if let Some(isbn_value) = isbn.or(file.guessed_isbn.clone()) {
      if let Some(normalized) = normalize_valid_isbn(&isbn_value) {
        if normalized.len() == 10 {
          metadata.isbn10 = Some(normalized);
        } else if normalized.len() == 13 {
          metadata.isbn13 = Some(normalized);
        }
      }
    }
    if let Some(author_name) = author {
      metadata.authors = vec![author_name];
    }

    let outcome = match self.scanner.match_and_link_file(&file, metadata, true, None) {
      Ok(outcome) => outcome,
      Err(err) if err.to_string().contains("file no longer available for matching") => {
        return Ok(MatchResult {
          file_id: file_id.to_string(),
          matched: false,
          book_id: None,
          confidence: None,
          reason: "file_no_longer_unresolved".to_string(),
        });
      }
      Err(err) => return Err(err),
    };
    Ok(MatchResult {
      file_id: file_id.to_string(),
      matched: outcome.book_id.is_some(),
      book_id: outcome.book_id,
      confidence: outcome.confidence,
      reason: outcome.reason,
    })
  }

  pub fn preview_match(
    &self,
    file_id: String,
    isbn: Option<String>,
    title: Option<String>,
    author: Option<String>,
  ) -> anyhow::Result<MatchPreview> {
    let file = self
      .repository
      .get_file_by_id(&file_id)?
      .ok_or_else(|| anyhow!("file not found"))?;
    ensure!(
      matches!(file.status.as_str(), "discovered" | "error"),
      "file no longer unresolved"
    );

    let file_name = Path::new(&file.abs_path)
      .file_name()
      .map(|n| n.to_string_lossy().to_string())
      .unwrap_or_else(|| file.abs_path.clone());

    let mut metadata = ParsedMetadata {
      title: title.or(file.guessed_title.clone()),
      authors: file
        .guessed_author
        .as_ref()
        .map(|name| vec![name.clone()])
        .unwrap_or_default(),
      ..Default::default()
    };

    if let Some(isbn_value) = isbn.or(file.guessed_isbn.clone()) {
      if let Some(normalized) = normalize_valid_isbn(&isbn_value) {
        if normalized.len() == 10 {
          metadata.isbn10 = Some(normalized);
        } else if normalized.len() == 13 {
          metadata.isbn13 = Some(normalized);
        }
      }
    }
    if let Some(author_name) = author {
      metadata.authors = vec![author_name];
    }

    let mut candidates: Vec<MetadataCandidate> = Vec::new();
    let mut source_statuses: Vec<MetadataSourceStatus> = Vec::new();

    // Check local DB matches first
    let local_book_id: Option<String> = if let Some(hash) = file.hash_sha256.as_deref() {
      self.repository.find_book_by_file_hash(hash, &file.id)?
    } else {
      None
    }
    .or(self.repository.find_book_by_isbn(metadata.isbn10.as_deref(), metadata.isbn13.as_deref())?)
    .or({
      if let Some(t) = metadata.title.as_deref() {
        self.repository.find_book_by_title_author(t, &metadata.authors)?
      } else {
        None
      }
    });

    if let Some(book_id) = local_book_id {
      if let Ok(detail) = self.repository.get_book_detail(&book_id) {
        candidates.push(MetadataCandidate {
          id: format!("local:{book_id}"),
          source: "local_library".to_string(),
          title: Some(detail.title),
          subtitle: detail.subtitle,
          authors: Some(detail.authors),
          publisher: detail.publisher,
          publish_date: detail.publish_date,
          isbn10: detail.isbn10,
          isbn13: detail.isbn13,
          description: detail.description,
          language: detail.language,
          page_count: detail.page_count,
          series: detail.series,
          series_index: detail.series_index,
          cover_url: detail.cover_url,
          confidence: detail.confidence,
        });
        source_statuses.push(MetadataSourceStatus {
          source: "local_library".to_string(),
          status: "ok".to_string(),
          message: None,
          candidate_count: 1,
        });
      }
    }

    // Also query external APIs for candidates
    let (api_candidates, api_statuses) = self.scanner.enricher.preview_metadata_candidates(&metadata);
    candidates.extend(api_candidates);
    source_statuses.extend(api_statuses);

    Ok(MatchPreview {
      file_id,
      file_name,
      candidates,
      source_statuses,
    })
  }

  pub fn apply_manual_book_edit(&self, book_id: String, mut patch: BookPatch) -> anyhow::Result<BookDetail> {
    normalize_book_patch_isbns(&mut patch);
    validate_book_patch_cover_url(&mut patch)?;
    self.repository.apply_manual_book_edit(&book_id, patch, &now_iso())?;
    let _ = self.cache_book_cover_if_needed(&book_id)?;
    self.get_detail_after_duplicate_consolidation(&book_id)
  }

  pub fn create_manual_book(
    &self,
    file_id: String,
    mut patch: BookPatch,
    tags: Vec<String>,
  ) -> anyhow::Result<BookDetail> {
    normalize_book_patch_isbns(&mut patch);
    validate_book_patch_cover_url(&mut patch)?;
    validate_tag_inputs(&tags)?;
    normalize_manual_create_patch(&mut patch)?;

    let file = self
      .repository
      .get_file_by_id(&file_id)?
      .ok_or_else(|| anyhow!("file not found"))?;
    ensure!(
      matches!(file.status.as_str(), "discovered" | "error"),
      "file no longer unresolved"
    );

    let title = patch
      .title
      .clone()
      .ok_or_else(|| anyhow!("Title is required"))?;
    let authors = patch.authors.clone().unwrap_or_default();
    let now = now_iso();
    let book_id = self.repository.upsert_book(
      UpsertBookInput {
        title,
        subtitle: patch.subtitle.clone(),
        authors,
        publisher: patch.publisher.clone(),
        publish_date: patch.publish_date.clone(),
        isbn10: patch.isbn10.clone(),
        isbn13: patch.isbn13.clone(),
        description: patch.description.clone(),
        language: patch.language.clone(),
        page_count: patch.page_count,
        series: patch.series.clone(),
        series_index: patch.series_index,
        cover_url: patch.cover_url.clone(),
        metadata_source: "manual".to_string(),
        confidence: Some(1.0),
      },
      &now,
    )?;

    self
      .repository
      .link_file_to_book(&file.id, &book_id, &file.ext.to_lowercase(), true, &now)?;
    self.repository.apply_manual_book_edit(&book_id, patch, &now)?;
    if !tags.is_empty() {
      self.repository.set_book_tags(&book_id, tags, &now)?;
    }
    let _ = self.cache_book_cover_if_needed(&book_id)?;
    self.get_detail_after_duplicate_consolidation(&book_id)
  }

  pub fn set_book_tags(&self, book_id: String, tags: Vec<String>) -> anyhow::Result<BookDetail> {
    validate_tag_inputs(&tags)?;
    self.repository.set_book_tags(&book_id, tags, &now_iso())?;
    self.repository.get_book_detail(&book_id)
  }

  pub fn hide_books(&self, book_ids: Vec<String>) -> anyhow::Result<u64> {
    validate_book_id_batch(&book_ids)?;
    self.repository.set_books_hidden(book_ids, true, &now_iso())
  }

  pub fn restore_books(&self, book_ids: Vec<String>) -> anyhow::Result<u64> {
    validate_book_id_batch(&book_ids)?;
    self.repository.set_books_hidden(book_ids, false, &now_iso())
  }

  pub fn merge_tags(&self, source_tags: Vec<String>, target_tag: String) -> anyhow::Result<TagMergeResult> {
    validate_tag_inputs(&source_tags)?;
    validate_tag_value(&target_tag)?;
    self.repository.merge_tags(source_tags, target_tag, &now_iso())
  }

  pub fn delete_tags(&self, tags: Vec<String>) -> anyhow::Result<TagDeleteResult> {
    validate_tag_inputs(&tags)?;
    self.repository.delete_tags(tags)
  }

  pub fn delete_book(&self, book_id: String) -> anyhow::Result<()> {
    self.repository.delete_book(&book_id, &now_iso())
  }

  pub fn mark_file_missing(&self, file_id: String, missing: bool) -> anyhow::Result<()> {
    self.repository.mark_file_missing(&file_id, missing, &now_iso())
  }

  pub fn reconcile_local_files(&self) -> anyhow::Result<LibraryMaintenanceResult> {
    let files = self.repository.list_all_files()?;
    let checked_files = files.len() as u64;
    let missing_file_ids: Vec<String> = files
      .iter()
      .filter(|file| !Path::new(&file.abs_path).exists())
      .map(|file| file.id.clone())
      .collect();

    let now = now_iso();
    let (removed_files, removed_orphan_books) = self
      .repository
      .remove_files_and_cleanup_orphan_books(&missing_file_ids, &now)?;
    let merged_duplicate_books = self.repository.consolidate_duplicate_books(&now)?;
    if removed_files > 0 || removed_orphan_books > 0 || merged_duplicate_books > 0 {
      self.run_storage_maintenance();
    }

    Ok(LibraryMaintenanceResult {
      checked_files,
      missing_files_found: missing_file_ids.len() as u64,
      removed_files,
      removed_orphan_books,
      merged_duplicate_books,
    })
  }

  pub fn export_unresolved_csv(&self, path: String) -> anyhow::Result<ExportResult> {
    validate_csv_export_path(&path)?;
    let file = File::create(&path).with_context(|| format!("failed to create export file {path}"))?;
    let mut writer = csv::Writer::from_writer(file);
    writer.write_record([
      "file_id",
      "abs_path",
      "file_name",
      "status",
      "reason",
      "guessed_title",
      "guessed_author",
      "guessed_isbn",
      "title",
      "subtitle",
      "authors",
      "publisher",
      "publish_date",
      "isbn10",
      "isbn13",
      "description",
      "language",
      "page_count",
      "series",
      "series_index",
      "cover_url",
      "tags",
    ])?;
    let exported_rows = self.repository.for_each_discovered_file_unbounded(|item| {
      let (isbn10, isbn13) = split_isbn_columns(item.guessed_isbn.as_deref());
      writer.write_record([
        item.file_id.as_str(),
        item.abs_path.as_str(),
        item.file_name.as_str(),
        item.status.as_str(),
        item.reason.as_str(),
        item.guessed_title.as_deref().unwrap_or_default(),
        item.guessed_author.as_deref().unwrap_or_default(),
        item.guessed_isbn.as_deref().unwrap_or_default(),
        "",
        "",
        "",
        "",
        "",
        isbn10.as_str(),
        isbn13.as_str(),
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ])?;
      Ok(())
    })?;
    writer.flush()?;
    Ok(ExportResult {
      exported_rows,
      path,
    })
  }

  pub fn import_enrichment_csv(&self, path: String) -> anyhow::Result<ImportResult> {
    const PROGRESS_BATCH_SIZE: usize = 200;
    const PROGRESS_EMIT_INTERVAL: Duration = Duration::from_millis(500);

    let metadata = validate_csv_import_path(&path)?;
    let import_started_at = Instant::now();
    let total_bytes = Some(metadata.len());
    let mut bytes_read = 0u64;
    let mut imported_rows = 0usize;
    let mut matched_rows = 0usize;
    let mut updated_rows = 0usize;
    let mut errors = 0usize;

    log::info!(
      "csv_import_start path={} total_bytes={}",
      path,
      total_bytes.unwrap_or(0)
    );
    emit_csv_import_progress(
      &self.scanner.app_handle,
      "started",
      &path,
      total_bytes,
      bytes_read,
      imported_rows,
      matched_rows,
      updated_rows,
      errors,
      Some("Import started".to_string()),
    );

    let result = (|| -> anyhow::Result<ImportResult> {
      let file = File::open(&path).with_context(|| format!("failed to open import file {path}"))?;
      let mut reader = csv::Reader::from_reader(file);
      let headers = reader.headers()?.clone();
      let mut record = csv::StringRecord::new();
      let mut processed_since_emit = 0usize;
      let mut last_emit_at = Instant::now();

      while reader.read_record(&mut record)? {
        imported_rows += 1;
        processed_since_emit += 1;
        bytes_read = reader.position().byte();
        let raw_row: HashMap<String, String> = headers
          .iter()
          .zip(record.iter())
          .map(|(key, value)| (key.to_string(), value.to_string()))
          .collect();
        let row = normalize_csv_row(raw_row);

        let file_record = if let Some(file_id) = csv_value(&row, &["file_id"]) {
          self.repository.get_file_by_id(&file_id)?
        } else if let Some(abs_path) = csv_value(&row, &["abs_path"]) {
          self.repository.get_file_by_path(&abs_path)?
        } else {
          None
        };
        let Some(file_record) = file_record else {
          if processed_since_emit >= PROGRESS_BATCH_SIZE || last_emit_at.elapsed() >= PROGRESS_EMIT_INTERVAL {
            emit_csv_import_progress(
              &self.scanner.app_handle,
              "progress",
              &path,
              total_bytes,
              bytes_read,
              imported_rows,
              matched_rows,
              updated_rows,
              errors,
              Some(format!("Importing enrichment CSV: {imported_rows} rows processed")),
            );
            processed_since_emit = 0;
            last_emit_at = Instant::now();
          }
          continue;
        };

        let mut metadata = ParsedMetadata::default();
        metadata.title = csv_value(&row, &["title"]).or_else(|| csv_value(&row, &["guessed_title"]));
        metadata.subtitle = csv_value(&row, &["subtitle"]);
        metadata.authors = csv_value(&row, &["authors", "author"])
          .map(|value| parse_csv_list(&value))
          .unwrap_or_default();
        if metadata.authors.is_empty() {
          if let Some(guessed_author) = csv_value(&row, &["guessed_author"]) {
            metadata.authors.push(guessed_author);
          } else if let Some(guessed_author) = file_record.guessed_author.clone() {
            metadata.authors.push(guessed_author);
          }
        }
        metadata.publisher = csv_value(&row, &["publisher"]);
        metadata.publish_date = csv_value(&row, &["publish_date", "publishdate", "published"]);
        metadata.description = csv_value(&row, &["description"]);
        metadata.language = csv_value(&row, &["language"]);
        metadata.page_count = csv_value(&row, &["page_count", "pagecount", "pages"]).and_then(parse_i64_value);
        assign_isbn_columns(
          &mut metadata,
          csv_value(&row, &["isbn10"]),
          csv_value(&row, &["isbn13"]),
          csv_value(&row, &["isbn", "guessed_isbn"]).or_else(|| file_record.guessed_isbn.clone()),
        );

        if metadata.title.is_none() {
          metadata.title = file_record.guessed_title.clone();
        }

        let outcome = self.scanner.match_and_link_file(&file_record, metadata, true, None)?;
        if let Some(book_id) = outcome.book_id {
          matched_rows += 1;

          let (mut patch, tags) = build_csv_book_patch(&row);
          let mut touched_row = false;
          if has_patch_updates(&patch) {
            validate_book_patch_cover_url(&mut patch)?;
            self.repository.apply_manual_book_edit(&book_id, patch, &now_iso())?;
            let _ = self.cache_book_cover_if_needed(&book_id)?;
            touched_row = true;
          }
          if !tags.is_empty() {
            validate_tag_inputs(&tags)?;
            self.repository.set_book_tags(&book_id, tags, &now_iso())?;
            touched_row = true;
          }
          if touched_row {
            updated_rows += 1;
          }
        }

        if processed_since_emit >= PROGRESS_BATCH_SIZE || last_emit_at.elapsed() >= PROGRESS_EMIT_INTERVAL {
          emit_csv_import_progress(
            &self.scanner.app_handle,
            "progress",
            &path,
            total_bytes,
            bytes_read,
            imported_rows,
            matched_rows,
            updated_rows,
            errors,
            Some(format!("Importing enrichment CSV: {imported_rows} rows processed")),
          );
          processed_since_emit = 0;
          last_emit_at = Instant::now();
        }
      }

      self.run_post_match_maintenance()?;
      Ok(ImportResult {
        imported_rows,
        matched_rows,
        updated_rows,
        path: path.clone(),
      })
    })();

    match result {
      Ok(summary) => {
        let elapsed_ms = import_started_at.elapsed().as_millis() as u64;
        bytes_read = total_bytes.unwrap_or(bytes_read).max(bytes_read);
        emit_csv_import_progress(
          &self.scanner.app_handle,
          "completed",
          &path,
          total_bytes,
          bytes_read,
          imported_rows,
          matched_rows,
          updated_rows,
          errors,
          Some(format!(
            "CSV import complete: {imported_rows} rows processed, {matched_rows} matched, {updated_rows} updated"
          )),
        );
        log::info!(
          "csv_import_done path={} elapsed_ms={} processed_rows={} matched_rows={} updated_rows={} unresolved_rows={}",
          path,
          elapsed_ms,
          imported_rows,
          matched_rows,
          updated_rows,
          imported_rows.saturating_sub(matched_rows)
        );
        Ok(summary)
      }
      Err(err) => {
        errors += 1;
        let elapsed_ms = import_started_at.elapsed().as_millis() as u64;
        emit_csv_import_progress(
          &self.scanner.app_handle,
          "error",
          &path,
          total_bytes,
          bytes_read,
          imported_rows,
          matched_rows,
          updated_rows,
          errors,
          Some(err.to_string()),
        );
        log::error!(
          "csv_import_error path={} elapsed_ms={} processed_rows={} matched_rows={} updated_rows={} error={}",
          path,
          elapsed_ms,
          imported_rows,
          matched_rows,
          updated_rows,
          err
        );
        Err(err)
      }
    }
  }

  pub fn rescan_file(&self, file_id: String) -> anyhow::Result<FileRecord> {
    let file = self
      .repository
      .get_file_by_id(&file_id)?
      .ok_or_else(|| anyhow!("file not found"))?;
    let preferred_book_id = self.repository.find_book_id_for_file(&file_id)?;
    let folder = self
      .repository
      .get_folder(&file.folder_id)?
      .ok_or_else(|| anyhow!("folder not found"))?;
    let outcome = self
      .scanner
      .scan_single_file(
        Path::new(&file.abs_path),
        &folder,
        true,
        true,
        preferred_book_id.as_deref(),
      )?;
    self.run_post_match_maintenance()?;
    Ok(outcome.file)
  }

  pub fn preview_rescan_metadata(
    &self,
    book_id: String,
    file_id: String,
  ) -> anyhow::Result<MetadataRescanPreview> {
    let detail = self.repository.get_book_detail(&book_id)?;
    let file = self
      .repository
      .get_file_by_id(&file_id)?
      .ok_or_else(|| anyhow!("file not found"))?;
    let linked_book_id = self.repository.find_book_id_for_file(&file_id)?;
    if linked_book_id.as_deref() != Some(book_id.as_str()) {
      return Err(anyhow!("selected file is not linked to this book"));
    }

    let path = Path::new(&file.abs_path);
    let parsed = parse_metadata(path, &file.ext).unwrap_or_default();
    let guessed = infer_metadata_from_filename(path);
    let locked_db_fields = self.repository.get_manual_override_fields(&book_id)?;

    let mut lookup = parsed.clone();
    if lookup.title.as_deref().map(|value| value.trim().is_empty()).unwrap_or(true)
      || locked_db_fields.contains("title")
    {
      lookup.title = Some(detail.title.clone());
    } else if lookup.title.is_none() {
      lookup.title = guessed.title;
    }
    if lookup.authors.is_empty() || locked_db_fields.contains("authors_json") {
      if !detail.authors.is_empty() {
        lookup.authors = detail.authors.clone();
      } else if !guessed.authors.is_empty() {
        lookup.authors = guessed.authors;
      }
    }
    if lookup.publish_date.is_none() || locked_db_fields.contains("publish_date") {
      lookup.publish_date = detail.publish_date.clone();
    }
    if lookup.isbn13.is_none() || locked_db_fields.contains("isbn13") {
      lookup.isbn13 = detail.isbn13.clone().or(guessed.isbn13);
    }
    if lookup.isbn10.is_none() || locked_db_fields.contains("isbn10") {
      lookup.isbn10 = detail.isbn10.clone().or(guessed.isbn10);
    }
    if lookup.publisher.is_none() || locked_db_fields.contains("publisher") {
      lookup.publisher = detail.publisher.clone();
    }

    let (candidates, source_statuses) = self.scanner.enricher.preview_metadata_candidates(&lookup);
    let locked_fields = manual_override_fields_to_metadata_fields(&locked_db_fields);
    let suggested_selections = build_suggested_selections(&detail, &candidates);

    Ok(MetadataRescanPreview {
      book_id,
      file_id,
      candidates,
      source_statuses,
      locked_fields,
      suggested_selections,
    })
  }

  pub fn apply_curated_metadata(
    &self,
    book_id: String,
    mut selection: Vec<MetadataFieldSelection>,
    lock_updates: Vec<MetadataLockUpdate>,
  ) -> anyhow::Result<BookDetail> {
    validate_metadata_update_batch(&selection, &lock_updates)?;
    validate_metadata_selection_cover_urls(&mut selection)?;
    self
      .repository
      .apply_curated_metadata(&book_id, selection, lock_updates, &now_iso())?;
    let _ = self.cache_book_cover_if_needed(&book_id)?;
    self.get_detail_after_duplicate_consolidation(&book_id)
  }

  fn cache_book_cover_if_needed(&self, book_id: &str) -> anyhow::Result<bool> {
    let detail = self.repository.get_book_detail(book_id)?;
    if detail
      .cover_local_path
      .as_deref()
      .map(CoverCache::cached_file_exists)
      .unwrap_or(false)
    {
      return Ok(false);
    }
    let Some(cover_url) = detail.cover_url.as_deref().filter(|value| !value.trim().is_empty()) else {
      return Ok(false);
    };

    match self.cover_cache.cache_cover(book_id, cover_url) {
      Ok(Some(local_path)) => {
        self.repository.set_book_cover_local_path(book_id, &local_path)?;
        Ok(true)
      }
      Ok(None) => Ok(false),
      Err(err) => {
        log::warn!("cover_cache_failed book_id={} error={err}", book_id);
        Ok(false)
      }
    }
  }

  fn get_detail_after_duplicate_consolidation(&self, book_id: &str) -> anyhow::Result<BookDetail> {
    let edited_detail = self.repository.get_book_detail(book_id)?;
    let merged_duplicate_books = self.repository.consolidate_duplicate_books(&now_iso())?;
    if merged_duplicate_books == 0 {
      return Ok(edited_detail);
    }

    if let Ok(detail) = self.repository.get_book_detail(book_id) {
      return Ok(detail);
    }
    if let Some(resolved_id) = self
      .repository
      .find_book_by_isbn(edited_detail.isbn10.as_deref(), edited_detail.isbn13.as_deref())?
    {
      return self.repository.get_book_detail(&resolved_id);
    }
    if let Some(resolved_id) = self
      .repository
      .find_book_by_title_author(&edited_detail.title, &edited_detail.authors)?
    {
      return self.repository.get_book_detail(&resolved_id);
    }

    self.repository.get_book_detail(book_id)
  }

  pub fn open_local_file(&self, abs_path: String) -> anyhow::Result<()> {
    let path = Path::new(&abs_path);
    ensure!(path.is_absolute(), "file path must be absolute");
    ensure!(
      self.repository.get_file_by_path(&abs_path)?.is_some(),
      "file is not registered in the library"
    );

    let metadata = fs::metadata(path).with_context(|| format!("failed to access file {abs_path}"))?;
    ensure!(metadata.is_file(), "path is not a file: {abs_path}");

    open_file_with_system_app(path)?;
    Ok(())
  }

  pub fn open_local_file_folder(&self, abs_path: String) -> anyhow::Result<()> {
    let path = Path::new(&abs_path);
    ensure!(path.is_absolute(), "file path must be absolute");
    ensure!(
      self.repository.get_file_by_path(&abs_path)?.is_some(),
      "file is not registered in the library"
    );

    let parent = path
      .parent()
      .ok_or_else(|| anyhow!("file has no parent folder: {abs_path}"))?;
    let metadata = fs::metadata(parent).with_context(|| format!("failed to access folder {}", parent.display()))?;
    ensure!(metadata.is_dir(), "path is not a folder: {}", parent.display());

    open_file_with_system_app(parent)?;
    Ok(())
  }

  fn run_post_match_maintenance(&self) -> anyhow::Result<()> {
    let now = now_iso();
    let merged_duplicate_books = self.repository.consolidate_duplicate_books(&now)?;
    let removed_orphan_books = self.repository.cleanup_orphan_books()?;
    if merged_duplicate_books > 0 || removed_orphan_books > 0 {
      log::info!(
        "post_match_maintenance merged_duplicate_books={} removed_orphan_books={}",
        merged_duplicate_books,
        removed_orphan_books
      );
      self.run_storage_maintenance();
    }
    Ok(())
  }

  fn run_storage_maintenance(&self) {
    if let Err(err) = self.repository.optimize_storage() {
      log::warn!("storage_maintenance_failed error={err}");
    }
  }

  pub fn search_cover_candidates(&self, book_id: String) -> anyhow::Result<Vec<crate::library::types::CoverCandidate>> {
    use crate::library::types::CoverCandidate;
    let detail = self.repository.get_book_detail(&book_id)?;
    let mut candidates: Vec<CoverCandidate> = Vec::new();

    // Include current cover as the first candidate if it exists.
    if let Some(ref current_url) = detail.cover_url {
      if !current_url.trim().is_empty() {
        candidates.push(CoverCandidate {
          url: current_url.clone(),
          source: "current".to_string(),
        });
      }
    }

    let mut remote = self.scanner.enricher.search_cover_candidates(
      Some(detail.title.as_str()),
      &detail.authors,
      detail.isbn13.as_deref(),
      detail.isbn10.as_deref(),
    );

    // Deduplicate against current cover.
    let existing_urls: std::collections::HashSet<&str> = candidates.iter().map(|c| c.url.as_str()).collect();
    remote.retain(|c| !existing_urls.contains(c.url.as_str()));
    candidates.extend(remote);

    Ok(candidates)
  }
}



pub(crate) fn now_iso() -> String {
  Utc::now().to_rfc3339()
}

pub(crate) fn system_time_to_iso(time: SystemTime) -> String {
  let datetime: DateTime<Utc> = time.into();
  datetime.to_rfc3339()
}

fn emit_csv_import_progress(
  app_handle: &AppHandle,
  phase: &str,
  path: &str,
  total_bytes: Option<u64>,
  bytes_read: u64,
  processed_rows: usize,
  matched_rows: usize,
  updated_rows: usize,
  errors: usize,
  message: Option<String>,
) {
  let capped_bytes_read = total_bytes.map(|total| bytes_read.min(total)).unwrap_or(bytes_read);
  let progress_percent = total_bytes
    .map(|total| csv_import_progress_percent(capped_bytes_read, total, phase == "completed"))
    .unwrap_or_else(|| if phase == "completed" { 100 } else { 0 });
  let unresolved_rows = processed_rows.saturating_sub(matched_rows);
  let _ = app_handle.emit(
    "csv_import_progress",
    json!({
      "phase": phase,
      "path": path,
      "totalBytes": total_bytes,
      "bytesRead": capped_bytes_read,
      "processedRows": processed_rows,
      "matchedRows": matched_rows,
      "updatedRows": updated_rows,
      "unresolvedRows": unresolved_rows,
      "errors": errors,
      "progressPercent": progress_percent,
      "message": message,
    }),
  );
}

fn emit_bulk_match_progress(
  app_handle: &AppHandle,
  phase: &str,
  total_files: usize,
  processed_files: usize,
  matched_files: usize,
  failed_files: usize,
  skipped_files: usize,
  error_files: usize,
  current_path: Option<String>,
) {
  let unresolved_files = failed_files + error_files;
  let progress_percent = if phase == "completed" {
    100
  } else if total_files == 0 {
    0
  } else {
    (((processed_files as f64 / total_files as f64) * 100.0).round() as i64).clamp(0, 99) as u8
  };

  let _ = app_handle.emit(
    "bulk_match_progress",
    json!({
      "phase": phase,
      "totalFiles": total_files,
      "processedFiles": processed_files,
      "matchedFiles": matched_files,
      "unresolvedFiles": unresolved_files,
      "skippedFiles": skipped_files,
      "errorFiles": error_files,
      "currentPath": current_path,
      "progressPercent": progress_percent,
    }),
  );
}

fn csv_import_progress_percent(bytes_read: u64, total_bytes: u64, completed: bool) -> u8 {
  if completed {
    return 100;
  }
  if total_bytes == 0 {
    return 0;
  }
  let ratio = (bytes_read as f64 / total_bytes as f64) * 100.0;
  let rounded = ratio.round() as i64;
  rounded.clamp(0, 99) as u8
}

fn normalize_csv_row(row: HashMap<String, String>) -> HashMap<String, String> {
  row
    .into_iter()
    .map(|(key, value)| (key.trim().to_ascii_lowercase(), value))
    .collect()
}

fn csv_value(row: &HashMap<String, String>, keys: &[&str]) -> Option<String> {
  for key in keys {
    if let Some(value) = row.get(*key) {
      let trimmed = value.trim();
      if !trimmed.is_empty() {
        return Some(trimmed.to_string());
      }
    }
  }
  None
}

fn parse_csv_list(value: &str) -> Vec<String> {
  value
    .split(|ch| ch == ',' || ch == ';' || ch == '|')
    .map(str::trim)
    .filter(|item| !item.is_empty())
    .map(ToString::to_string)
    .collect()
}

fn parse_i64_value(value: String) -> Option<i64> {
  value.trim().parse::<i64>().ok()
}

fn is_empty_text(value: Option<&str>) -> bool {
  value.map(str::trim).unwrap_or_default().is_empty()
}

fn build_suggested_selections(
  detail: &BookDetail,
  candidates: &[MetadataCandidate],
) -> Vec<MetadataFieldSelection> {
  let Some(best) = candidates.iter().max_by(|left, right| {
    let lc = left.confidence.unwrap_or_default();
    let rc = right.confidence.unwrap_or_default();
    lc.partial_cmp(&rc).unwrap_or(std::cmp::Ordering::Equal)
  }) else {
    return Vec::new();
  };

  let mut out: Vec<MetadataFieldSelection> = Vec::new();
  let push_text = |out: &mut Vec<MetadataFieldSelection>,
                   field: MetadataField,
                   current: Option<&str>,
                   incoming: Option<&String>| {
    if is_empty_text(current) {
      if let Some(value) = incoming.map(String::as_str).map(str::trim).filter(|value| !value.is_empty()) {
        out.push(MetadataFieldSelection {
          field,
          candidate_id: Some(best.id.clone()),
          value: Some(value.to_string()),
          values: None,
          int_value: None,
        });
      }
    }
  };

  if detail.authors.is_empty() {
    if let Some(values) = best.authors.as_ref().filter(|values| !values.is_empty()) {
      out.push(MetadataFieldSelection {
        field: MetadataField::Authors,
        candidate_id: Some(best.id.clone()),
        value: None,
        values: Some(values.clone()),
        int_value: None,
      });
    }
  }

  if detail.page_count.is_none() {
    if let Some(value) = best.page_count {
      out.push(MetadataFieldSelection {
        field: MetadataField::PageCount,
        candidate_id: Some(best.id.clone()),
        value: None,
        values: None,
        int_value: Some(value),
      });
    }
  }

  if detail.series_index.is_none() {
    if let Some(value) = best.series_index {
      out.push(MetadataFieldSelection {
        field: MetadataField::SeriesIndex,
        candidate_id: Some(best.id.clone()),
        value: None,
        values: None,
        int_value: Some(value),
      });
    }
  }

  push_text(&mut out, MetadataField::Title, Some(detail.title.as_str()), best.title.as_ref());
  push_text(
    &mut out,
    MetadataField::Subtitle,
    detail.subtitle.as_deref(),
    best.subtitle.as_ref(),
  );
  push_text(
    &mut out,
    MetadataField::Publisher,
    detail.publisher.as_deref(),
    best.publisher.as_ref(),
  );
  push_text(
    &mut out,
    MetadataField::PublishDate,
    detail.publish_date.as_deref(),
    best.publish_date.as_ref(),
  );
  push_text(&mut out, MetadataField::Isbn10, detail.isbn10.as_deref(), best.isbn10.as_ref());
  push_text(&mut out, MetadataField::Isbn13, detail.isbn13.as_deref(), best.isbn13.as_ref());
  push_text(
    &mut out,
    MetadataField::Description,
    detail.description.as_deref(),
    best.description.as_ref(),
  );
  push_text(
    &mut out,
    MetadataField::Language,
    detail.language.as_deref(),
    best.language.as_ref(),
  );
  push_text(
    &mut out,
    MetadataField::Series,
    detail.series.as_deref(),
    best.series.as_ref(),
  );
  push_text(
    &mut out,
    MetadataField::CoverUrl,
    detail.cover_url.as_deref(),
    best.cover_url.as_ref(),
  );
  out
}

fn manual_override_fields_to_metadata_fields(fields: &std::collections::HashSet<String>) -> Vec<MetadataField> {
  let mut out = Vec::new();
  for field in fields {
    let mapped = match field.as_str() {
      "title" => Some(MetadataField::Title),
      "subtitle" => Some(MetadataField::Subtitle),
      "authors_json" => Some(MetadataField::Authors),
      "publisher" => Some(MetadataField::Publisher),
      "publish_date" => Some(MetadataField::PublishDate),
      "isbn10" => Some(MetadataField::Isbn10),
      "isbn13" => Some(MetadataField::Isbn13),
      "description" => Some(MetadataField::Description),
      "language" => Some(MetadataField::Language),
      "page_count" => Some(MetadataField::PageCount),
      "series" => Some(MetadataField::Series),
      "series_index" => Some(MetadataField::SeriesIndex),
      "cover_url" => Some(MetadataField::CoverUrl),
      _ => None,
    };
    if let Some(value) = mapped {
      out.push(value);
    }
  }
  out.sort_by_key(|field| format!("{field:?}"));
  out
}

fn split_isbn_columns(raw_isbn: Option<&str>) -> (String, String) {
  let Some(raw_value) = raw_isbn else {
    return (String::new(), String::new());
  };
  let Some(normalized) = normalize_valid_isbn(raw_value) else {
    return (String::new(), String::new());
  };
  if normalized.len() == 10 {
    (normalized, String::new())
  } else if normalized.len() == 13 {
    (String::new(), normalized)
  } else {
    (String::new(), String::new())
  }
}

fn assign_isbn_columns(
  metadata: &mut ParsedMetadata,
  isbn10: Option<String>,
  isbn13: Option<String>,
  fallback_isbn: Option<String>,
) {
  if let Some(value) = isbn10 {
    if let Some(normalized) = normalize_valid_isbn(&value) {
      if normalized.len() == 10 {
        metadata.isbn10 = Some(normalized);
      }
    }
  }
  if let Some(value) = isbn13 {
    if let Some(normalized) = normalize_valid_isbn(&value) {
      if normalized.len() == 13 {
        metadata.isbn13 = Some(normalized);
      }
    }
  }
  if metadata.isbn10.is_none() && metadata.isbn13.is_none() {
    if let Some(value) = fallback_isbn {
      if let Some(normalized) = normalize_valid_isbn(&value) {
        if normalized.len() == 10 {
          metadata.isbn10 = Some(normalized);
        } else if normalized.len() == 13 {
          metadata.isbn13 = Some(normalized);
        }
      }
    }
  }
}

fn build_csv_book_patch(row: &HashMap<String, String>) -> (BookPatch, Vec<String>) {
  let mut patch = BookPatch::default();
  patch.title = csv_value(row, &["title"]);
  patch.subtitle = csv_value(row, &["subtitle"]);
  patch.authors = csv_value(row, &["authors", "author"])
    .map(|value| parse_csv_list(&value))
    .filter(|items| !items.is_empty());
  patch.publisher = csv_value(row, &["publisher"]);
  patch.publish_date = csv_value(row, &["publish_date", "publishdate", "published"]);
  patch.description = csv_value(row, &["description"]);
  patch.language = csv_value(row, &["language"]);
  patch.page_count = csv_value(row, &["page_count", "pagecount", "pages"]).and_then(parse_i64_value);
  patch.series = csv_value(row, &["series"]);
  patch.series_index = csv_value(row, &["series_index", "seriesindex"]).and_then(parse_i64_value);
  patch.cover_url = csv_value(row, &["cover_url", "coverurl"]);

  // Reassign normalized ISBN values directly on the patch.
  if let Some(value) = csv_value(row, &["isbn10"]) {
    if let Some(normalized) = normalize_valid_isbn(&value).filter(|isbn| isbn.len() == 10) {
      patch.isbn10 = Some(normalized);
    }
  }
  if let Some(value) = csv_value(row, &["isbn13"]) {
    if let Some(normalized) = normalize_valid_isbn(&value).filter(|isbn| isbn.len() == 13) {
      patch.isbn13 = Some(normalized);
    }
  }
  if patch.isbn10.is_none() && patch.isbn13.is_none() {
    if let Some(value) = csv_value(row, &["isbn"]) {
      if let Some(normalized) = normalize_valid_isbn(&value) {
        if normalized.len() == 10 {
        patch.isbn10 = Some(normalized);
        } else if normalized.len() == 13 {
          patch.isbn13 = Some(normalized);
        }
      }
    }
  }

  let tags = csv_value(row, &["tags"])
    .map(|value| parse_csv_list(&value))
    .unwrap_or_default();

  (patch, tags)
}

fn has_patch_updates(patch: &BookPatch) -> bool {
  patch.title.is_some()
    || patch.subtitle.is_some()
    || patch.authors.is_some()
    || patch.publisher.is_some()
    || patch.publish_date.is_some()
    || patch.isbn10.is_some()
    || patch.isbn13.is_some()
    || patch.description.is_some()
    || patch.language.is_some()
    || patch.page_count.is_some()
    || patch.series.is_some()
    || patch.series_index.is_some()
    || patch.cover_url.is_some()
}

fn normalize_book_patch_isbns(patch: &mut BookPatch) {
  if let Some(value) = patch.isbn10.take() {
    patch.isbn10 = Some(normalize_isbn(&value));
  }
  if let Some(value) = patch.isbn13.take() {
    patch.isbn13 = Some(normalize_isbn(&value));
  }
}

fn normalize_manual_create_patch(patch: &mut BookPatch) -> anyhow::Result<()> {
  let title = normalized_non_empty_text(patch.title.take()).ok_or_else(|| anyhow!("Title is required"))?;
  patch.title = Some(title);
  patch.subtitle = normalized_non_empty_text(patch.subtitle.take());
  patch.publisher = normalized_non_empty_text(patch.publisher.take());
  patch.publish_date = normalized_non_empty_text(patch.publish_date.take());
  patch.isbn10 = normalized_non_empty_text(patch.isbn10.take());
  patch.isbn13 = normalized_non_empty_text(patch.isbn13.take());
  patch.description = normalized_non_empty_text(patch.description.take());
  patch.language = normalized_non_empty_text(patch.language.take());
  patch.series = normalized_non_empty_text(patch.series.take());
  patch.cover_url = normalized_non_empty_text(patch.cover_url.take());
  patch.authors = patch
    .authors
    .take()
    .map(|authors| {
      authors
        .into_iter()
        .filter_map(|author| normalized_non_empty_text(Some(author)))
        .collect::<Vec<_>>()
    })
    .filter(|authors| !authors.is_empty());
  Ok(())
}

fn normalized_non_empty_text(value: Option<String>) -> Option<String> {
  let trimmed = value?.trim().to_string();
  if trimmed.is_empty() {
    None
  } else {
    Some(trimmed)
  }
}

fn validate_book_patch_cover_url(patch: &mut BookPatch) -> anyhow::Result<()> {
  if let Some(value) = patch.cover_url.take() {
    patch.cover_url = Some(validate_cover_url_value(value)?);
  }
  Ok(())
}

fn validate_metadata_selection_cover_urls(selection: &mut [MetadataFieldSelection]) -> anyhow::Result<()> {
  for selected in selection {
    if selected.field == MetadataField::CoverUrl {
      if let Some(value) = selected.value.take() {
        selected.value = Some(validate_cover_url_value(value)?);
      }
    }
  }
  Ok(())
}

fn validate_cover_url_value(value: String) -> anyhow::Result<String> {
  let trimmed = value.trim();
  if trimmed.is_empty() {
    return Ok(String::new());
  }
  ensure!(trimmed.len() <= 2048, "Cover URL is too long");

  let parsed = Url::parse(trimmed).map_err(|_| anyhow!("Cover URL must be a valid URL"))?;
  let host = parsed.host_str().unwrap_or_default();
  // Cover URLs are rendered as image sources; keep persisted values aligned with the app CSP.
  let allowed = parsed.scheme() == "https"
    || parsed.scheme() == "asset"
    || (parsed.scheme() == "http" && host.eq_ignore_ascii_case("asset.localhost"));
  ensure!(allowed, "Cover URL must use HTTPS or a local Tauri asset URL");

  Ok(trimmed.to_string())
}

fn validate_csv_import_path(path: &str) -> anyhow::Result<fs::Metadata> {
  let candidate = Path::new(path);
  ensure!(
    has_csv_extension(candidate),
    "CSV import file must have a .csv extension"
  );

  let metadata = fs::metadata(candidate).context("failed to access CSV import file")?;
  ensure!(metadata.is_file(), "CSV import path must be a file");
  ensure!(
    metadata.len() <= MAX_CSV_IMPORT_BYTES,
    "CSV import file must be 25 MB or smaller"
  );
  Ok(metadata)
}

fn validate_csv_export_path(path: &str) -> anyhow::Result<()> {
  ensure!(
    has_csv_extension(Path::new(path)),
    "CSV export file must have a .csv extension"
  );
  Ok(())
}

fn has_csv_extension(path: &Path) -> bool {
  path
    .extension()
    .and_then(|ext| ext.to_str())
    .map(|ext| ext.eq_ignore_ascii_case("csv"))
    .unwrap_or(false)
}

fn validate_tag_inputs(tags: &[String]) -> anyhow::Result<()> {
  ensure!(
    tags.len() <= MAX_TAGS_PER_REQUEST,
    "A tag request can include at most 100 tags"
  );
  for tag in tags {
    validate_tag_value(tag)?;
  }
  Ok(())
}

fn validate_tag_value(tag: &str) -> anyhow::Result<()> {
  let normalized = tag.split_whitespace().collect::<Vec<_>>().join(" ");
  ensure!(
    normalized.chars().count() <= MAX_TAG_LABEL_CHARS,
    "Tag labels must be 80 characters or fewer"
  );
  Ok(())
}

fn validate_book_id_batch(book_ids: &[String]) -> anyhow::Result<()> {
  ensure!(
    book_ids.len() <= MAX_BOOK_IDS_PER_REQUEST,
    "A book batch can include at most 500 IDs"
  );
  Ok(())
}

fn validate_metadata_update_batch(
  selection: &[MetadataFieldSelection],
  lock_updates: &[MetadataLockUpdate],
) -> anyhow::Result<()> {
  ensure!(
    selection.len() <= MAX_METADATA_FIELD_UPDATES,
    "Metadata selection can include at most 32 fields"
  );
  ensure!(
    lock_updates.len() <= MAX_METADATA_FIELD_UPDATES,
    "Metadata lock updates can include at most 32 fields"
  );
  Ok(())
}

fn validate_search_query(query: &Option<String>) -> anyhow::Result<()> {
  if let Some(value) = query {
    ensure!(
      value.chars().count() <= MAX_SEARCH_QUERY_CHARS,
      "Search query must be 256 characters or fewer"
    );
  }
  Ok(())
}

fn normalize_google_books_api_key(input: &str) -> anyhow::Result<String> {
  let trimmed = input.trim();
  if trimmed.is_empty() {
    return Err(anyhow!("Google Books API key is required"));
  }
  if trimmed.len() < 20 || trimmed.len() > 256 {
    return Err(anyhow!("Google Books API key must be between 20 and 256 characters"));
  }
  if trimmed
    .chars()
    .any(|ch| ch.is_whitespace() || !ch.is_ascii_graphic())
  {
    return Err(anyhow!("Google Books API key must not contain whitespace or control characters"));
  }
  Ok(trimmed.to_string())
}

#[cfg(target_os = "windows")]
fn open_file_with_system_app(path: &Path) -> anyhow::Result<()> {
  let mut command = Command::new("explorer.exe");
  command.arg(path.as_os_str());
  command.creation_flags(0x08000000);
  command
    .spawn()
    .with_context(|| format!("failed to open file {}", path.display()))?;
  Ok(())
}

#[cfg(target_os = "macos")]
fn open_file_with_system_app(path: &Path) -> anyhow::Result<()> {
  Command::new("open")
    .arg(path.as_os_str())
    .spawn()
    .with_context(|| format!("failed to open file {}", path.display()))?;
  Ok(())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_file_with_system_app(path: &Path) -> anyhow::Result<()> {
  Command::new("xdg-open")
    .arg(path.as_os_str())
    .spawn()
    .with_context(|| format!("failed to open file {}", path.display()))?;
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::{
    csv_import_progress_percent, normalize_book_patch_isbns, validate_book_id_batch, validate_cover_url_value,
    validate_csv_export_path, validate_csv_import_path, validate_metadata_update_batch, validate_search_query,
    validate_tag_inputs, MAX_CSV_IMPORT_BYTES,
  };
  use crate::library::scanner::{is_weak_lookup_key, lookup_skip_reason, parsed_metadata_improves_lookup};
  use crate::library::types::{BookPatch, MetadataField, MetadataFieldSelection, MetadataLockUpdate, ParsedMetadata};
  use std::{fs, path::PathBuf};
  use uuid::Uuid;

  #[test]
  fn weak_lookup_key_flags_generic_or_missing_titles_without_isbn() {
    let missing = ParsedMetadata::default();
    assert_eq!(lookup_skip_reason(&missing), Some("missing_lookup_keys"));

    let generic = ParsedMetadata {
      title: Some("Unknown".to_string()),
      ..Default::default()
    };
    assert_eq!(lookup_skip_reason(&generic), Some("weak_lookup_keys"));
    assert!(is_weak_lookup_key(&generic));
  }

  #[test]
  fn weak_lookup_key_allows_strong_title_author_or_isbn() {
    let strong = ParsedMetadata {
      title: Some("Ethics for Christian Ministry".to_string()),
      authors: vec!["Joe E. Trull".to_string()],
      ..Default::default()
    };
    assert_eq!(lookup_skip_reason(&strong), None);
    assert!(!is_weak_lookup_key(&strong));

    let isbn_only = ParsedMetadata {
      isbn13: Some("9780441172719".to_string()),
      ..Default::default()
    };
    assert_eq!(lookup_skip_reason(&isbn_only), None);
    assert!(!is_weak_lookup_key(&isbn_only));
  }

  #[test]
  fn parsed_metadata_improves_lookup_when_isbn_or_author_is_added() {
    let original = ParsedMetadata {
      title: Some("Instruments in the Redeemer's H".to_string()),
      ..Default::default()
    };
    let parsed = ParsedMetadata {
      title: Some("Instruments in the Redeemer's Hands".to_string()),
      authors: vec!["Paul David Tripp".to_string()],
      ..Default::default()
    };
    assert!(parsed_metadata_improves_lookup(&original, &parsed));

    let parsed_with_isbn = ParsedMetadata {
      isbn13: Some("9781590520420".to_string()),
      ..Default::default()
    };
    assert!(parsed_metadata_improves_lookup(&original, &parsed_with_isbn));
  }

  #[test]
  fn parsed_metadata_improves_lookup_false_when_nothing_new_is_added() {
    let original = ParsedMetadata {
      title: Some("Dune".to_string()),
      authors: vec!["Frank Herbert".to_string()],
      ..Default::default()
    };
    let parsed = ParsedMetadata {
      title: Some("Dune".to_string()),
      authors: vec!["Frank Herbert".to_string()],
      ..Default::default()
    };
    assert!(!parsed_metadata_improves_lookup(&original, &parsed));
  }

  #[test]
  fn manual_book_patch_isbns_are_normalized() {
    let mut patch = BookPatch {
      isbn10: Some("1-234-56789-x".to_string()),
      isbn13: Some("978 1 4028 9462 6".to_string()),
      ..Default::default()
    };

    normalize_book_patch_isbns(&mut patch);

    assert_eq!(patch.isbn10.as_deref(), Some("123456789X"));
    assert_eq!(patch.isbn13.as_deref(), Some("9781402894626"));
  }

  #[test]
  fn cover_url_validation_allows_https_and_tauri_assets() {
    assert_eq!(
      validate_cover_url_value(" https://example.com/cover.jpg ".to_string()).unwrap(),
      "https://example.com/cover.jpg"
    );
    assert_eq!(
      validate_cover_url_value("http://asset.localhost/asset?path=cover.jpg".to_string()).unwrap(),
      "http://asset.localhost/asset?path=cover.jpg"
    );
    assert_eq!(
      validate_cover_url_value("asset://localhost/cover.jpg".to_string()).unwrap(),
      "asset://localhost/cover.jpg"
    );
    assert_eq!(validate_cover_url_value("   ".to_string()).unwrap(), "");
  }

  #[test]
  fn cover_url_validation_rejects_unsafe_or_unloadable_schemes() {
    for value in [
      "javascript:alert(1)",
      "data:image/svg+xml,<svg></svg>",
      "file:///C:/Users/example/cover.jpg",
      "http://example.com/cover.jpg",
    ] {
      assert!(validate_cover_url_value(value.to_string()).is_err(), "{value}");
    }
  }

  #[test]
  fn csv_import_path_validation_accepts_regular_csv_files() {
    let file = temp_test_path("valid.csv");
    fs::write(&file, "file_id,title\n1,Dune\n").expect("write csv");
    let metadata = validate_csv_import_path(file.to_str().unwrap()).expect("validate csv");
    assert!(metadata.is_file());
    let _ = fs::remove_file(file);
  }

  #[test]
  fn csv_import_path_validation_rejects_non_csv_or_large_files() {
    let txt_file = temp_test_path("invalid.txt");
    fs::write(&txt_file, "not,csv\n").expect("write txt");
    assert!(validate_csv_import_path(txt_file.to_str().unwrap()).is_err());
    let _ = fs::remove_file(txt_file);

    let large_file = temp_test_path("large.csv");
    let file = fs::File::create(&large_file).expect("create large csv");
    file.set_len(MAX_CSV_IMPORT_BYTES + 1).expect("size large csv");
    assert!(validate_csv_import_path(large_file.to_str().unwrap()).is_err());
    let _ = fs::remove_file(large_file);
  }

  #[test]
  fn csv_export_path_validation_requires_csv_extension() {
    assert!(validate_csv_export_path("library.CSV").is_ok());
    assert!(validate_csv_export_path("library.txt").is_err());
  }

  #[test]
  fn tag_validation_limits_request_size_and_label_length() {
    let valid_tags = vec!["fiction".to_string(), "church history".to_string()];
    assert!(validate_tag_inputs(&valid_tags).is_ok());

    let too_many = vec!["tag".to_string(); 101];
    assert!(validate_tag_inputs(&too_many).is_err());

    let too_long = vec!["a".repeat(81)];
    assert!(validate_tag_inputs(&too_long).is_err());
  }

  #[test]
  fn book_id_batch_validation_limits_request_size() {
    let valid_batch = vec!["book".to_string(); 500];
    assert!(validate_book_id_batch(&valid_batch).is_ok());

    let too_many = vec!["book".to_string(); 501];
    assert!(validate_book_id_batch(&too_many).is_err());
  }

  #[test]
  fn metadata_update_batch_validation_limits_field_counts() {
    let selection = vec![
      MetadataFieldSelection {
        field: MetadataField::Title,
        candidate_id: None,
        value: Some("Dune".to_string()),
        values: None,
        int_value: None,
      };
      33
    ];
    assert!(validate_metadata_update_batch(&selection, &[]).is_err());

    let lock_updates = vec![
      MetadataLockUpdate {
        field: MetadataField::Title,
        locked: true,
      };
      33
    ];
    assert!(validate_metadata_update_batch(&[], &lock_updates).is_err());
  }

  #[test]
  fn search_query_validation_limits_length() {
    assert!(validate_search_query(&None).is_ok());
    assert!(validate_search_query(&Some("a".repeat(256))).is_ok());
    assert!(validate_search_query(&Some("a".repeat(257))).is_err());
  }

  #[test]
  fn csv_import_progress_percent_returns_zero_when_total_is_zero() {
    assert_eq!(csv_import_progress_percent(0, 0, false), 0);
    assert_eq!(csv_import_progress_percent(500, 0, false), 0);
  }

  #[test]
  fn csv_import_progress_percent_tracks_partial_progress() {
    assert_eq!(csv_import_progress_percent(50, 100, false), 50);
    assert_eq!(csv_import_progress_percent(25, 100, false), 25);
  }

  #[test]
  fn csv_import_progress_percent_caps_in_progress_at_ninety_nine() {
    assert_eq!(csv_import_progress_percent(100, 100, false), 99);
    assert_eq!(csv_import_progress_percent(200, 100, false), 99);
  }

  #[test]
  fn csv_import_progress_percent_is_one_hundred_when_completed() {
    assert_eq!(csv_import_progress_percent(0, 0, true), 100);
    assert_eq!(csv_import_progress_percent(100, 100, true), 100);
  }

  fn temp_test_path(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!("lumina-library-{}-{name}", Uuid::new_v4()))
  }
}
