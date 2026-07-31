use std::{
  collections::{HashMap, HashSet},
  ffi::OsStr,
  fs,
  path::{Path, PathBuf},
  sync::{mpsc, Arc, Mutex as StdMutex},
  thread,
  time::{Duration, Instant},
};

use anyhow::{anyhow, Context};
use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::Mutex;
use serde_json::json;
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

const WATCHER_EVENT_QUEUE_CAPACITY: usize = 256;

use crate::library::cover_cache::CoverCache;
use crate::library::db::Repository;
use crate::library::metadata::{
  compute_sha256, infer_metadata_from_filename, normalize_text,
  parse_metadata,
  OpenLibraryEnricher,
  AUTO_MATCH_THRESHOLD,
};
use crate::library::types::{
  EnrichedBook, FileProcessingOutcome, FileRecord, LibraryFolder,
  ParsedMetadata, ScanSummary, UpsertBookInput, UpsertFilePayload,
};

use super::service::{now_iso, system_time_to_iso};
#[derive(Clone)]
pub(crate) struct Scanner {
  repository: Repository,
  pub(crate) enricher: OpenLibraryEnricher,
  pub(crate) app_handle: AppHandle,
  cover_cache: CoverCache,
  last_google_quota_notice: Arc<StdMutex<Option<String>>>,
}

const FILE_PARSE_SLOW_THRESHOLD: Duration = Duration::from_secs(20);
const FILE_HASH_SLOW_THRESHOLD: Duration = Duration::from_secs(12);
const MAX_SCAN_WORKERS: usize = 2;
const SCAN_WORK_QUEUE_CAPACITY: usize = 64;
const ENRICHMENT_WORKERS: usize = 2;
const ENRICHMENT_RATE_LIMIT_PER_SECOND: u64 = 3;
const PDF_PARSE_SKIP_SIZE_BYTES: i64 = 256 * 1024 * 1024;
const HASH_SKIP_SIZE_BYTES: i64 = 128 * 1024 * 1024;

#[derive(Clone)]
struct ScanCandidate {
  path: PathBuf,
  abs_path: String,
  ext: String,
  size_bytes: Option<i64>,
  mtime_utc: Option<String>,
  is_unchanged: bool,
  prepare_error: Option<String>,
}

impl ScanCandidate {
  fn is_unchanged(&self) -> bool {
    self.is_unchanged
  }
}

#[derive(Clone)]
struct PendingEnrichment {
  file_id: String,
  abs_path: String,
  metadata: ParsedMetadata,
}

struct ScanPreparedOutcome {
  outcome: FileProcessingOutcome,
  parse_ms: u64,
  hash_ms: u64,
  skip_reason: Option<String>,
  pending_enrichment: Option<PendingEnrichment>,
}

struct EnrichmentTaskOutcome {
  outcome: FileProcessingOutcome,
  enrich_ms: u64,
}

#[derive(Clone, Copy)]
enum ScanComputeProfile {
  BulkSafe,
  Full,
}

impl Scanner {
  pub(crate) fn new(
    repository: Repository,
    enricher: OpenLibraryEnricher,
    app_handle: AppHandle,
    cover_cache: CoverCache,
  ) -> Self {
    Self {
      repository,
      enricher,
      app_handle,
      cover_cache,
      last_google_quota_notice: Arc::new(StdMutex::new(None)),
    }
  }

  pub(crate) fn set_google_books_api_key(&self, api_key: Option<String>) {
    self.enricher.set_google_books_api_key(api_key);
  }

  pub(crate) fn google_books_api_key_configured(&self) -> bool {
    self.enricher.google_books_api_key_configured()
  }

  pub(crate) fn scan(&self, folder_id: Option<String>) -> anyhow::Result<ScanSummary> {
    let folders = if let Some(id) = folder_id {
      vec![
        self
          .repository
          .get_folder(&id)?
          .ok_or_else(|| anyhow!("folder not found"))?,
      ]
    } else {
      self.repository.list_folders()?
    };

    let mut summary = ScanSummary::default();
    for folder in folders {
      log::info!("scan_folder_start folder_id={} path={}", folder.id, folder.path);
      let result = self.scan_folder(&folder)?;
      log::info!(
        "scan_folder_done folder_id={} scanned={} new={} updated={} unchanged={} matched={} discovered={} errors={}",
        folder.id,
        result.scanned_files,
        result.new_files,
        result.updated_files,
        result.unchanged_files,
        result.matched_files,
        result.discovered_files,
        result.errors
      );
      summary.scanned_files += result.scanned_files;
      summary.new_files += result.new_files;
      summary.updated_files += result.updated_files;
      summary.unchanged_files += result.unchanged_files;
      summary.matched_files += result.matched_files;
      summary.discovered_files += result.discovered_files;
      summary.removed_files += result.removed_files;
      summary.errors += result.errors;
    }
    let _ = self.app_handle.emit("scan_completed", &summary);
    Ok(summary)
  }

  pub(crate) fn rescan_missing_metadata(&self) -> anyhow::Result<ScanSummary> {
    let candidates = self.repository.list_files_needing_metadata_refresh()?;
    let total = candidates.len() as u64;
    let mut summary = ScanSummary::default();
    let mut folder_cache: HashMap<String, Option<LibraryFolder>> = HashMap::new();
    let mut processed = 0u64;
    let mut pending_enrichment: Vec<PendingEnrichment> = Vec::new();
    let refresh_folder_id = "metadata_refresh";

    let _ = self.app_handle.emit(
      "scan_progress",
      json!({
        "phase": "local_scan",
        "folderId": refresh_folder_id,
        "totalFound": total,
        "pendingFiles": total,
        "processedFiles": processed,
        "newFiles": summary.new_files,
        "updatedFiles": summary.updated_files,
        "unchangedFiles": summary.unchanged_files,
        "matchedFiles": summary.matched_files,
        "discoveredFiles": summary.discovered_files,
        "errors": summary.errors,
      }),
    );

    for file in candidates {
      summary.scanned_files += 1;
      processed += 1;

      let path = Path::new(&file.abs_path);
      if !path.exists() {
        summary.errors += 1;
        let now = now_iso();
        let _ = self.repository.mark_file_missing(&file.id, true, &now);
        let _ = self.app_handle.emit(
          "scan_progress",
          json!({
            "phase": "local_scan",
            "folderId": refresh_folder_id,
            "path": file.abs_path,
            "error": "file_not_found",
            "totalFound": total,
            "pendingFiles": total,
            "processedFiles": processed,
            "newFiles": summary.new_files,
            "updatedFiles": summary.updated_files,
            "unchangedFiles": summary.unchanged_files,
            "matchedFiles": summary.matched_files,
            "discoveredFiles": summary.discovered_files,
            "errors": summary.errors,
          }),
        );
        continue;
      }

      let folder = match folder_cache.get(&file.folder_id) {
        Some(cached) => cached.clone(),
        None => {
          let resolved = self.repository.get_folder(&file.folder_id)?;
          folder_cache.insert(file.folder_id.clone(), resolved.clone());
          resolved
        }
      };

      let Some(folder) = folder else {
        summary.errors += 1;
        let _ = self.app_handle.emit(
          "scan_progress",
          json!({
            "phase": "local_scan",
            "folderId": refresh_folder_id,
            "path": file.abs_path,
            "error": "folder_not_found",
            "totalFound": total,
            "pendingFiles": total,
            "processedFiles": processed,
            "newFiles": summary.new_files,
            "updatedFiles": summary.updated_files,
            "unchangedFiles": summary.unchanged_files,
            "matchedFiles": summary.matched_files,
            "discoveredFiles": summary.discovered_files,
            "errors": summary.errors,
          }),
        );
        continue;
      };

      let ext = path
        .extension()
        .and_then(OsStr::to_str)
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_else(|| file.ext.to_ascii_lowercase());
      let (size_bytes, mtime_utc) = match fs::metadata(path) {
        Ok(fs_metadata) => {
          let size_bytes = fs_metadata.len() as i64;
          let mtime_utc = fs_metadata
            .modified()
            .ok()
            .map(system_time_to_iso)
            .unwrap_or_else(now_iso);
          (size_bytes, mtime_utc)
        }
        Err(err) => {
          summary.errors += 1;
          let _ = self.app_handle.emit(
            "scan_progress",
            json!({
              "phase": "local_scan",
              "folderId": refresh_folder_id,
              "path": file.abs_path,
              "error": format!("metadata read failed: {err}"),
              "totalFound": total,
              "pendingFiles": total,
              "processedFiles": processed,
              "newFiles": summary.new_files,
              "updatedFiles": summary.updated_files,
              "unchangedFiles": summary.unchanged_files,
              "matchedFiles": summary.matched_files,
              "discoveredFiles": summary.discovered_files,
              "errors": summary.errors,
            }),
          );
          continue;
        }
      };

      let candidate = ScanCandidate {
        path: path.to_path_buf(),
        abs_path: file.abs_path.clone(),
        ext,
        size_bytes: Some(size_bytes),
        mtime_utc: Some(mtime_utc),
        is_unchanged: false,
        prepare_error: None,
      };

      match self.scan_prepared_candidate(&folder, &candidate, Some(&file), ScanComputeProfile::BulkSafe, true) {
        Ok(prepared) => {
          if prepared.outcome.reason == "new" {
            summary.new_files += 1;
          } else {
            summary.updated_files += 1;
          }
          if let Some(job) = prepared.pending_enrichment {
            pending_enrichment.push(job);
          } else if prepared.outcome.book_id.is_some() {
            summary.matched_files += 1;
          } else {
            summary.discovered_files += 1;
          }
          let _ = self.app_handle.emit(
            "scan_progress",
            json!({
              "phase": "local_scan",
              "folderId": folder.id,
              "fileId": prepared.outcome.file.id,
              "path": prepared.outcome.file.abs_path,
              "status": prepared.outcome.file.status,
              "bookId": prepared.outcome.book_id,
              "parseMs": prepared.parse_ms,
              "hashMs": prepared.hash_ms,
              "skipReason": prepared.skip_reason,
              "totalFound": total,
              "pendingFiles": total,
              "processedFiles": processed,
              "newFiles": summary.new_files,
              "updatedFiles": summary.updated_files,
              "unchangedFiles": summary.unchanged_files,
              "matchedFiles": summary.matched_files,
              "discoveredFiles": summary.discovered_files,
              "errors": summary.errors,
            }),
          );
        }
        Err(err) => {
          summary.errors += 1;
          let _ = self.app_handle.emit(
            "scan_progress",
            json!({
              "phase": "local_scan",
              "folderId": folder.id,
              "path": file.abs_path,
              "error": err.to_string(),
              "totalFound": total,
              "pendingFiles": total,
              "processedFiles": processed,
              "newFiles": summary.new_files,
              "updatedFiles": summary.updated_files,
              "unchangedFiles": summary.unchanged_files,
              "matchedFiles": summary.matched_files,
              "discoveredFiles": summary.discovered_files,
              "errors": summary.errors,
            }),
          );
        }
      }
    }

    if !pending_enrichment.is_empty() {
      self.run_enrichment_queue(refresh_folder_id, pending_enrichment, &mut summary)?;
    }

    let _ = self.app_handle.emit(
      "scan_progress",
      json!({
        "phase": "completed",
        "folderId": refresh_folder_id,
        "totalFound": total,
        "pendingFiles": total,
        "processedFiles": processed,
        "newFiles": summary.new_files,
        "updatedFiles": summary.updated_files,
        "unchangedFiles": summary.unchanged_files,
        "matchedFiles": summary.matched_files,
        "discoveredFiles": summary.discovered_files,
        "errors": summary.errors,
      }),
    );
    let _ = self.app_handle.emit("scan_completed", &summary);
    Ok(summary)
  }

  pub(crate) fn refresh_missing_covers(&self) -> anyhow::Result<ScanSummary> {
    let candidates = self.repository.list_book_ids_missing_cover()?;
    let total = candidates.len() as u64;
    let mut summary = ScanSummary::default();
    let mut processed = 0u64;
    let refresh_folder_id = "cover_refresh";

    let _ = self.app_handle.emit(
      "scan_progress",
      json!({
        "phase": "started",
        "folderId": refresh_folder_id,
        "totalFound": total,
        "pendingFiles": total,
        "processedFiles": processed,
        "newFiles": summary.new_files,
        "updatedFiles": summary.updated_files,
        "unchangedFiles": summary.unchanged_files,
        "matchedFiles": summary.matched_files,
        "discoveredFiles": summary.discovered_files,
        "errors": summary.errors,
      }),
    );

    for book_id in candidates {
      summary.scanned_files += 1;
      processed += 1;

      let outcome = (|| -> anyhow::Result<(String, bool)> {
        let detail = self.repository.get_book_detail(&book_id)?;
        let metadata = ParsedMetadata::from(&detail);

        let existing_cover_url = detail.cover_url.clone();
        let cover_url = self.enricher.resolve_cover_only(&metadata, existing_cover_url.clone());
        self.emit_google_books_quota_notice_if_needed();
        let now = now_iso();
        if let Some(url) = cover_url {
          self.repository.set_book_cover_url(&detail.id, &url, &now)?;
          self.cache_book_cover_if_needed(&detail.id);
          Ok((detail.title, true))
        } else if existing_cover_url
          .as_deref()
          .map(|url| self.enricher.is_google_placeholder_cover_url(url))
          .unwrap_or(false)
        {
          self.repository.clear_book_cover_url(&detail.id, &now)?;
          Ok((detail.title, true))
        } else {
          Ok((detail.title, false))
        }
      })();

      match outcome {
        Ok((title, updated)) => {
          if updated {
            summary.updated_files += 1;
            summary.matched_files += 1;
          } else {
            summary.unchanged_files += 1;
          }
          let _ = self.app_handle.emit(
            "scan_progress",
            json!({
              "phase": "progress",
              "folderId": refresh_folder_id,
              "bookId": book_id,
              "path": title,
              "status": if updated { "cover_updated" } else { "cover_missing" },
              "totalFound": total,
              "pendingFiles": total,
              "processedFiles": processed,
              "newFiles": summary.new_files,
              "updatedFiles": summary.updated_files,
              "unchangedFiles": summary.unchanged_files,
              "matchedFiles": summary.matched_files,
              "discoveredFiles": summary.discovered_files,
              "errors": summary.errors,
            }),
          );
        }
        Err(err) => {
          summary.errors += 1;
          let _ = self.app_handle.emit(
            "scan_progress",
            json!({
              "phase": "progress",
              "folderId": refresh_folder_id,
              "bookId": book_id,
              "error": err.to_string(),
              "totalFound": total,
              "pendingFiles": total,
              "processedFiles": processed,
              "newFiles": summary.new_files,
              "updatedFiles": summary.updated_files,
              "unchangedFiles": summary.unchanged_files,
              "matchedFiles": summary.matched_files,
              "discoveredFiles": summary.discovered_files,
              "errors": summary.errors,
            }),
          );
        }
      }
    }

    let _ = self.app_handle.emit(
      "scan_progress",
      json!({
        "phase": "completed",
        "folderId": refresh_folder_id,
        "totalFound": total,
        "pendingFiles": total,
        "processedFiles": processed,
        "newFiles": summary.new_files,
        "updatedFiles": summary.updated_files,
        "unchangedFiles": summary.unchanged_files,
        "matchedFiles": summary.matched_files,
        "discoveredFiles": summary.discovered_files,
        "errors": summary.errors,
      }),
    );

    Ok(summary)
  }

  pub(crate) fn scan_folder(&self, folder: &LibraryFolder) -> anyhow::Result<ScanSummary> {
    let mut summary = ScanSummary::default();
    let mut seen_paths: HashSet<String> = HashSet::new();
    let mut processed_since_emit = 0usize;
    let mut last_emit = Instant::now();
    const PROGRESS_BATCH_SIZE: usize = 25;
    const PROGRESS_EMIT_INTERVAL: Duration = Duration::from_millis(750);
    let mut processed_files = 0u64;
    let existing_files = self.repository.list_files_for_folder(&folder.id)?;
    let existing_by_path: HashMap<String, FileRecord> = existing_files
      .into_iter()
      .map(|file| (file.abs_path.clone(), file))
      .collect();
    let mut candidates: Vec<ScanCandidate> = Vec::new();
    self.for_each_scan_candidate(folder, &existing_by_path, |candidate| {
      candidates.push(candidate);
    })?;
    let total_found = candidates.len() as u64;
    let prepare_error_known = candidates
      .iter()
      .filter(|candidate| candidate.prepare_error.is_some())
      .count() as u64;
    let unchanged_known = candidates
      .iter()
      .filter(|candidate| candidate.prepare_error.is_none() && candidate.is_unchanged())
      .count() as u64;
    let pending_files = total_found.saturating_sub(unchanged_known + prepare_error_known);
    log::info!(
      "scan_folder_local_index folder_id={} total_found={} pending={} unchanged={} prep_errors={}",
      folder.id,
      total_found,
      pending_files,
      unchanged_known,
      prepare_error_known
    );
    log::info!(
      "scan_folder_profile folder_id={} profile=bulk_safe note='pdf metadata parsing and hashing are minimized during bulk indexing'",
      folder.id
    );

    let _ = self.app_handle.emit(
      "scan_progress",
      json!({
        "phase": "local_scan",
        "folderId": folder.id,
        "totalFound": total_found,
        "pendingFiles": pending_files,
        "processedFiles": processed_files,
        "newFiles": summary.new_files,
        "updatedFiles": summary.updated_files,
        "unchangedFiles": summary.unchanged_files,
        "matchedFiles": summary.matched_files,
        "discoveredFiles": summary.discovered_files,
        "errors": summary.errors,
      }),
    );

    let existing_by_path = Arc::new(existing_by_path);
    let mut pending_enrichment: Vec<PendingEnrichment> = Vec::new();
    let mut pending_candidates = Vec::with_capacity(pending_files as usize);

    for candidate in candidates {
      seen_paths.insert(candidate.abs_path.clone());
      summary.scanned_files += 1;

      if let Some(error) = candidate.prepare_error.clone() {
        summary.errors += 1;
        processed_files += 1;
        let _ = self.app_handle.emit(
          "scan_progress",
          json!({
            "phase": "local_scan",
            "folderId": folder.id,
            "path": candidate.abs_path,
            "error": error,
            "totalFound": total_found,
            "pendingFiles": pending_files,
            "processedFiles": processed_files,
            "newFiles": summary.new_files,
            "updatedFiles": summary.updated_files,
            "unchangedFiles": summary.unchanged_files,
            "matchedFiles": summary.matched_files,
            "discoveredFiles": summary.discovered_files,
            "errors": summary.errors,
          }),
        );
        processed_since_emit = 0;
        last_emit = Instant::now();
        continue;
      }

      if candidate.is_unchanged() {
        summary.unchanged_files += 1;
        processed_files += 1;
        processed_since_emit += 1;
        if processed_since_emit >= PROGRESS_BATCH_SIZE || last_emit.elapsed() >= PROGRESS_EMIT_INTERVAL {
          let _ = self.app_handle.emit(
            "scan_progress",
            json!({
              "phase": "local_scan",
              "folderId": folder.id,
              "path": candidate.abs_path,
              "totalFound": total_found,
              "pendingFiles": pending_files,
              "processedFiles": processed_files,
              "newFiles": summary.new_files,
              "updatedFiles": summary.updated_files,
              "unchangedFiles": summary.unchanged_files,
              "matchedFiles": summary.matched_files,
              "discoveredFiles": summary.discovered_files,
              "errors": summary.errors,
            }),
          );
          processed_since_emit = 0;
          last_emit = Instant::now();
        }
        continue;
      }

      pending_candidates.push(candidate);
    }

    let queued_for_processing = pending_candidates.len() as u64;
    let mut handles = Vec::new();
    if queued_for_processing > 0 {
      let worker_count = scan_worker_count().min(pending_candidates.len()).max(1);
      let work_iter = Arc::new(StdMutex::new(pending_candidates.into_iter()));
      let (prepared_tx, result_rx) =
        mpsc::sync_channel::<(String, anyhow::Result<ScanPreparedOutcome>)>(SCAN_WORK_QUEUE_CAPACITY);
      for _ in 0..worker_count {
        let work_iter = Arc::clone(&work_iter);
        let prepared_tx = prepared_tx.clone();
        let scanner = self.clone();
        let folder = folder.clone();
        let existing_by_path = Arc::clone(&existing_by_path);
        handles.push(thread::spawn(move || loop {
          let candidate = {
            let mut work = match work_iter.lock() {
              Ok(work) => work,
              Err(_) => return,
            };
            match work.next() {
              Some(candidate) => candidate,
              None => return,
            }
          };
          let path = candidate.abs_path.clone();
          let existing = existing_by_path.get(&candidate.abs_path);
          let result = scanner.scan_prepared_candidate(&folder, &candidate, existing, ScanComputeProfile::BulkSafe, false);
          if prepared_tx.send((path, result)).is_err() {
            return;
          }
        }));
      }
      drop(prepared_tx);

      for _ in 0..queued_for_processing {
        let Ok((candidate_path, result)) = result_rx.recv() else {
          break;
        };
        match result {
          Ok(prepared) => {
            match prepared.outcome.reason.as_str() {
              "new" => {
                summary.new_files += 1;
              }
              "updated" => {
                summary.updated_files += 1;
              }
              _ => {}
            }

            if let Some(job) = prepared.pending_enrichment {
              pending_enrichment.push(job);
            } else if prepared.outcome.book_id.is_some() {
              summary.matched_files += 1;
            } else {
              summary.discovered_files += 1;
            }

            processed_files += 1;
            processed_since_emit += 1;
            if processed_since_emit >= PROGRESS_BATCH_SIZE || last_emit.elapsed() >= PROGRESS_EMIT_INTERVAL {
              let _ = self.app_handle.emit(
                "scan_progress",
                json!({
                  "phase": "local_scan",
                  "folderId": folder.id,
                  "fileId": prepared.outcome.file.id,
                  "path": prepared.outcome.file.abs_path,
                  "status": prepared.outcome.file.status,
                  "bookId": prepared.outcome.book_id,
                  "parseMs": prepared.parse_ms,
                  "hashMs": prepared.hash_ms,
                  "skipReason": prepared.skip_reason,
                  "totalFound": total_found,
                  "pendingFiles": pending_files,
                  "processedFiles": processed_files,
                  "newFiles": summary.new_files,
                  "updatedFiles": summary.updated_files,
                  "unchangedFiles": summary.unchanged_files,
                  "matchedFiles": summary.matched_files,
                  "discoveredFiles": summary.discovered_files,
                  "errors": summary.errors,
                }),
              );
              processed_since_emit = 0;
              last_emit = Instant::now();
            }
          }
          Err(err) => {
            summary.errors += 1;
            processed_files += 1;
            let _ = self.app_handle.emit(
              "scan_progress",
              json!({
                "phase": "local_scan",
                "folderId": folder.id,
                "path": candidate_path,
                "error": err.to_string(),
                "totalFound": total_found,
                "pendingFiles": pending_files,
                "processedFiles": processed_files,
                "newFiles": summary.new_files,
                "updatedFiles": summary.updated_files,
                "unchangedFiles": summary.unchanged_files,
                "matchedFiles": summary.matched_files,
                "discoveredFiles": summary.discovered_files,
                "errors": summary.errors,
              }),
            );
            processed_since_emit = 0;
            last_emit = Instant::now();
          }
        }
      }
    }

    for handle in handles {
      let _ = handle.join();
    }

    let _ = self.app_handle.emit(
      "scan_progress",
      json!({
        "phase": "local_scan",
        "folderId": folder.id,
        "totalFound": total_found,
        "pendingFiles": pending_files,
        "processedFiles": processed_files,
        "newFiles": summary.new_files,
        "updatedFiles": summary.updated_files,
        "unchangedFiles": summary.unchanged_files,
        "matchedFiles": summary.matched_files,
        "discoveredFiles": summary.discovered_files,
        "errors": summary.errors,
      }),
    );

    if !pending_enrichment.is_empty() {
      self.run_enrichment_queue(&folder.id, pending_enrichment, &mut summary)?;
    }

    let now = now_iso();
    let removed = self.repository.mark_missing_files(&folder.id, &seen_paths, &now)?;
    summary.removed_files += removed;
    self.repository.update_folder_scan_time(&folder.id, &now)?;

    let _ = self.app_handle.emit(
      "scan_progress",
      json!({
        "phase": "completed",
        "folderId": folder.id,
        "totalFound": total_found,
        "pendingFiles": pending_files,
        "processedFiles": processed_files,
        "newFiles": summary.new_files,
        "updatedFiles": summary.updated_files,
        "unchangedFiles": summary.unchanged_files,
        "matchedFiles": summary.matched_files,
        "discoveredFiles": summary.discovered_files,
        "removedFiles": summary.removed_files,
        "errors": summary.errors,
      }),
    );
    Ok(summary)
  }

  fn run_enrichment_queue(
    &self,
    folder_id: &str,
    queue: Vec<PendingEnrichment>,
    summary: &mut ScanSummary,
  ) -> anyhow::Result<()> {
    let total = queue.len() as u64;
    if total == 0 {
      return Ok(());
    }
    log::info!("scan_enrichment_start folder_id={} queued={}", folder_id, total);

    let mut processed = 0u64;
    let _ = self.app_handle.emit(
      "scan_progress",
      json!({
        "phase": "enrichment_queue",
        "folderId": folder_id,
        "totalFound": total,
        "pendingFiles": total,
        "processedFiles": processed,
        "newFiles": summary.new_files,
        "updatedFiles": summary.updated_files,
        "unchangedFiles": summary.unchanged_files,
        "matchedFiles": summary.matched_files,
        "discoveredFiles": summary.discovered_files,
        "errors": summary.errors,
      }),
    );

    let worker_count = ENRICHMENT_WORKERS.min(queue.len()).max(1);
    let work_iter = Arc::new(StdMutex::new(queue.into_iter()));
    let rate_limiter = Arc::new(StdMutex::new(Instant::now()));
    let (result_tx, result_rx) =
      mpsc::sync_channel::<(String, anyhow::Result<EnrichmentTaskOutcome>)>(SCAN_WORK_QUEUE_CAPACITY);
    let mut handles = Vec::with_capacity(worker_count);

    for _ in 0..worker_count {
      let work_iter = Arc::clone(&work_iter);
      let result_tx = result_tx.clone();
      let rate_limiter = Arc::clone(&rate_limiter);
      let scanner = self.clone();
      handles.push(thread::spawn(move || loop {
        let next = {
          let mut guard = match work_iter.lock() {
            Ok(guard) => guard,
            Err(_) => return,
          };
          guard.next()
        };
        let Some(task) = next else {
          return;
        };

        wait_for_enrichment_slot(&rate_limiter);
        let path = task.abs_path.clone();
        let result = scanner.process_pending_enrichment(task);
        let _ = result_tx.send((path, result));
      }));
    }
    drop(result_tx);

    for _ in 0..total {
      let Ok((path, result)) = result_rx.recv() else {
        break;
      };
      processed += 1;
      match result {
        Ok(task_outcome) => {
          if task_outcome.outcome.book_id.is_some() {
            summary.matched_files += 1;
          } else {
            summary.discovered_files += 1;
          }
          let _ = self.app_handle.emit(
            "scan_progress",
            json!({
              "phase": "enrichment_queue",
              "folderId": folder_id,
              "fileId": task_outcome.outcome.file.id,
              "path": task_outcome.outcome.file.abs_path,
              "status": task_outcome.outcome.file.status,
              "bookId": task_outcome.outcome.book_id,
              "enrichMs": task_outcome.enrich_ms,
              "totalFound": total,
              "pendingFiles": total,
              "processedFiles": processed,
              "newFiles": summary.new_files,
              "updatedFiles": summary.updated_files,
              "unchangedFiles": summary.unchanged_files,
              "matchedFiles": summary.matched_files,
              "discoveredFiles": summary.discovered_files,
              "errors": summary.errors,
            }),
          );
        }
        Err(err) => {
          summary.errors += 1;
          summary.discovered_files += 1;
          let _ = self.app_handle.emit(
            "scan_progress",
            json!({
              "phase": "enrichment_queue",
              "folderId": folder_id,
              "path": path,
              "error": err.to_string(),
              "totalFound": total,
              "pendingFiles": total,
              "processedFiles": processed,
              "newFiles": summary.new_files,
              "updatedFiles": summary.updated_files,
              "unchangedFiles": summary.unchanged_files,
              "matchedFiles": summary.matched_files,
              "discoveredFiles": summary.discovered_files,
              "errors": summary.errors,
            }),
          );
        }
      }
    }

    for handle in handles {
      let _ = handle.join();
    }

    let _ = self.app_handle.emit(
      "scan_progress",
      json!({
        "phase": "enrichment_queue",
        "folderId": folder_id,
        "totalFound": total,
        "pendingFiles": total,
        "processedFiles": processed,
        "newFiles": summary.new_files,
        "updatedFiles": summary.updated_files,
        "unchangedFiles": summary.unchanged_files,
        "matchedFiles": summary.matched_files,
        "discoveredFiles": summary.discovered_files,
        "errors": summary.errors,
      }),
    );

    log::info!(
      "scan_enrichment_done folder_id={} processed={} matched={} discovered={} errors={}",
      folder_id,
      processed,
      summary.matched_files,
      summary.discovered_files,
      summary.errors
    );
    Ok(())
  }

  fn process_pending_enrichment(&self, task: PendingEnrichment) -> anyhow::Result<EnrichmentTaskOutcome> {
    let started = Instant::now();
    let file = self
      .repository
      .get_file_by_id(&task.file_id)?
      .ok_or_else(|| anyhow!("file missing for enrichment {}", task.file_id))?;
    let mut outcome = self.match_and_link_file(&file, task.metadata.clone(), true, None)?;
    if should_retry_pdf_enrichment_with_full_parse(&outcome, &file) {
      let path = Path::new(&file.abs_path);
      let (parsed_metadata, parser_error, _) =
        parse_metadata_with_timing(path, &file.ext, file.size_bytes, ScanComputeProfile::Full);
      if parser_error.is_none() && parsed_metadata_improves_lookup(&task.metadata, &parsed_metadata) {
        let (retry_metadata, _, _, _) = merge_with_filename_guess(path, parsed_metadata);
        outcome = self.match_and_link_file(&file, retry_metadata, true, None)?;
      }
    }
    Ok(EnrichmentTaskOutcome {
      outcome,
      enrich_ms: started.elapsed().as_millis() as u64,
    })
  }

  fn for_each_scan_candidate<F>(
    &self,
    folder: &LibraryFolder,
    existing_by_path: &HashMap<String, FileRecord>,
    mut on_candidate: F,
  ) -> anyhow::Result<()>
  where
    F: FnMut(ScanCandidate),
  {
    let walker = if folder.recursive {
      WalkDir::new(&folder.path)
    } else {
      WalkDir::new(&folder.path).max_depth(1)
    };

    for entry in walker {
      let entry = entry.with_context(|| format!("failed to traverse library folder {}", folder.path))?;
      if !entry.file_type().is_file() {
        continue;
      }
      let path = entry.path();
      let Some(ext) = path.extension().and_then(OsStr::to_str).map(|item| item.to_lowercase()) else {
        continue;
      };
      if ext != "pdf" && ext != "epub" {
        continue;
      }
      on_candidate(self.build_scan_candidate(path, ext, existing_by_path));
    }
    Ok(())
  }

  fn build_scan_candidate(
    &self,
    path: &Path,
    ext: String,
    existing_by_path: &HashMap<String, FileRecord>,
  ) -> ScanCandidate {
    let abs_path = if path.is_absolute() {
      path.to_string_lossy().to_string()
    } else {
      path
        .canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_string()
    };
    let existing_file = existing_by_path.get(&abs_path);
    match fs::metadata(path) {
      Ok(fs_metadata) => {
        let size_bytes = fs_metadata.len() as i64;
        let mtime_utc = fs_metadata
          .modified()
          .ok()
          .map(system_time_to_iso)
          .unwrap_or_else(now_iso);
        let is_unchanged = existing_file
          .map(|existing| existing.size_bytes == size_bytes && existing.mtime_utc == mtime_utc)
          .unwrap_or(false);
        ScanCandidate {
          path: path.to_path_buf(),
          abs_path,
          ext,
          size_bytes: Some(size_bytes),
          mtime_utc: Some(mtime_utc),
          is_unchanged,
          prepare_error: None,
        }
      }
      Err(err) => ScanCandidate {
        path: path.to_path_buf(),
        abs_path,
        ext,
        size_bytes: None,
        mtime_utc: None,
        is_unchanged: false,
        prepare_error: Some(format!("metadata read failed: {err}")),
      },
    }
  }

  fn scan_prepared_candidate(
    &self,
    folder: &LibraryFolder,
    candidate: &ScanCandidate,
    existing_file: Option<&FileRecord>,
    profile: ScanComputeProfile,
    force_queue_enrichment: bool,
  ) -> anyhow::Result<ScanPreparedOutcome> {
    let size_bytes = candidate
      .size_bytes
      .ok_or_else(|| anyhow!("missing candidate file size"))?;
    let mtime_utc = candidate
      .mtime_utc
      .clone()
      .ok_or_else(|| anyhow!("missing candidate modified time"))?;

    let (parsed_metadata, parser_error, parse_ms) =
      parse_metadata_with_timing(&candidate.path, &candidate.ext, size_bytes, profile);
    let (lookup_metadata, guessed_title, guessed_author, guessed_isbn) =
      merge_with_filename_guess(&candidate.path, parsed_metadata);

    let (hash_sha256, hash_ms) = compute_sha256_with_timing(&candidate.path, size_bytes, profile);

    let now = now_iso();
    let (file_record, is_new) = self.repository.upsert_file_with_existing(
      UpsertFilePayload {
        folder_id: folder.id.clone(),
        abs_path: candidate.abs_path.clone(),
        ext: candidate.ext.clone(),
        size_bytes,
        mtime_utc,
        hash_sha256,
        status: "discovered".to_string(),
        parser_error: parser_error.clone(),
        guessed_title: guessed_title.clone(),
        guessed_author: guessed_author.clone(),
        guessed_isbn: guessed_isbn.clone(),
      },
      existing_file,
      &now,
    )?;

    if parser_error.is_some() {
      self.repository.mark_discovered(
        &file_record.id,
        "parser_error",
        guessed_title,
        guessed_author,
        guessed_isbn,
        parser_error,
        json!({}),
        &now,
      )?;
      return Ok(ScanPreparedOutcome {
        outcome: FileProcessingOutcome {
          file: self
            .repository
            .get_file_by_id(&file_record.id)?
            .ok_or_else(|| anyhow!("file disappeared after parse error"))?,
          book_id: None,
          confidence: None,
          reason: if is_new { "new".to_string() } else { "updated".to_string() },
        },
        parse_ms,
        hash_ms,
        skip_reason: Some("parser_error".to_string()),
        pending_enrichment: None,
      });
    }

    let matched = self.match_and_link_file(&file_record, lookup_metadata.clone(), false, None)?;
    let skip_reason = match matched.reason.as_str() {
      "weak_lookup_keys" | "missing_lookup_keys" => Some(matched.reason.clone()),
      _ => None,
    };
    let pending_enrichment = if (matched.reason == "queued_for_enrichment" || force_queue_enrichment) && skip_reason.is_none() {
      Some(PendingEnrichment {
        file_id: file_record.id.clone(),
        abs_path: file_record.abs_path.clone(),
        metadata: compact_lookup_metadata(&lookup_metadata),
      })
    } else {
      None
    };
    Ok(ScanPreparedOutcome {
      outcome: FileProcessingOutcome {
        file: self
          .repository
          .get_file_by_id(&file_record.id)?
          .ok_or_else(|| anyhow!("file disappeared after match"))?,
        book_id: matched.book_id,
        confidence: matched.confidence,
        reason: if is_new { "new".to_string() } else { "updated".to_string() },
      },
      parse_ms,
      hash_ms,
      skip_reason,
      pending_enrichment,
    })
  }

  pub(crate) fn scan_single_file(
    &self,
    path: &Path,
    folder: &LibraryFolder,
    force: bool,
    force_api: bool,
    preferred_book_id: Option<&str>,
  ) -> anyhow::Result<FileProcessingOutcome> {
    let fs_metadata = fs::metadata(path).with_context(|| format!("metadata read failed for {}", path.display()))?;
    let abs_path = if path.is_absolute() {
      path.to_string_lossy().to_string()
    } else {
      path
        .canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_string()
    };
    let ext = path
      .extension()
      .and_then(OsStr::to_str)
      .unwrap_or_default()
      .to_lowercase();

    let size_bytes = fs_metadata.len() as i64;
    let mtime_utc = fs_metadata
      .modified()
      .ok()
      .map(system_time_to_iso)
      .unwrap_or_else(now_iso);

    let existing_file = self.repository.get_file_by_path(&abs_path)?;
    if !force {
      if let Some(existing_file) = existing_file.as_ref() {
        if existing_file.size_bytes == size_bytes && existing_file.mtime_utc == mtime_utc {
          return Ok(FileProcessingOutcome {
            file: existing_file.clone(),
            book_id: None,
            confidence: None,
            reason: "unchanged".to_string(),
          });
        }
      }
    }

    let (parsed_metadata, parser_error, _) =
      parse_metadata_with_timing(path, &ext, size_bytes, ScanComputeProfile::Full);
    let (lookup_metadata, guessed_title, guessed_author, guessed_isbn) =
      merge_with_filename_guess(path, parsed_metadata);

    let (hash_sha256, _) = compute_sha256_with_timing(path, size_bytes, ScanComputeProfile::Full);

    let now = now_iso();
    let (file_record, is_new) = self.repository.upsert_file_with_existing(
      UpsertFilePayload {
        folder_id: folder.id.clone(),
        abs_path,
        ext: ext.clone(),
        size_bytes,
        mtime_utc,
        hash_sha256,
        status: "discovered".to_string(),
        parser_error: parser_error.clone(),
        guessed_title: guessed_title.clone(),
        guessed_author: guessed_author.clone(),
        guessed_isbn: guessed_isbn.clone(),
      },
      existing_file.as_ref(),
      &now,
    )?;

    if parser_error.is_some() {
      self.repository.mark_discovered(
        &file_record.id,
        "parser_error",
        guessed_title,
        guessed_author,
        guessed_isbn,
        parser_error,
        json!({}),
        &now,
      )?;
      return Ok(FileProcessingOutcome {
        file: self
          .repository
          .get_file_by_id(&file_record.id)?
          .ok_or_else(|| anyhow!("file disappeared after parse error"))?,
        book_id: None,
        confidence: None,
        reason: if is_new { "new".to_string() } else { "updated".to_string() },
      });
    }

    let matched = self.match_and_link_file(&file_record, lookup_metadata, force_api, preferred_book_id)?;
    Ok(FileProcessingOutcome {
      file: self
        .repository
        .get_file_by_id(&file_record.id)?
        .ok_or_else(|| anyhow!("file disappeared after match"))?,
      book_id: matched.book_id,
      confidence: matched.confidence,
      reason: if is_new { "new".to_string() } else { "updated".to_string() },
    })
  }

  pub(crate) fn match_and_link_file(
    &self,
    file: &FileRecord,
    metadata: ParsedMetadata,
    force_api: bool,
    preferred_book_id: Option<&str>,
  ) -> anyhow::Result<FileProcessingOutcome> {
    let now = now_iso();
    if let Some(book_id) = preferred_book_id {
      if self.repository.get_book_detail(book_id).is_ok() {
        if force_api {
          let _ = self.hydrate_matched_book_metadata(book_id, file, &metadata, &now);
        }
        self
          .repository
          .link_file_to_book(&file.id, book_id, &file.ext.to_lowercase(), false, &now)?;
        self.cache_book_cover_if_needed(book_id);
        return Ok(FileProcessingOutcome {
          file: file.clone(),
          book_id: Some(book_id.to_string()),
          confidence: Some(1.0),
          reason: "matched_by_existing_link".to_string(),
        });
      }
    }

    // Match order is intentional: file hash first, then ISBN, then title/author, then external API.
    if let Some(hash_sha256) = file.hash_sha256.as_deref() {
      if let Some(book_id) = self.repository.find_book_by_file_hash(hash_sha256, &file.id)? {
        if force_api {
          let _ = self.hydrate_matched_book_metadata(&book_id, file, &metadata, &now);
        }
        self
          .repository
          .link_file_to_book(&file.id, &book_id, &file.ext.to_lowercase(), false, &now)?;
        self.cache_book_cover_if_needed(&book_id);
        return Ok(FileProcessingOutcome {
          file: file.clone(),
          book_id: Some(book_id),
          confidence: Some(1.0),
          reason: "matched_by_hash".to_string(),
        });
      }
    }

    if let Some(book_id) = self
      .repository
      .find_book_by_isbn(metadata.isbn10.as_deref(), metadata.isbn13.as_deref())?
    {
      if force_api {
        let _ = self.hydrate_matched_book_metadata(&book_id, file, &metadata, &now);
      }

      self
        .repository
        .link_file_to_book(&file.id, &book_id, &file.ext.to_lowercase(), true, &now)?;
      self.cache_book_cover_if_needed(&book_id);
      return Ok(FileProcessingOutcome {
        file: file.clone(),
        book_id: Some(book_id),
        confidence: Some(1.0),
        reason: "matched_by_isbn".to_string(),
      });
    }

    if let Some(title) = metadata.title.as_deref() {
      if let Some(book_id) = self.repository.find_book_by_title_author(title, &metadata.authors)? {
        let resolved_book_id = book_id;
        let mut confidence: f64 = 0.90;
        if force_api {
          if let Some(enriched_confidence) =
            self.hydrate_matched_book_metadata(&resolved_book_id, file, &metadata, &now)
          {
            confidence = confidence.max(enriched_confidence);
          }
        }
        self
          .repository
          .link_file_to_book(&file.id, &resolved_book_id, &file.ext.to_lowercase(), false, &now)?;
        self.cache_book_cover_if_needed(&resolved_book_id);
        return Ok(FileProcessingOutcome {
          file: file.clone(),
          book_id: Some(resolved_book_id),
          confidence: Some(confidence),
          reason: "matched_by_title_author".to_string(),
        });
      }
    }

    if metadata.authors.is_empty() {
      if let Some(title) = metadata.title.as_deref() {
        if let Some(book_id) = self.repository.find_unique_book_by_exact_title(title)? {
          let mut confidence: f64 = 0.89;
          if force_api {
            if let Some(enriched_confidence) =
              self.hydrate_matched_book_metadata(&book_id, file, &metadata, &now)
            {
              confidence = confidence.max(enriched_confidence);
            }
          }
          self
            .repository
            .link_file_to_book(&file.id, &book_id, &file.ext.to_lowercase(), false, &now)?;
          self.cache_book_cover_if_needed(&book_id);
          return Ok(FileProcessingOutcome {
            file: file.clone(),
            book_id: Some(book_id),
            confidence: Some(confidence),
            reason: "matched_by_exact_title".to_string(),
          });
        }
      }
    }

    if let Some(skip_reason) = lookup_skip_reason(&metadata) {
      self.repository.mark_discovered(
        &file.id,
        skip_reason,
        metadata.title.clone().or(file.guessed_title.clone()),
        metadata.authors.first().cloned().or(file.guessed_author.clone()),
        metadata
          .isbn13
          .clone()
          .or(metadata.isbn10.clone())
          .or(file.guessed_isbn.clone()),
        None,
        json!({ "reason": skip_reason }),
        &now,
      )?;
      return Ok(FileProcessingOutcome {
        file: file.clone(),
        book_id: None,
        confidence: None,
        reason: skip_reason.to_string(),
      });
    }

    if !force_api {
      self.repository.mark_discovered(
        &file.id,
        "queued_for_enrichment",
        metadata.title.clone().or(file.guessed_title.clone()),
        metadata.authors.first().cloned().or(file.guessed_author.clone()),
        metadata
          .isbn13
          .clone()
          .or(metadata.isbn10.clone())
          .or(file.guessed_isbn.clone()),
        None,
        json!({ "reason": "queued_for_enrichment" }),
        &now,
      )?;
      return Ok(FileProcessingOutcome {
        file: file.clone(),
        book_id: None,
        confidence: None,
        reason: "queued_for_enrichment".to_string(),
      });
    }

    match self.enrich_with_notice(&metadata) {
      Ok(Some(enriched)) if enriched.confidence >= AUTO_MATCH_THRESHOLD => {
        let book_id = self.repository.upsert_book(
          self.build_upsert_book_input(file, &metadata, enriched.clone()),
          &now,
        )?;
        self
          .repository
          .link_file_to_book(&file.id, &book_id, &file.ext.to_lowercase(), true, &now)?;
        self.cache_book_cover_if_needed(&book_id);
        Ok(FileProcessingOutcome {
          file: file.clone(),
          book_id: Some(book_id),
          confidence: Some(enriched.confidence),
          reason: "matched_by_api".to_string(),
        })
      }
      Ok(Some(enriched)) => {
        self.repository.mark_discovered(
          &file.id,
          "low_confidence",
          metadata.title.clone().or(file.guessed_title.clone()),
          metadata.authors.first().cloned().or(file.guessed_author.clone()),
          metadata
            .isbn13
            .clone()
            .or(metadata.isbn10.clone())
            .or(file.guessed_isbn.clone()),
          None,
          json!({ "confidence": enriched.confidence }),
          &now,
        )?;
        Ok(FileProcessingOutcome {
          file: file.clone(),
          book_id: None,
          confidence: Some(enriched.confidence),
          reason: "low_confidence".to_string(),
        })
      }
      Ok(None) => {
        self.repository.mark_discovered(
          &file.id,
          "no_api_match",
          metadata.title.clone().or(file.guessed_title.clone()),
          metadata.authors.first().cloned().or(file.guessed_author.clone()),
          metadata
            .isbn13
            .clone()
            .or(metadata.isbn10.clone())
            .or(file.guessed_isbn.clone()),
          None,
          json!({}),
          &now,
        )?;
        Ok(FileProcessingOutcome {
          file: file.clone(),
          book_id: None,
          confidence: None,
          reason: "no_api_match".to_string(),
        })
      }
      Err(err) => {
        self.repository.mark_discovered(
          &file.id,
          &format!("api_error: {err}"),
          metadata.title.clone().or(file.guessed_title.clone()),
          metadata.authors.first().cloned().or(file.guessed_author.clone()),
          metadata
            .isbn13
            .clone()
            .or(metadata.isbn10.clone())
            .or(file.guessed_isbn.clone()),
          None,
          json!({ "error": err.to_string() }),
          &now,
        )?;
        Ok(FileProcessingOutcome {
          file: file.clone(),
          book_id: None,
          confidence: None,
          reason: "api_error".to_string(),
        })
      }
    }
  }

  fn build_upsert_book_input(
    &self,
    file: &FileRecord,
    metadata: &ParsedMetadata,
    enriched: EnrichedBook,
  ) -> UpsertBookInput {
    UpsertBookInput {
      title: if enriched.title.trim().is_empty() {
        metadata
          .title
          .clone()
          .or(file.guessed_title.clone())
          .unwrap_or_else(|| "Unknown Title".to_string())
      } else {
        enriched.title
      },
      subtitle: enriched.subtitle.or(metadata.subtitle.clone()),
      authors: if enriched.authors.is_empty() {
        if metadata.authors.is_empty() {
          file
            .guessed_author
            .clone()
            .map(|value| vec![value])
            .unwrap_or_default()
        } else {
          metadata.authors.clone()
        }
      } else {
        enriched.authors
      },
      publisher: enriched.publisher,
      publish_date: enriched.publish_date.or(metadata.publish_date.clone()),
      isbn10: enriched.isbn10.or(metadata.isbn10.clone()),
      isbn13: enriched.isbn13.or(metadata.isbn13.clone()),
      description: enriched.description,
      language: enriched.language,
      page_count: enriched.page_count.or(metadata.page_count),
      series: None,
      series_index: None,
      cover_url: enriched.cover_url,
      metadata_source: "api".to_string(),
      confidence: Some(enriched.confidence),
    }
  }

  fn enrich_with_notice(&self, metadata: &ParsedMetadata) -> anyhow::Result<Option<EnrichedBook>> {
    let result = self.enricher.enrich(metadata);
    self.emit_google_books_quota_notice_if_needed();
    result
  }

  fn hydrate_matched_book_metadata(
    &self,
    book_id: &str,
    file: &FileRecord,
    metadata: &ParsedMetadata,
    now: &str,
  ) -> Option<f64> {
    let mut lookup = metadata.clone();
    let mut detail_seed: Option<ParsedMetadata> = None;
    if let Ok(detail) = self.repository.get_book_detail(book_id) {
      detail_seed = Some(ParsedMetadata {
        title: Some(detail.title.clone()),
        subtitle: detail.subtitle.clone(),
        authors: detail.authors.clone(),
        publisher: detail.publisher.clone(),
        publish_date: detail.publish_date.clone(),
        isbn10: detail.isbn10.clone(),
        isbn13: detail.isbn13.clone(),
        description: detail.description.clone(),
        language: detail.language.clone(),
        page_count: detail.page_count,
      });
      if lookup.title.as_deref().map(|value| value.trim().is_empty()).unwrap_or(true) {
        lookup.title = Some(detail.title);
      }
      if lookup.authors.is_empty() && !detail.authors.is_empty() {
        lookup.authors = detail.authors;
      }
      if lookup.publish_date.is_none() {
        lookup.publish_date = detail.publish_date;
      }
      if lookup.isbn13.is_none() {
        lookup.isbn13 = detail.isbn13;
      }
      if lookup.isbn10.is_none() {
        lookup.isbn10 = detail.isbn10;
      }
    }

    let mut enriched = self.enrich_with_notice(&lookup).ok().flatten();
    let should_retry_with_detail_seed = enriched
      .as_ref()
      .map(|candidate| candidate.confidence < AUTO_MATCH_THRESHOLD)
      .unwrap_or(true);
    if should_retry_with_detail_seed {
      if let Some(seed) = detail_seed.as_ref() {
        if let Some(retry_candidate) = self.enrich_with_notice(seed).ok().flatten() {
          let use_retry = enriched
            .as_ref()
            .map(|candidate| retry_candidate.confidence > candidate.confidence)
            .unwrap_or(true);
          if use_retry {
            enriched = Some(retry_candidate);
          }
        }
      }
    }
    let enriched = enriched?;
    // Keep rescan hydration aligned with standard auto-match behavior.
    // This prevents low-confidence API results from filling blank fields with unrelated metadata.
    if enriched.confidence < AUTO_MATCH_THRESHOLD {
      return None;
    }
    let confidence = enriched.confidence;
    let update_input = self.build_upsert_book_input(file, &lookup, enriched);
    self
      .repository
      .update_book_by_id_ignoring_manual_overrides(book_id, update_input, now)
      .ok()?;
    self.cache_book_cover_if_needed(book_id);
    Some(confidence)
  }

  fn cache_book_cover_if_needed(&self, book_id: &str) {
    let Ok(detail) = self.repository.get_book_detail(book_id) else {
      return;
    };
    if detail
      .cover_local_path
      .as_deref()
      .map(CoverCache::cached_file_exists)
      .unwrap_or(false)
    {
      return;
    }
    let Some(cover_url) = detail.cover_url.as_deref().filter(|value| !value.trim().is_empty()) else {
      return;
    };
    match self.cover_cache.cache_cover(book_id, cover_url) {
      Ok(Some(local_path)) => {
        if let Err(err) = self.repository.set_book_cover_local_path(book_id, &local_path) {
          log::warn!("cover_cache_record_failed book_id={} error={err}", book_id);
        }
      }
      Ok(None) => {}
      Err(err) => log::warn!("cover_cache_failed book_id={} error={err}", book_id),
    }
  }

  pub(crate) fn emit_google_books_quota_notice_if_needed(&self) {
    let notice = self.enricher.google_books_quota_notice();
    let mut last_notice = match self.last_google_quota_notice.lock() {
      Ok(guard) => guard,
      Err(_) => return,
    };
    if let Some((message, limited_until_utc)) = notice {
      if last_notice.as_deref() == Some(message.as_str()) {
        return;
      }
      *last_notice = Some(message.clone());
      let _ = self.app_handle.emit(
        "google_books_quota_notice",
        json!({
          "message": message,
          "limitedUntilUtc": limited_until_utc,
        }),
      );
    } else {
      *last_notice = None;
    }
  }
}

#[derive(Clone)]
pub(crate) struct FolderWatcher {
  watched_paths: Arc<Mutex<HashMap<String, String>>>,
  last_scan_by_folder: Arc<Mutex<HashMap<String, Instant>>>,
  watcher: Arc<Mutex<RecommendedWatcher>>,
}

impl FolderWatcher {
  pub(crate) fn new(scanner: Scanner, repository: Repository, app_handle: AppHandle) -> anyhow::Result<Self> {
    let watched_paths = Arc::new(Mutex::new(HashMap::<String, String>::new()));
    let watched_paths_for_thread = watched_paths.clone();
    let last_scan_by_folder = Arc::new(Mutex::new(HashMap::<String, Instant>::new()));
    let last_scan_by_folder_for_thread = last_scan_by_folder.clone();

    let (tx, rx) = mpsc::sync_channel::<notify::Result<Event>>(WATCHER_EVENT_QUEUE_CAPACITY);
    let watcher = RecommendedWatcher::new(
      move |event| {
        // A scan reconciles the complete folder, so events that arrive during a
        // burst are redundant. Keep notify's callback non-blocking and prevent
        // an unbounded backlog while a scan is in progress.
        let _ = tx.try_send(event);
      },
      Config::default().with_poll_interval(Duration::from_secs(2)),
    )?;

    let scanner_for_thread = scanner.clone();
    let repository_for_thread = repository.clone();
    let app_for_thread = app_handle.clone();

    thread::spawn(move || {
      loop {
        let Ok(event) = rx.recv() else {
          break;
        };
        let Ok(event) = event else {
          continue;
        };
        if event.paths.is_empty() {
          continue;
        }

        let changed = event.paths[0]
          .canonicalize()
          .unwrap_or_else(|_| event.paths[0].clone())
          .to_string_lossy()
          .to_string();
        let changed_ext = Path::new(&changed)
          .extension()
          .and_then(OsStr::to_str)
          .map(|ext| ext.to_ascii_lowercase());
        let looks_like_supported_file = matches!(changed_ext.as_deref(), Some("pdf" | "epub"));
        let looks_like_directory = Path::new(&changed).is_dir();
        if !looks_like_supported_file && !looks_like_directory {
          continue;
        }

        let folder_match = {
          let map = watched_paths_for_thread.lock();
          map.iter()
            .filter(|(path, _)| Path::new(&changed).starts_with(Path::new(path.as_str())))
            .max_by_key(|(path, _)| Path::new(path.as_str()).components().count())
            .map(|(_, folder_id)| folder_id.clone())
        };

        if let Some(folder_id) = folder_match {
          let now = Instant::now();
          {
            let mut last_scans = last_scan_by_folder_for_thread.lock();
            if let Some(previous) = last_scans.get(&folder_id) {
              if now.duration_since(*previous) < Duration::from_secs(2) {
                continue;
              }
            }
            last_scans.insert(folder_id.clone(), now);
          }

          let _ = app_for_thread.emit(
            "watcher_file_changed",
            json!({ "folderId": folder_id, "path": changed }),
          );
          if let Ok(Some(folder)) = repository_for_thread.get_folder(&folder_id) {
            let changed_path = Path::new(&changed);
            if looks_like_supported_file && changed_path.is_file() {
              match scanner_for_thread.scan_single_file(changed_path, &folder, false, true, None) {
                Ok(outcome) => {
                  let summary = scan_summary_for_single_file_outcome(&outcome);
                  let _ = app_for_thread.emit("scan_completed", summary);
                }
                Err(err) => {
                  log::warn!("watcher_single_file_scan_failed path={} error={err}", changed);
                }
              }
            } else if let Ok(summary) = scanner_for_thread.scan_folder(&folder) {
              let _ = app_for_thread.emit("scan_completed", summary);
            }
          }
        }
      }
    });

    Ok(Self {
      watched_paths,
      last_scan_by_folder,
      watcher: Arc::new(Mutex::new(watcher)),
    })
  }

  pub(crate) fn watch_folder(&self, folder: &LibraryFolder) -> anyhow::Result<()> {
    let path = Path::new(&folder.path);
    if !path.exists() {
      return Ok(());
    }
    let recursive_mode = if folder.recursive {
      RecursiveMode::Recursive
    } else {
      RecursiveMode::NonRecursive
    };
    self.watcher.lock().watch(path, recursive_mode)?;
    let replaced_folder_id = self
      .watched_paths
      .lock()
      .insert(folder.path.clone(), folder.id.clone());
    if let Some(replaced_folder_id) = replaced_folder_id.filter(|id| id != &folder.id) {
      self.last_scan_by_folder.lock().remove(&replaced_folder_id);
    }
    Ok(())
  }

  pub(crate) fn unwatch_folder(&self, folder_path: &str) -> anyhow::Result<()> {
    let path = Path::new(folder_path);
    let _ = self.watcher.lock().unwatch(path);
    if let Some(folder_id) = self.watched_paths.lock().remove(folder_path) {
      self.last_scan_by_folder.lock().remove(&folder_id);
    }
    Ok(())
  }
}

fn scan_summary_for_single_file_outcome(outcome: &FileProcessingOutcome) -> ScanSummary {
  let mut summary = ScanSummary {
    scanned_files: 1,
    ..ScanSummary::default()
  };
  match outcome.reason.as_str() {
    "unchanged" => summary.unchanged_files = 1,
    "new" => summary.new_files = 1,
    "updated" => summary.updated_files = 1,
    _ => {}
  }
  if outcome.reason != "unchanged" {
    if outcome.book_id.is_some() {
      summary.matched_files = 1;
    } else {
      summary.discovered_files = 1;
    }
  }
  summary
}

fn merge_with_filename_guess(
  path: &Path,
  parsed_metadata: ParsedMetadata,
) -> (ParsedMetadata, Option<String>, Option<String>, Option<String>) {
  let filename_guess = infer_metadata_from_filename(path);
  let mut lookup_metadata = parsed_metadata.clone();

  if lookup_metadata.title.is_none() {
    lookup_metadata.title = filename_guess.title.clone();
  }
  if lookup_metadata.authors.is_empty() && !filename_guess.authors.is_empty() {
    lookup_metadata.authors = filename_guess.authors.clone();
  }
  if lookup_metadata.isbn13.is_none() && lookup_metadata.isbn10.is_none() {
    lookup_metadata.isbn13 = filename_guess.isbn13.clone();
    lookup_metadata.isbn10 = filename_guess.isbn10.clone();
  }

  let guessed_title = parsed_metadata.title.or(filename_guess.title);
  let guessed_author = parsed_metadata
    .authors
    .first()
    .cloned()
    .or_else(|| filename_guess.authors.first().cloned());
  let guessed_isbn = parsed_metadata
    .isbn13
    .or(parsed_metadata.isbn10)
    .or(filename_guess.isbn13)
    .or(filename_guess.isbn10);

  (lookup_metadata, guessed_title, guessed_author, guessed_isbn)
}

fn parse_metadata_with_timing(
  path: &Path,
  ext: &str,
  size_bytes: i64,
  profile: ScanComputeProfile,
) -> (ParsedMetadata, Option<String>, u64) {
  if ext.eq_ignore_ascii_case("pdf") {
    if matches!(profile, ScanComputeProfile::BulkSafe) {
      return (ParsedMetadata::default(), None, 0);
    }
  }
  if ext.eq_ignore_ascii_case("pdf") && size_bytes > PDF_PARSE_SKIP_SIZE_BYTES {
    return (ParsedMetadata::default(), None, 0);
  }
  let started = Instant::now();
  match parse_metadata(path, ext) {
    Ok(metadata) => {
      let elapsed = started.elapsed();
      let elapsed_ms = elapsed.as_millis() as u64;
      if elapsed > FILE_PARSE_SLOW_THRESHOLD {
        (
          ParsedMetadata::default(),
          Some(format!("parse_slow: exceeded {}s", FILE_PARSE_SLOW_THRESHOLD.as_secs())),
          elapsed_ms,
        )
      } else {
        (metadata, None, elapsed_ms)
      }
    }
    Err(err) => (
      ParsedMetadata::default(),
      Some(err.to_string()),
      started.elapsed().as_millis() as u64,
    ),
  }
}

fn compute_sha256_with_timing(path: &Path, size_bytes: i64, profile: ScanComputeProfile) -> (Option<String>, u64) {
  if matches!(profile, ScanComputeProfile::BulkSafe) {
    return (None, 0);
  }
  if size_bytes > HASH_SKIP_SIZE_BYTES {
    return (None, 0);
  }
  let started = Instant::now();
  let hash = compute_sha256(path).ok();
  let elapsed = started.elapsed();
  let elapsed_ms = elapsed.as_millis() as u64;
  if elapsed > FILE_HASH_SLOW_THRESHOLD {
    (None, elapsed_ms)
  } else {
    (hash, elapsed_ms)
  }
}

fn compact_lookup_metadata(metadata: &ParsedMetadata) -> ParsedMetadata {
  ParsedMetadata {
    title: metadata.title.clone(),
    subtitle: metadata.subtitle.clone(),
    authors: metadata.authors.clone(),
    publisher: None,
    publish_date: metadata.publish_date.clone(),
    isbn10: metadata.isbn10.clone(),
    isbn13: metadata.isbn13.clone(),
    description: None,
    language: None,
    page_count: None,
  }
}

fn should_retry_pdf_enrichment_with_full_parse(outcome: &FileProcessingOutcome, file: &FileRecord) -> bool {
  file.ext.eq_ignore_ascii_case("pdf")
    && matches!(outcome.reason.as_str(), "low_confidence" | "no_api_match")
}

pub(crate) fn parsed_metadata_improves_lookup(original: &ParsedMetadata, parsed: &ParsedMetadata) -> bool {
  let original_has_isbn = original.isbn10.is_some() || original.isbn13.is_some();
  let parsed_has_isbn = parsed.isbn10.is_some() || parsed.isbn13.is_some();
  if parsed_has_isbn && !original_has_isbn {
    return true;
  }

  let parsed_title = parsed.title.as_deref().map(normalize_text).unwrap_or_default();
  let original_title = original.title.as_deref().map(normalize_text).unwrap_or_default();
  if !parsed_title.is_empty() && original_title.is_empty() {
    return true;
  }
  if !parsed_title.is_empty()
    && !original_title.is_empty()
    && parsed_title != original_title
    && parsed_title.split_whitespace().count() >= original_title.split_whitespace().count()
  {
    return true;
  }

  let parsed_authors: Vec<String> = parsed
    .authors
    .iter()
    .map(|value| normalize_text(value))
    .filter(|value| !value.is_empty())
    .collect();
  if parsed_authors.is_empty() {
    return false;
  }
  let original_authors: Vec<String> = original
    .authors
    .iter()
    .map(|value| normalize_text(value))
    .filter(|value| !value.is_empty())
    .collect();
  if original_authors.is_empty() {
    return true;
  }
  parsed_authors != original_authors
}

fn scan_worker_count() -> usize {
  let cpu_count = thread::available_parallelism().map(|count| count.get()).unwrap_or(2);
  let conservative = (cpu_count / 2).max(1);
  conservative.min(MAX_SCAN_WORKERS)
}

fn wait_for_enrichment_slot(rate_limiter: &Arc<StdMutex<Instant>>) {
  if ENRICHMENT_RATE_LIMIT_PER_SECOND == 0 {
    return;
  }
  let interval = Duration::from_millis((1_000 / ENRICHMENT_RATE_LIMIT_PER_SECOND).max(1));
  let wait_duration = {
    let mut next_allowed = match rate_limiter.lock() {
      Ok(guard) => guard,
      Err(_) => return,
    };
    let now = Instant::now();
    if now >= *next_allowed {
      *next_allowed = now + interval;
      None
    } else {
      let to_wait = *next_allowed - now;
      *next_allowed += interval;
      Some(to_wait)
    }
  };
  if let Some(duration) = wait_duration {
    if !duration.is_zero() {
      thread::sleep(duration);
    }
  }
}

pub(crate) fn lookup_skip_reason(metadata: &ParsedMetadata) -> Option<&'static str> {
  if metadata.isbn10.is_some() || metadata.isbn13.is_some() {
    return None;
  }
  if metadata
    .title
    .as_deref()
    .map(|value| normalize_text(value).is_empty())
    .unwrap_or(true)
  {
    return Some("missing_lookup_keys");
  }
  if is_weak_lookup_key(metadata) {
    return Some("weak_lookup_keys");
  }
  None
}

pub(crate) fn is_weak_lookup_key(metadata: &ParsedMetadata) -> bool {
  if metadata.isbn10.is_some() || metadata.isbn13.is_some() {
    return false;
  }
  let normalized_title = metadata
    .title
    .as_deref()
    .map(normalize_text)
    .unwrap_or_default();
  if normalized_title.is_empty() {
    return true;
  }

  let generic_titles = [
    "unknown",
    "untitled",
    "book",
    "ebook",
    "pdf",
    "scan",
    "document",
    "manual",
  ];
  if generic_titles.contains(&normalized_title.as_str()) {
    return true;
  }

  let token_count = normalized_title.split_whitespace().count();
  let has_author = metadata
    .authors
    .iter()
    .any(|author| !normalize_text(author).is_empty());
  if token_count <= 1 {
    return !has_author;
  }
  if !has_author && token_count <= 2 && normalized_title.len() <= 14 {
    return true;
  }

  let alpha_count = normalized_title
    .chars()
    .filter(|ch| ch.is_ascii_alphabetic())
    .count();
  !has_author && alpha_count < 7
}
