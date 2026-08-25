use std::{
  collections::{HashMap, HashSet},
  ffi::OsStr,
  path::{Path, PathBuf},
};

use anyhow::{anyhow, Context};
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{params, params_from_iter, types::Value, Connection, OptionalExtension, TransactionBehavior};
use serde_json::Value as JsonValue;
use uuid::Uuid;

use crate::library::metadata::{normalize_isbn, normalize_text};
use crate::library::types::{
  BookCard, BookDetail, BookFile, BookFilters, BookPatch, DiscoveredFile, FileRecord, LibraryFolder, MetadataField,
  MetadataFieldSelection, MetadataLockUpdate, Paged, SortSpec, TagCount, TagDeleteResult, TagMergeResult,
  UpsertBookInput, UpsertFilePayload,
};

#[derive(Clone)]
pub struct Repository {
  pool: Pool<SqliteConnectionManager>,
}

#[derive(Clone)]
struct BookDedupCandidate {
  id: String,
  title: String,
  authors: Vec<String>,
  isbn10: Option<String>,
  isbn13: Option<String>,
  updated_at: String,
  has_manual_overrides: bool,
  file_count: i64,
}

impl Repository {
  pub fn new(db_path: PathBuf) -> anyhow::Result<Self> {
    // Journal mode is persistent database state. Configure it once before the
    // pool starts opening connections so concurrent workers never contend while
    // trying to change it during connection initialization.
    let bootstrap = Connection::open(&db_path)?;
    bootstrap.execute_batch(
      r#"
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA wal_autocheckpoint = 1000;
      "#,
    )?;
    drop(bootstrap);

    let manager = SqliteConnectionManager::file(db_path).with_init(|conn| {
      conn.execute_batch(
        r#"
        PRAGMA busy_timeout = 5000;
        PRAGMA foreign_keys = ON;
        PRAGMA wal_autocheckpoint = 1000;
        "#,
      )
    });
    let pool = Pool::builder().max_size(8).build(manager)?;
    Ok(Self { pool })
  }

  fn conn(&self) -> anyhow::Result<r2d2::PooledConnection<SqliteConnectionManager>> {
    Ok(self.pool.get()?)
  }

  pub fn optimize_storage(&self) -> anyhow::Result<()> {
    self.conn()?.execute_batch(
      r#"
      PRAGMA optimize;
      PRAGMA wal_checkpoint(PASSIVE);
      "#,
    )?;
    Ok(())
  }

  pub fn referenced_cover_paths(&self) -> anyhow::Result<HashSet<PathBuf>> {
    let conn = self.conn()?;
    let mut stmt = conn.prepare(
      "SELECT DISTINCT cover_local_path FROM books WHERE cover_local_path IS NOT NULL AND cover_local_path <> ''",
    )?;
    let mut paths = HashSet::new();
    for row in stmt.query_map([], |row| row.get::<_, String>(0))? {
      paths.insert(PathBuf::from(row?));
    }
    Ok(paths)
  }

  pub fn init_schema(&self) -> anyhow::Result<()> {
    let conn = self.conn()?;
    conn.execute_batch(
      r#"
      CREATE TABLE IF NOT EXISTS library_folders (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        recursive INTEGER NOT NULL DEFAULT 1,
        enabled INTEGER NOT NULL DEFAULT 1,
        added_at TEXT NOT NULL,
        last_scan_at TEXT
      );

      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        folder_id TEXT NOT NULL,
        abs_path TEXT NOT NULL UNIQUE,
        ext TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        mtime_utc TEXT NOT NULL,
        hash_sha256 TEXT,
        status TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        parser_error TEXT,
        guessed_title TEXT,
        guessed_author TEXT,
        guessed_isbn TEXT,
        FOREIGN KEY (folder_id) REFERENCES library_folders(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_files_folder_id ON files(folder_id);
      CREATE INDEX IF NOT EXISTS idx_files_status ON files(status);
      CREATE INDEX IF NOT EXISTS idx_files_hash_sha256 ON files(hash_sha256);

      CREATE TABLE IF NOT EXISTS books (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        subtitle TEXT,
        authors_json TEXT NOT NULL,
        publisher TEXT,
        publish_date TEXT,
        isbn10 TEXT,
        isbn13 TEXT,
        description TEXT,
        language TEXT,
        page_count INTEGER,
        series TEXT,
        series_index INTEGER,
        cover_url TEXT,
        cover_local_path TEXT,
        metadata_source TEXT NOT NULL,
        confidence REAL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_books_isbn10 ON books(isbn10);
      CREATE INDEX IF NOT EXISTS idx_books_isbn13 ON books(isbn13);
      CREATE INDEX IF NOT EXISTS idx_books_title_lower ON books(lower(title));

      CREATE TABLE IF NOT EXISTS book_files (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL,
        file_id TEXT NOT NULL UNIQUE,
        format TEXT NOT NULL,
        is_primary INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
        FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_book_files_book_id ON book_files(book_id);

      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tags_label ON tags(label);

      CREATE TABLE IF NOT EXISTS book_tags (
        book_id TEXT NOT NULL,
        tag_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (book_id, tag_id),
        FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_book_tags_tag_id ON book_tags(tag_id);

      CREATE TABLE IF NOT EXISTS manual_overrides (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL,
        field_name TEXT NOT NULL,
        field_value TEXT,
        edited_at TEXT NOT NULL,
        UNIQUE(book_id, field_name),
        FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS enrichment_jobs (
        id TEXT PRIMARY KEY,
        file_id TEXT NOT NULL UNIQUE,
        query_json TEXT,
        status TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TEXT,
        error TEXT,
        FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS library_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS book_external_sources (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL,
        source TEXT NOT NULL,
        external_id TEXT NOT NULL,
        external_work_id TEXT,
        external_url TEXT NOT NULL,
        metadata_json TEXT,
        imported_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(source, external_id),
        FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_book_external_sources_book_source ON book_external_sources(book_id, source);

      DROP TRIGGER IF EXISTS book_files_ad;
      CREATE TRIGGER book_files_ad AFTER DELETE ON book_files BEGIN
        DELETE FROM books
         WHERE id = old.book_id
           AND NOT EXISTS (SELECT 1 FROM book_files bf WHERE bf.book_id = old.book_id)
           AND NOT EXISTS (SELECT 1 FROM book_external_sources bes WHERE bes.book_id = old.book_id);
      END;

      DROP TRIGGER IF EXISTS book_files_au_book_id;
      CREATE TRIGGER book_files_au_book_id AFTER UPDATE OF book_id ON book_files BEGIN
        DELETE FROM books
         WHERE id = old.book_id
           AND old.book_id <> new.book_id
           AND NOT EXISTS (SELECT 1 FROM book_files bf WHERE bf.book_id = old.book_id)
           AND NOT EXISTS (SELECT 1 FROM book_external_sources bes WHERE bes.book_id = old.book_id);
      END;

      CREATE VIRTUAL TABLE IF NOT EXISTS fts_books USING fts5(
        book_id UNINDEXED,
        title,
        authors,
        publisher,
        description,
        isbn,
        tokenize = 'unicode61 remove_diacritics 2'
      );

      CREATE TRIGGER IF NOT EXISTS books_ai AFTER INSERT ON books BEGIN
        INSERT INTO fts_books(book_id, title, authors, publisher, description, isbn)
        VALUES (
          new.id,
          new.title,
          json_extract(new.authors_json, '$'),
          COALESCE(new.publisher, ''),
          COALESCE(new.description, ''),
          trim(COALESCE(new.isbn10, '') || ' ' || COALESCE(new.isbn13, ''))
        );
      END;

      CREATE TRIGGER IF NOT EXISTS books_au AFTER UPDATE ON books BEGIN
        DELETE FROM fts_books WHERE book_id = old.id;
        INSERT INTO fts_books(book_id, title, authors, publisher, description, isbn)
        VALUES (
          new.id,
          new.title,
          json_extract(new.authors_json, '$'),
          COALESCE(new.publisher, ''),
          COALESCE(new.description, ''),
          trim(COALESCE(new.isbn10, '') || ' ' || COALESCE(new.isbn13, ''))
        );
      END;

      CREATE TRIGGER IF NOT EXISTS books_ad AFTER DELETE ON books BEGIN
        DELETE FROM fts_books WHERE book_id = old.id;
      END;
      "#,
    )?;
    ensure_column(&conn, "books", "series", "TEXT")?;
    ensure_column(&conn, "books", "series_index", "INTEGER")?;
    ensure_column(&conn, "books", "hidden", "INTEGER NOT NULL DEFAULT 0")?;
    conn.execute_batch(
      r#"
      CREATE INDEX IF NOT EXISTS idx_books_hidden_created_at ON books(hidden, created_at);
      CREATE INDEX IF NOT EXISTS idx_books_hidden_updated_at ON books(hidden, updated_at);
      CREATE INDEX IF NOT EXISTS idx_book_files_format_book_id ON book_files(lower(format), book_id);
      CREATE INDEX IF NOT EXISTS idx_files_status_last_seen ON files(status, last_seen_at);
      "#,
    )?;
    Ok(())
  }

  pub fn add_folder(&self, path: &str, recursive: bool, now: &str) -> anyhow::Result<LibraryFolder> {
    let conn = self.conn()?;
    conn.execute(
      "INSERT OR IGNORE INTO library_folders(id, path, recursive, enabled, added_at, last_scan_at) VALUES(?1, ?2, ?3, 1, ?4, NULL)",
      params![Uuid::new_v4().to_string(), path, recursive as i64, now],
    )?;

    conn
      .query_row(
        "SELECT id, path, recursive, enabled, added_at, last_scan_at FROM library_folders WHERE path = ?1",
        params![path],
        map_folder,
      )
      .context("failed to fetch folder")
  }

  pub fn remove_folder(&self, folder_id: &str) -> anyhow::Result<()> {
    self
      .conn()?
      .execute("DELETE FROM library_folders WHERE id = ?1", params![folder_id])?;
    Ok(())
  }

  pub fn count_files_for_folder(&self, folder_id: &str) -> anyhow::Result<u64> {
    let count: i64 = self.conn()?.query_row(
      "SELECT COUNT(*) FROM files WHERE folder_id = ?1",
      params![folder_id],
      |row| row.get(0),
    )?;
    Ok(count.max(0) as u64)
  }

  pub fn count_books_orphaned_by_folder_removal(&self, folder_id: &str) -> anyhow::Result<u64> {
    let count: i64 = self.conn()?.query_row(
      "SELECT COUNT(DISTINCT b.id)
       FROM books b
       WHERE EXISTS (
         SELECT 1
         FROM book_files bf
         JOIN files f ON f.id = bf.file_id
         WHERE bf.book_id = b.id
           AND f.folder_id = ?1
       )
       AND NOT EXISTS (
         SELECT 1
         FROM book_files bf2
         JOIN files f2 ON f2.id = bf2.file_id
         WHERE bf2.book_id = b.id
           AND f2.folder_id <> ?1
       )",
      params![folder_id],
      |row| row.get(0),
    )?;
    Ok(count.max(0) as u64)
  }

  pub fn list_folders(&self) -> anyhow::Result<Vec<LibraryFolder>> {
    let conn = self.conn()?;
    let mut stmt = conn.prepare(
      "SELECT id, path, recursive, enabled, added_at, last_scan_at FROM library_folders WHERE enabled = 1 ORDER BY added_at ASC",
    )?;
    let mut out = Vec::new();
    for row in stmt.query_map([], map_folder)? {
      out.push(row?);
    }
    Ok(out)
  }

  pub fn get_folder(&self, folder_id: &str) -> anyhow::Result<Option<LibraryFolder>> {
    Ok(
      self
        .conn()?
        .query_row(
          "SELECT id, path, recursive, enabled, added_at, last_scan_at FROM library_folders WHERE id = ?1",
          params![folder_id],
          map_folder,
        )
        .optional()?,
    )
  }

  pub fn update_folder_scan_time(&self, folder_id: &str, now: &str) -> anyhow::Result<()> {
    self.conn()?.execute(
      "UPDATE library_folders SET last_scan_at = ?1 WHERE id = ?2",
      params![now, folder_id],
    )?;
    Ok(())
  }

  pub fn get_file_by_path(&self, abs_path: &str) -> anyhow::Result<Option<FileRecord>> {
    Ok(
      self
        .conn()?
        .query_row(
          "SELECT id, folder_id, abs_path, ext, size_bytes, mtime_utc, hash_sha256, status, first_seen_at, last_seen_at, parser_error, guessed_title, guessed_author, guessed_isbn FROM files WHERE abs_path = ?1",
          params![abs_path],
          map_file,
        )
        .optional()?,
    )
  }

  pub fn get_file_by_id(&self, file_id: &str) -> anyhow::Result<Option<FileRecord>> {
    Ok(
      self
        .conn()?
        .query_row(
          "SELECT id, folder_id, abs_path, ext, size_bytes, mtime_utc, hash_sha256, status, first_seen_at, last_seen_at, parser_error, guessed_title, guessed_author, guessed_isbn FROM files WHERE id = ?1",
          params![file_id],
          map_file,
        )
        .optional()?,
    )
  }

  pub fn list_files_for_folder(&self, folder_id: &str) -> anyhow::Result<Vec<FileRecord>> {
    let conn = self.conn()?;
    let mut stmt = conn.prepare(
      "SELECT id, folder_id, abs_path, ext, size_bytes, mtime_utc, hash_sha256, status, first_seen_at, last_seen_at, parser_error, guessed_title, guessed_author, guessed_isbn FROM files WHERE folder_id = ?1",
    )?;
    let mut out = Vec::new();
    for row in stmt.query_map(params![folder_id], map_file)? {
      out.push(row?);
    }
    Ok(out)
  }

  pub fn list_all_files(&self) -> anyhow::Result<Vec<FileRecord>> {
    let conn = self.conn()?;
    let mut stmt = conn.prepare(
      "SELECT id, folder_id, abs_path, ext, size_bytes, mtime_utc, hash_sha256, status, first_seen_at, last_seen_at, parser_error, guessed_title, guessed_author, guessed_isbn FROM files",
    )?;
    let mut out = Vec::new();
    for row in stmt.query_map([], map_file)? {
      out.push(row?);
    }
    Ok(out)
  }

  pub fn list_files_needing_metadata_refresh(&self) -> anyhow::Result<Vec<FileRecord>> {
    let conn = self.conn()?;
    let mut stmt = conn.prepare(
      "SELECT DISTINCT
         f.id, f.folder_id, f.abs_path, f.ext, f.size_bytes, f.mtime_utc, f.hash_sha256, f.status,
         f.first_seen_at, f.last_seen_at, f.parser_error, f.guessed_title, f.guessed_author, f.guessed_isbn
       FROM files f
       LEFT JOIN book_files bf ON bf.file_id = f.id
       LEFT JOIN books b ON b.id = bf.book_id
       WHERE f.status <> 'missing'
         AND (
           bf.book_id IS NULL
           OR trim(COALESCE(b.cover_url, '')) = ''
           OR trim(COALESCE(b.description, '')) = ''
           OR trim(COALESCE(b.publisher, '')) = ''
           OR trim(COALESCE(b.publish_date, '')) = ''
           OR trim(COALESCE(b.language, '')) = ''
           OR trim(COALESCE(b.authors_json, '')) IN ('', '[]')
           OR (
             trim(COALESCE(b.isbn10, '')) = ''
             AND trim(COALESCE(b.isbn13, '')) = ''
           )
         )
       ORDER BY f.last_seen_at DESC",
    )?;

    let mut out = Vec::new();
    for row in stmt.query_map([], map_file)? {
      out.push(row?);
    }
    Ok(out)
  }

  pub fn upsert_file_with_existing(
    &self,
    payload: UpsertFilePayload,
    existing: Option<&FileRecord>,
    now: &str,
  ) -> anyhow::Result<(FileRecord, bool)> {
    let conn = self.conn()?;
    let UpsertFilePayload {
      folder_id,
      abs_path,
      ext,
      size_bytes,
      mtime_utc,
      hash_sha256,
      status,
      parser_error,
      guessed_title,
      guessed_author,
      guessed_isbn,
    } = payload;

    if let Some(existing_record) = existing {
      let file_id = existing_record.id.clone();
      let first_seen_at = existing_record.first_seen_at.clone();
      conn.execute(
        "UPDATE files SET folder_id = ?1, ext = ?2, size_bytes = ?3, mtime_utc = ?4, hash_sha256 = ?5, status = ?6, last_seen_at = ?7, parser_error = ?8, guessed_title = ?9, guessed_author = ?10, guessed_isbn = ?11 WHERE id = ?12",
        params![
          &folder_id,
          &ext,
          size_bytes,
          &mtime_utc,
          &hash_sha256,
          &status,
          now,
          &parser_error,
          &guessed_title,
          &guessed_author,
          &guessed_isbn,
          &file_id,
        ],
      )?;

      Ok((
        FileRecord {
          id: file_id,
          folder_id,
          abs_path,
          ext,
          size_bytes,
          mtime_utc,
          hash_sha256,
          status,
          first_seen_at,
          last_seen_at: now.to_string(),
          parser_error,
          guessed_title,
          guessed_author,
          guessed_isbn,
        },
        false,
      ))
    } else {
      let file_id = Uuid::new_v4().to_string();
      conn.execute(
        "INSERT INTO files(id, folder_id, abs_path, ext, size_bytes, mtime_utc, hash_sha256, status, first_seen_at, last_seen_at, parser_error, guessed_title, guessed_author, guessed_isbn) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, ?10, ?11, ?12, ?13)",
        params![
          &file_id,
          &folder_id,
          &abs_path,
          &ext,
          size_bytes,
          &mtime_utc,
          &hash_sha256,
          &status,
          now,
          &parser_error,
          &guessed_title,
          &guessed_author,
          &guessed_isbn,
        ],
      )?;
      Ok((
        FileRecord {
          id: file_id,
          folder_id,
          abs_path,
          ext,
          size_bytes,
          mtime_utc,
          hash_sha256,
          status,
          first_seen_at: now.to_string(),
          last_seen_at: now.to_string(),
          parser_error,
          guessed_title,
          guessed_author,
          guessed_isbn,
        },
        true,
      ))
    }
  }

  pub fn mark_missing_files(&self, folder_id: &str, seen_paths: &HashSet<String>, now: &str) -> anyhow::Result<u64> {
    let conn = self.conn()?;
    let mut stmt = conn.prepare("SELECT id, abs_path, status FROM files WHERE folder_id = ?1")?;
    let mut count = 0u64;
    for row in stmt.query_map(params![folder_id], |row| {
      Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
    })? {
      let (file_id, abs_path, prev_status) = row?;
      if !seen_paths.contains(&abs_path) && prev_status != "missing" {
        conn.execute(
          "UPDATE files SET status = 'missing', last_seen_at = ?1 WHERE id = ?2",
          params![now, file_id],
        )?;
        count += 1;
      }
    }
    Ok(count)
  }

  pub fn mark_file_missing(&self, file_id: &str, missing: bool, now: &str) -> anyhow::Result<()> {
    self.conn()?.execute(
      "UPDATE files SET status = ?1, last_seen_at = ?2 WHERE id = ?3",
      params![if missing { "missing" } else { "discovered" }, now, file_id],
    )?;
    Ok(())
  }

  pub fn get_library_tags(&self) -> anyhow::Result<Vec<TagCount>> {
    let conn = self.conn()?;
    let mut stmt = conn.prepare(
      "SELECT t.label, COUNT(bt.book_id) AS book_count
       FROM tags t
       JOIN book_tags bt ON bt.tag_id = t.id
       JOIN books b ON b.id = bt.book_id
       WHERE b.hidden = 0
       GROUP BY t.id, t.label
       ORDER BY lower(t.label) ASC",
    )?;
    let mut out = Vec::new();
    for row in stmt.query_map([], |row| {
      Ok(TagCount {
        tag: row.get(0)?,
        count: row.get(1)?,
      })
    })? {
      out.push(row?);
    }
    Ok(out)
  }

  pub fn set_book_tags(&self, book_id: &str, tags: Vec<String>, now: &str) -> anyhow::Result<()> {
    let mut conn = self.conn()?;
    let tx = conn.transaction()?;

    Self::set_book_tags_tx(&tx, book_id, tags, now)?;
    tx.commit()?;
    Ok(())
  }

  fn set_book_tags_tx(
    tx: &rusqlite::Transaction<'_>,
    book_id: &str,
    tags: Vec<String>,
    now: &str,
  ) -> anyhow::Result<()> {
    let exists = tx
      .query_row(
        "SELECT id FROM books WHERE id = ?1",
        params![book_id],
        |row| row.get::<_, String>(0),
      )
      .optional()?;
    if exists.is_none() {
      return Err(anyhow!("book not found"));
    }

    tx.execute("DELETE FROM book_tags WHERE book_id = ?1", params![book_id])?;

    let mut seen_keys = HashSet::new();
    for raw_tag in tags {
      let Some(label) = normalize_tag_label(&raw_tag) else {
        continue;
      };
      let Some(key) = normalize_tag_key(&label) else {
        continue;
      };
      if !seen_keys.insert(key.clone()) {
        continue;
      }

      let tag_id = tx
        .query_row("SELECT id FROM tags WHERE key = ?1", params![&key], |row| {
          row.get::<_, String>(0)
        })
        .optional()?
        .unwrap_or_else(|| Uuid::new_v4().to_string());

      tx.execute(
        "INSERT OR IGNORE INTO tags(id, key, label, created_at) VALUES(?1, ?2, ?3, ?4)",
        params![&tag_id, &key, &label, now],
      )?;
      tx.execute(
        "INSERT OR IGNORE INTO book_tags(book_id, tag_id, created_at) VALUES(?1, ?2, ?3)",
        params![book_id, tag_id, now],
      )?;
    }

    tx.execute("DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM book_tags)", [])?;
    Ok(())
  }

  pub fn merge_tags(
    &self,
    source_tags: Vec<String>,
    target_tag: String,
    now: &str,
  ) -> anyhow::Result<TagMergeResult> {
    let source_keys = normalize_tag_keys(source_tags);
    if source_keys.is_empty() {
      return Err(anyhow!("select at least one source tag"));
    }

    let target_label = normalize_tag_label(&target_tag).ok_or_else(|| anyhow!("target tag is required"))?;
    let target_key = normalize_tag_key(&target_label).ok_or_else(|| anyhow!("target tag is required"))?;

    let mut conn = self.conn()?;
    let tx = conn.transaction()?;

    let source_placeholders = vec!["?"; source_keys.len()].join(",");
    let mut source_ids: Vec<String> = Vec::new();
    {
      let mut stmt = tx.prepare(&format!("SELECT id FROM tags WHERE key IN ({source_placeholders})"))?;
      for row in stmt.query_map(params_from_iter(source_keys.iter()), |row| row.get::<_, String>(0))? {
        source_ids.push(row?);
      }
    }
    source_ids.sort();
    source_ids.dedup();

    if source_ids.is_empty() {
      return Err(anyhow!("no matching tags found"));
    }

    let target_id = tx
      .query_row(
        "SELECT id FROM tags WHERE key = ?1",
        params![&target_key],
        |row| row.get::<_, String>(0),
      )
      .optional()?
      .unwrap_or_else(|| Uuid::new_v4().to_string());

    tx.execute(
      "INSERT OR IGNORE INTO tags(id, key, label, created_at) VALUES(?1, ?2, ?3, ?4)",
      params![&target_id, &target_key, &target_label, now],
    )?;
    tx.execute(
      "UPDATE tags SET label = ?1 WHERE id = ?2",
      params![&target_label, &target_id],
    )?;

    let merge_source_ids: Vec<String> = source_ids
      .into_iter()
      .filter(|tag_id| tag_id != &target_id)
      .collect();
    if merge_source_ids.is_empty() {
      tx.commit()?;
      return Ok(TagMergeResult {
        target_tag: target_label,
        merged_tag_count: 0,
        affected_books: 0,
      });
    }

    let merge_placeholders = vec!["?"; merge_source_ids.len()].join(",");
    let affected_books = tx.query_row(
      &format!("SELECT COUNT(DISTINCT book_id) FROM book_tags WHERE tag_id IN ({merge_placeholders})"),
      params_from_iter(merge_source_ids.iter()),
      |row| row.get::<_, i64>(0),
    )?;

    let mut insert_params = vec![Value::from(target_id.clone()), Value::from(now.to_string())];
    insert_params.extend(merge_source_ids.iter().cloned().map(Value::from));
    tx.execute(
      &format!(
        "INSERT OR IGNORE INTO book_tags(book_id, tag_id, created_at)
         SELECT DISTINCT book_id, ?1, ?2 FROM book_tags WHERE tag_id IN ({merge_placeholders})"
      ),
      params_from_iter(insert_params.iter()),
    )?;

    tx.execute(
      &format!("DELETE FROM book_tags WHERE tag_id IN ({merge_placeholders})"),
      params_from_iter(merge_source_ids.iter()),
    )?;
    tx.execute(
      &format!("DELETE FROM tags WHERE id IN ({merge_placeholders})"),
      params_from_iter(merge_source_ids.iter()),
    )?;

    tx.execute("DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM book_tags)", [])?;
    tx.commit()?;

    Ok(TagMergeResult {
      target_tag: target_label,
      merged_tag_count: merge_source_ids.len() as i64,
      affected_books,
    })
  }

  pub fn delete_tags(&self, tags: Vec<String>) -> anyhow::Result<TagDeleteResult> {
    let tag_keys = normalize_tag_keys(tags);
    if tag_keys.is_empty() {
      return Err(anyhow!("select at least one tag"));
    }

    let mut conn = self.conn()?;
    let tx = conn.transaction()?;

    let tag_key_placeholders = vec!["?"; tag_keys.len()].join(",");
    let mut tag_ids: Vec<String> = Vec::new();
    {
      let mut stmt = tx.prepare(&format!("SELECT id FROM tags WHERE key IN ({tag_key_placeholders})"))?;
      for row in stmt.query_map(params_from_iter(tag_keys.iter()), |row| row.get::<_, String>(0))? {
        tag_ids.push(row?);
      }
    }
    tag_ids.sort();
    tag_ids.dedup();

    if tag_ids.is_empty() {
      tx.commit()?;
      return Ok(TagDeleteResult {
        deleted_tag_count: 0,
        affected_books: 0,
      });
    }

    let tag_id_placeholders = vec!["?"; tag_ids.len()].join(",");
    let affected_books = tx.query_row(
      &format!("SELECT COUNT(DISTINCT book_id) FROM book_tags WHERE tag_id IN ({tag_id_placeholders})"),
      params_from_iter(tag_ids.iter()),
      |row| row.get::<_, i64>(0),
    )?;

    tx.execute(
      &format!("DELETE FROM book_tags WHERE tag_id IN ({tag_id_placeholders})"),
      params_from_iter(tag_ids.iter()),
    )?;
    tx.execute(
      &format!("DELETE FROM tags WHERE id IN ({tag_id_placeholders})"),
      params_from_iter(tag_ids.iter()),
    )?;
    tx.execute("DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM book_tags)", [])?;
    tx.commit()?;

    Ok(TagDeleteResult {
      deleted_tag_count: tag_ids.len() as i64,
      affected_books,
    })
  }

  pub fn delete_book(&self, book_id: &str, now: &str) -> anyhow::Result<()> {
    let mut conn = self.conn()?;
    let tx = conn.transaction()?;

    let exists = tx
      .query_row(
        "SELECT id FROM books WHERE id = ?1",
        params![book_id],
        |row| row.get::<_, String>(0),
      )
      .optional()?;
    if exists.is_none() {
      return Err(anyhow!("book not found"));
    }

    tx.execute(
      "UPDATE files
       SET status = 'discovered', parser_error = NULL, last_seen_at = ?1
       WHERE id IN (SELECT file_id FROM book_files WHERE book_id = ?2)",
      params![now, book_id],
    )?;
    tx.execute("DELETE FROM book_files WHERE book_id = ?1", params![book_id])?;
    tx.execute("DELETE FROM manual_overrides WHERE book_id = ?1", params![book_id])?;
    tx.execute("DELETE FROM book_tags WHERE book_id = ?1", params![book_id])?;
    tx.execute("DELETE FROM books WHERE id = ?1", params![book_id])?;
    tx.execute("DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM book_tags)", [])?;

    tx.commit()?;
    Ok(())
  }

  pub fn remove_files_and_cleanup_orphan_books(
    &self,
    file_ids: &[String],
    now: &str,
  ) -> anyhow::Result<(u64, u64)> {
    if file_ids.is_empty() {
      return Ok((0, 0));
    }

    let mut conn = self.conn()?;
    let tx = conn.transaction()?;

    let placeholders = vec!["?"; file_ids.len()].join(",");
    let values: Vec<Value> = file_ids.iter().cloned().map(Value::from).collect();

    let existing_sql = format!("SELECT COUNT(*) FROM files WHERE id IN ({placeholders})");
    let removed_files: i64 = tx.query_row(&existing_sql, params_from_iter(values.iter()), |row| row.get(0))?;

    let delete_sql = format!("DELETE FROM files WHERE id IN ({placeholders})");
    tx.execute(&delete_sql, params_from_iter(values.iter()))?;

    let removed_orphan_books: i64 = tx.query_row(
      "SELECT COUNT(*) FROM books b
       WHERE NOT EXISTS (SELECT 1 FROM book_files bf WHERE bf.book_id = b.id)
         AND NOT EXISTS (SELECT 1 FROM book_external_sources bes WHERE bes.book_id = b.id)",
      [],
      |row| row.get(0),
    )?;

    tx.execute(
      "DELETE FROM books WHERE id IN (
         SELECT b.id
         FROM books b
         WHERE NOT EXISTS (SELECT 1 FROM book_files bf WHERE bf.book_id = b.id)
           AND NOT EXISTS (SELECT 1 FROM book_external_sources bes WHERE bes.book_id = b.id)
       )",
      [],
    )?;
    tx.execute("DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM book_tags)", [])?;
    tx.execute(
      "UPDATE files SET last_seen_at = ?1 WHERE id IN (SELECT file_id FROM book_files)",
      params![now],
    )?;
    tx.commit()?;

    Ok((removed_files.max(0) as u64, removed_orphan_books.max(0) as u64))
  }

  pub fn cleanup_orphan_books(&self) -> anyhow::Result<u64> {
    let mut conn = self.conn()?;
    let tx = conn.transaction()?;
    let removed_orphan_books: i64 = tx.query_row(
      "SELECT COUNT(*) FROM books b
       WHERE NOT EXISTS (SELECT 1 FROM book_files bf WHERE bf.book_id = b.id)
         AND NOT EXISTS (SELECT 1 FROM book_external_sources bes WHERE bes.book_id = b.id)",
      [],
      |row| row.get(0),
    )?;

    tx.execute(
      "DELETE FROM books WHERE id IN (
         SELECT b.id
         FROM books b
         WHERE NOT EXISTS (SELECT 1 FROM book_files bf WHERE bf.book_id = b.id)
           AND NOT EXISTS (SELECT 1 FROM book_external_sources bes WHERE bes.book_id = b.id)
       )",
      [],
    )?;
    tx.execute("DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM book_tags)", [])?;
    tx.commit()?;
    Ok(removed_orphan_books.max(0) as u64)
  }

  pub fn consolidate_duplicate_books(&self, now: &str) -> anyhow::Result<u64> {
    let mut conn = self.conn()?;
    let tx = conn.transaction()?;

    // ⚡ Bolt Optimization: Replace LEFT JOIN + GROUP BY with scalar subquery
    // Using a correlated subquery with an index bypasses the memory and sorting
    // overhead of joining the massive `books` table against `book_files` and
    // aggregating every column.
    let mut stmt = tx.prepare(
      "SELECT
         b.id,
         b.title,
         b.authors_json,
         b.isbn10,
         b.isbn13,
         b.updated_at,
         EXISTS(SELECT 1 FROM manual_overrides mo WHERE mo.book_id = b.id) AS has_manual_overrides,
         (SELECT COUNT(DISTINCT bf.file_id) FROM book_files bf WHERE bf.book_id = b.id) AS file_count
       FROM books b",
    )?;

    let mut candidates = Vec::new();
    for row in stmt.query_map([], |row| {
      let authors_json = row.get::<_, String>(2)?;
      let authors = serde_json::from_str::<Vec<String>>(&authors_json).unwrap_or_default();
      Ok(BookDedupCandidate {
        id: row.get(0)?,
        title: row.get(1)?,
        authors,
        isbn10: row.get(3)?,
        isbn13: row.get(4)?,
        updated_at: row.get(5)?,
        has_manual_overrides: row.get::<_, i64>(6)? == 1,
        file_count: row.get(7)?,
      })
    })? {
      let candidate = row?;
      candidates.push(candidate);
    }
    drop(stmt);

    let mut parents: Vec<usize> = (0..candidates.len()).collect();
    let mut key_owner: HashMap<String, usize> = HashMap::new();
    for (index, candidate) in candidates.iter().enumerate() {
      for key in book_dedup_keys(candidate) {
        if let Some(existing_index) = key_owner.insert(key, index) {
          union_parent(&mut parents, existing_index, index);
        }
      }
    }

    let mut grouped: HashMap<usize, Vec<BookDedupCandidate>> = HashMap::new();
    for (index, candidate) in candidates.into_iter().enumerate() {
      let root = find_parent(&mut parents, index);
      grouped.entry(root).or_default().push(candidate);
    }

    let mut merged_duplicate_books = 0u64;
    for group in grouped.values_mut() {
      if group.len() < 2 {
        continue;
      }

      group.sort_by(|left, right| {
        right
          .has_manual_overrides
          .cmp(&left.has_manual_overrides)
          .then_with(|| right.file_count.cmp(&left.file_count))
          .then_with(|| right.updated_at.cmp(&left.updated_at))
          .then_with(|| left.id.cmp(&right.id))
      });
      let primary_book_id = group[0].id.clone();

      for duplicate in group.iter().skip(1) {
        tx.execute(
          "INSERT OR IGNORE INTO book_tags(book_id, tag_id, created_at)
           SELECT ?1, tag_id, ?2 FROM book_tags WHERE book_id = ?3",
          params![&primary_book_id, now, &duplicate.id],
        )?;
        let transferable_overrides = {
          let mut stmt = tx.prepare(
            "SELECT duplicate.field_name, duplicate.field_value
             FROM manual_overrides duplicate
             WHERE duplicate.book_id = ?1
               AND NOT EXISTS (
                 SELECT 1 FROM manual_overrides primary_override
                 WHERE primary_override.book_id = ?2
                   AND primary_override.field_name = duplicate.field_name
               )",
          )?;
          let rows = stmt
            .query_map(params![&duplicate.id, &primary_book_id], |row| {
              Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
          rows
        };
        for (field_name, field_value) in transferable_overrides {
          if !is_book_column_allowed(&field_name) || field_name == "cover_local_path" {
            continue;
          }
          let update_sql = if field_name == "cover_url" {
            "UPDATE books SET cover_url = ?1, cover_local_path = NULL, updated_at = ?2 WHERE id = ?3".to_string()
          } else {
            format!("UPDATE books SET {field_name} = ?1, updated_at = ?2 WHERE id = ?3")
          };
          if matches!(field_name.as_str(), "page_count" | "series_index") {
            let numeric_value = field_value
              .as_deref()
              .map(str::parse::<i64>)
              .transpose()
              .with_context(|| format!("invalid numeric manual override for {field_name}"))?;
            tx.execute(&update_sql, params![numeric_value, now, &primary_book_id])?;
          } else {
            tx.execute(&update_sql, params![field_value, now, &primary_book_id])?;
          }
        }
        tx.execute(
          "DELETE FROM manual_overrides
           WHERE book_id = ?1
             AND field_name IN (SELECT field_name FROM manual_overrides WHERE book_id = ?2)",
          params![&duplicate.id, &primary_book_id],
        )?;
        tx.execute(
          "UPDATE manual_overrides SET book_id = ?1 WHERE book_id = ?2",
          params![&primary_book_id, &duplicate.id],
        )?;
        tx.execute(
          "UPDATE book_external_sources SET book_id = ?1, updated_at = ?2 WHERE book_id = ?3",
          params![&primary_book_id, now, &duplicate.id],
        )?;
        tx.execute(
          "UPDATE book_files SET book_id = ?1 WHERE book_id = ?2",
          params![&primary_book_id, &duplicate.id],
        )?;
        tx.execute("DELETE FROM books WHERE id = ?1", params![&duplicate.id])?;
        merged_duplicate_books += 1;
      }
    }

    tx.execute("DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM book_tags)", [])?;
    tx.commit()?;

    Ok(merged_duplicate_books)
  }

  pub fn find_book_by_isbn(&self, isbn10: Option<&str>, isbn13: Option<&str>) -> anyhow::Result<Option<String>> {
    let conn = self.conn()?;
    Self::find_book_by_isbn_conn(&conn, isbn10, isbn13)
  }

  fn find_book_by_isbn_conn(
    conn: &Connection,
    isbn10: Option<&str>,
    isbn13: Option<&str>,
  ) -> anyhow::Result<Option<String>> {
    if let Some(isbn13_value) = isbn13 {
      if let Some(book_id) = conn
        .query_row(
          "SELECT id FROM books WHERE isbn13 = ?1 LIMIT 1",
          params![isbn13_value],
          |row| row.get::<_, String>(0),
        )
        .optional()?
      {
        return Ok(Some(book_id));
      }
    }
    if let Some(isbn10_value) = isbn10 {
      if let Some(book_id) = conn
        .query_row(
          "SELECT id FROM books WHERE isbn10 = ?1 LIMIT 1",
          params![isbn10_value],
          |row| row.get::<_, String>(0),
        )
        .optional()?
      {
        return Ok(Some(book_id));
      }
    }
    Ok(None)
  }

  pub fn find_book_by_file_hash(
    &self,
    hash_sha256: &str,
    excluding_file_id: &str,
  ) -> anyhow::Result<Option<String>> {
    if hash_sha256.trim().is_empty() {
      return Ok(None);
    }
    Ok(
      self
        .conn()?
        .query_row(
          "SELECT bf.book_id
           FROM files f
           JOIN book_files bf ON bf.file_id = f.id
           WHERE f.hash_sha256 = ?1
             AND f.id <> ?2
           ORDER BY
             CASE f.status
               WHEN 'matched' THEN 0
               WHEN 'missing' THEN 1
               ELSE 2
             END ASC,
             f.last_seen_at DESC
           LIMIT 1",
          params![hash_sha256, excluding_file_id],
          |row| row.get::<_, String>(0),
        )
        .optional()?,
    )
  }

  pub fn find_book_id_for_file(&self, file_id: &str) -> anyhow::Result<Option<String>> {
    Ok(
      self
        .conn()?
        .query_row(
          "SELECT book_id FROM book_files WHERE file_id = ?1 LIMIT 1",
          params![file_id],
          |row| row.get::<_, String>(0),
        )
        .optional()?,
    )
  }

  pub fn get_scan_on_startup(&self) -> anyhow::Result<bool> {
    let value = self
      .conn()?
      .query_row(
        "SELECT value FROM library_settings WHERE key = 'scan_on_startup' LIMIT 1",
        [],
        |row| row.get::<_, String>(0),
      )
      .optional()?;
    Ok(parse_bool_setting(value.as_deref(), true))
  }

  pub fn set_scan_on_startup(&self, enabled: bool, now: &str) -> anyhow::Result<()> {
    self.conn()?.execute(
      "INSERT INTO library_settings(key, value, updated_at) VALUES('scan_on_startup', ?1, ?2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      params![if enabled { "1" } else { "0" }, now],
    )?;
    Ok(())
  }

  pub fn get_library_thing_enabled(&self) -> anyhow::Result<bool> {
    let value = self.get_setting_value("library_thing_enabled")?;
    Ok(parse_bool_setting(value.as_deref(), false))
  }

  pub fn set_library_thing_enabled(&self, enabled: bool, now: &str) -> anyhow::Result<()> {
    self.set_setting_value("library_thing_enabled", if enabled { "1" } else { "0" }, now)
  }

  pub fn get_library_thing_catalog_label(&self) -> anyhow::Result<Option<String>> {
    self.get_setting_value("library_thing_catalog_label")
  }

  pub fn set_library_thing_catalog_label(&self, label: Option<String>, now: &str) -> anyhow::Result<()> {
    let conn = self.conn()?;
    if let Some(value) = label.and_then(|value| normalized_non_empty_setting(&value)) {
      conn.execute(
        "INSERT INTO library_settings(key, value, updated_at) VALUES('library_thing_catalog_label', ?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![value, now],
      )?;
    } else {
      conn.execute(
        "DELETE FROM library_settings WHERE key = 'library_thing_catalog_label'",
        [],
      )?;
    }
    Ok(())
  }

  pub fn get_library_thing_last_import_at(&self) -> anyhow::Result<Option<String>> {
    self.get_setting_value("library_thing_last_import_at")
  }

  pub fn set_library_thing_last_import_at(&self, imported_at: &str, now: &str) -> anyhow::Result<()> {
    self.set_setting_value("library_thing_last_import_at", imported_at, now)
  }

  pub fn count_library_thing_books(&self) -> anyhow::Result<i64> {
    self.conn()?.query_row(
      "SELECT COUNT(DISTINCT book_id) FROM book_external_sources WHERE source = 'librarything'",
      [],
      |row| row.get(0),
    ).map_err(Into::into)
  }

  fn get_setting_value(&self, key: &str) -> anyhow::Result<Option<String>> {
    Ok(
      self
        .conn()?
        .query_row(
          "SELECT value FROM library_settings WHERE key = ?1 LIMIT 1",
          params![key],
          |row| row.get::<_, String>(0),
        )
        .optional()?,
    )
  }

  fn set_setting_value(&self, key: &str, value: &str, now: &str) -> anyhow::Result<()> {
    self.conn()?.execute(
      "INSERT INTO library_settings(key, value, updated_at) VALUES(?1, ?2, ?3)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      params![key, value, now],
    )?;
    Ok(())
  }

  pub fn find_unique_book_by_exact_title(&self, title: &str) -> anyhow::Result<Option<String>> {
    let trimmed = title.trim();
    if trimmed.is_empty() {
      return Ok(None);
    }

    let conn = self.conn()?;
    let mut stmt = conn.prepare(
      "SELECT id
       FROM books
       WHERE lower(trim(title)) = lower(trim(?1))
       ORDER BY updated_at DESC
       LIMIT 2",
    )?;
    let mut rows = stmt.query(params![trimmed])?;
    let Some(first_row) = rows.next()? else {
      return Ok(None);
    };
    let book_id = first_row.get::<_, String>(0)?;
    if rows.next()?.is_some() {
      Ok(None)
    } else {
      Ok(Some(book_id))
    }
  }

  pub fn find_book_by_title_author(&self, title: &str, authors: &[String]) -> anyhow::Result<Option<String>> {
    let conn = self.conn()?;
    Self::find_book_by_title_author_conn(&conn, title, authors)
  }

  fn find_book_by_title_author_conn(
    conn: &Connection,
    title: &str,
    authors: &[String],
  ) -> anyhow::Result<Option<String>> {
    if title.trim().is_empty() {
      return Ok(None);
    }
    let normalized_title = normalize_text(title);
    if normalized_title.is_empty() {
      return Ok(None);
    }

    let total_books: i64 = conn.query_row("SELECT COUNT(*) FROM books", [], |row| row.get(0))?;
    let use_prefilter = total_books >= 2_000;

    let first_token = normalized_title
      .split_whitespace()
      .next()
      .unwrap_or_default()
      .to_string();
    let title_prefix_len = normalized_title.len().min(24);
    let title_prefix = normalized_title.get(0..title_prefix_len).unwrap_or_default().to_string();
    let like_prefix = format!("{title_prefix}%");
    let like_token = if first_token.len() >= 4 {
      format!("%{first_token}%")
    } else {
      format!("%{title_prefix}%")
    };
    let title_len = title.trim().len() as i64;

    let query = if use_prefilter {
      "WITH limited_books AS (
         SELECT id, title, authors_json
         FROM books
         WHERE (
           lower(title) LIKE ?1
           OR lower(title) LIKE ?2
           OR abs(length(title) - ?3) <= 36
         )
         ORDER BY
           CASE
             WHEN lower(title) LIKE ?1 THEN 0
             WHEN lower(title) LIKE ?2 THEN 1
             ELSE 2
           END,
           abs(length(title) - ?3),
           id
         LIMIT 200
       )
       SELECT lb.id, lb.title, lb.authors_json, (SELECT COUNT(DISTINCT bf.file_id) FROM book_files bf WHERE bf.book_id = lb.id) AS file_count
       FROM limited_books lb"
    } else {
      "SELECT b.id, b.title, b.authors_json, (SELECT COUNT(DISTINCT bf.file_id) FROM book_files bf WHERE bf.book_id = b.id) AS file_count
       FROM books b"
    };
    let mut stmt = conn.prepare(query)?;

    let incoming_authors: Vec<String> = authors.iter().map(|value| normalize_text(value)).collect();
    let mut best: Option<(String, f64, i64)> = None;

    let mut consider_candidate = |book_id: String, book_title: String, authors_json: String, file_count: i64| {
      let title_score = strsim::jaro_winkler(&normalized_title, &normalize_text(&book_title));
      if title_score < 0.9 {
        return;
      }
      let book_authors: Vec<String> = serde_json::from_str::<Vec<String>>(&authors_json)
        .unwrap_or_default()
        .iter()
        .map(|value| normalize_text(value))
        .collect();
      let mut author_score: f64 = 0.5;
      for left in &incoming_authors {
        for right in &book_authors {
          author_score = author_score.max(strsim::jaro_winkler(left, right));
        }
      }
      let score = (title_score * 0.7) + (author_score * 0.3);
      if score >= 0.88 {
        let should_replace = match &best {
          None => true,
          Some((_, best_score, best_file_count)) => {
            score > *best_score + 1e-6
              || ((score - *best_score).abs() <= 1e-6 && file_count > *best_file_count)
          }
        };
        if should_replace {
          best = Some((book_id, score, file_count));
        }
      }
    };

    if use_prefilter {
      for row in stmt.query_map(params![like_prefix, like_token, title_len], |row| {
        Ok((
          row.get::<_, String>(0)?,
          row.get::<_, String>(1)?,
          row.get::<_, String>(2)?,
          row.get::<_, i64>(3)?,
        ))
      })? {
        let (book_id, book_title, authors_json, file_count) = row?;
        consider_candidate(book_id, book_title, authors_json, file_count);
      }
    } else {
      for row in stmt.query_map([], |row| {
        Ok((
          row.get::<_, String>(0)?,
          row.get::<_, String>(1)?,
          row.get::<_, String>(2)?,
          row.get::<_, i64>(3)?,
        ))
      })? {
        let (book_id, book_title, authors_json, file_count) = row?;
        consider_candidate(book_id, book_title, authors_json, file_count);
      }
    }

    Ok(best.map(|(book_id, _, _)| book_id))
  }

  pub fn find_book_by_external_source(&self, source: &str, external_id: &str) -> anyhow::Result<Option<String>> {
    Ok(
      self
        .conn()?
        .query_row(
          "SELECT book_id FROM book_external_sources WHERE source = ?1 AND external_id = ?2 LIMIT 1",
          params![source, external_id],
          |row| row.get::<_, String>(0),
        )
        .optional()?,
    )
  }

  pub fn upsert_external_source(
    &self,
    book_id: &str,
    source: &str,
    external_id: &str,
    external_work_id: Option<&str>,
    external_url: &str,
    metadata_json: &str,
    now: &str,
  ) -> anyhow::Result<bool> {
    let mut conn = self.conn()?;
    let tx = conn.transaction()?;
    let existed = tx
      .query_row(
        "SELECT 1 FROM book_external_sources WHERE source = ?1 AND external_id = ?2 LIMIT 1",
        params![source, external_id],
        |_| Ok(()),
      )
      .optional()?
      .is_some();
    tx.execute(
      "INSERT INTO book_external_sources(id, book_id, source, external_id, external_work_id, external_url, metadata_json, imported_at, updated_at)
       VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
       ON CONFLICT(source, external_id) DO UPDATE SET
         book_id = excluded.book_id,
         external_work_id = excluded.external_work_id,
         external_url = excluded.external_url,
         metadata_json = excluded.metadata_json,
         updated_at = excluded.updated_at",
      params![
        Uuid::new_v4().to_string(),
        book_id,
        source,
        external_id,
        external_work_id,
        external_url,
        metadata_json,
        now,
      ],
    )?;
    tx.commit()?;
    Ok(!existed)
  }

  pub fn clear_library_thing_sources(&self, now: &str) -> anyhow::Result<(u64, u64)> {
    let mut conn = self.conn()?;
    let tx = conn.transaction()?;
    let mut book_ids = Vec::new();
    {
      let mut stmt = tx.prepare(
        "SELECT DISTINCT book_id FROM book_external_sources WHERE source = 'librarything'",
      )?;
      for row in stmt.query_map([], |row| row.get::<_, String>(0))? {
        book_ids.push(row?);
      }
    }
    let removed_sources = tx.execute(
      "DELETE FROM book_external_sources WHERE source = 'librarything'",
      [],
    )?;
    tx.execute(
      "DELETE FROM library_settings WHERE key IN ('library_thing_enabled', 'library_thing_catalog_label', 'library_thing_last_import_at')",
      [],
    )?;

    let mut removed_books = 0usize;
    if !book_ids.is_empty() {
      let placeholders = vec!["?"; book_ids.len()].join(",");
      let mut values: Vec<Value> = book_ids.into_iter().map(Value::from).collect();
      let count_sql = format!(
        "SELECT COUNT(*) FROM books b
         WHERE b.id IN ({placeholders})
           AND NOT EXISTS (SELECT 1 FROM book_files bf WHERE bf.book_id = b.id)
           AND NOT EXISTS (SELECT 1 FROM book_external_sources bes WHERE bes.book_id = b.id)"
      );
      removed_books = tx.query_row(&count_sql, params_from_iter(values.iter()), |row| row.get::<_, i64>(0))? as usize;
      let delete_sql = format!(
        "DELETE FROM books
         WHERE id IN ({placeholders})
           AND NOT EXISTS (SELECT 1 FROM book_files bf WHERE bf.book_id = books.id)
           AND NOT EXISTS (SELECT 1 FROM book_external_sources bes WHERE bes.book_id = books.id)"
      );
      tx.execute(&delete_sql, params_from_iter(values.iter()))?;
      values.clear();
    }
    tx.execute("UPDATE files SET last_seen_at = ?1 WHERE id IN (SELECT file_id FROM book_files)", params![now])?;
    tx.commit()?;
    Ok((removed_sources as u64, removed_books as u64))
  }

  pub fn upsert_book(&self, input: UpsertBookInput, now: &str) -> anyhow::Result<String> {
    let UpsertBookInput {
      title,
      subtitle,
      authors,
      publisher,
      publish_date,
      isbn10,
      isbn13,
      description,
      language,
      page_count,
      series,
      series_index,
      cover_url,
      metadata_source,
      confidence,
    } = input;

    let mut conn = self.conn()?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let mut existing = Self::find_book_by_isbn_conn(&tx, isbn10.as_deref(), isbn13.as_deref())?;
    if existing.is_none() && !title.trim().is_empty() && !authors.is_empty() {
      existing = Self::find_book_by_title_author_conn(&tx, &title, &authors)?;
    }
    let incoming_authors_json = serde_json::to_string(&authors)?;

    let book_id = if let Some(book_id) = existing {
      let overrides = Self::get_manual_override_fields_conn(&tx, &book_id)?;
      let title = if overrides.contains("title") {
        Self::get_book_field_conn(&tx, &book_id, "title")?.unwrap_or(title)
      } else {
        title
      };
      let subtitle = if overrides.contains("subtitle") {
        Self::get_book_field_conn(&tx, &book_id, "subtitle")?
      } else {
        preserve_existing_text(subtitle, Self::get_book_field_conn(&tx, &book_id, "subtitle")?)
      };
      let authors_json = if overrides.contains("authors_json") || authors.is_empty() {
        Self::get_book_field_conn(&tx, &book_id, "authors_json")?
          .unwrap_or(incoming_authors_json.clone())
      } else {
        incoming_authors_json.clone()
      };
      let publisher = if overrides.contains("publisher") {
        Self::get_book_field_conn(&tx, &book_id, "publisher")?
      } else {
        preserve_existing_text(publisher, Self::get_book_field_conn(&tx, &book_id, "publisher")?)
      };
      let publish_date = if overrides.contains("publish_date") {
        Self::get_book_field_conn(&tx, &book_id, "publish_date")?
      } else {
        preserve_existing_text(publish_date, Self::get_book_field_conn(&tx, &book_id, "publish_date")?)
      };
      let isbn10 = if overrides.contains("isbn10") {
        Self::get_book_field_conn(&tx, &book_id, "isbn10")?
      } else {
        preserve_existing_text(isbn10, Self::get_book_field_conn(&tx, &book_id, "isbn10")?)
      };
      let isbn13 = if overrides.contains("isbn13") {
        Self::get_book_field_conn(&tx, &book_id, "isbn13")?
      } else {
        preserve_existing_text(isbn13, Self::get_book_field_conn(&tx, &book_id, "isbn13")?)
      };
      let description = if overrides.contains("description") {
        Self::get_book_field_conn(&tx, &book_id, "description")?
      } else {
        preserve_existing_text(description, Self::get_book_field_conn(&tx, &book_id, "description")?)
      };
      let language = if overrides.contains("language") {
        Self::get_book_field_conn(&tx, &book_id, "language")?
      } else {
        preserve_existing_text(language, Self::get_book_field_conn(&tx, &book_id, "language")?)
      };
      let page_count = if overrides.contains("page_count") {
        Self::get_book_i64_field_conn(&tx, &book_id, "page_count")?
      } else {
        preserve_existing_i64(page_count, Self::get_book_i64_field_conn(&tx, &book_id, "page_count")?)
      };
      let series = if overrides.contains("series") {
        Self::get_book_field_conn(&tx, &book_id, "series")?
      } else {
        preserve_existing_text(series, Self::get_book_field_conn(&tx, &book_id, "series")?)
      };
      let series_index = if overrides.contains("series_index") {
        Self::get_book_i64_field_conn(&tx, &book_id, "series_index")?
      } else {
        preserve_existing_i64(series_index, Self::get_book_i64_field_conn(&tx, &book_id, "series_index")?)
      };
      let existing_cover_url = Self::get_book_field_conn(&tx, &book_id, "cover_url")?;
      let existing_cover_local_path = Self::get_book_field_conn(&tx, &book_id, "cover_local_path")?;
      let cover_url = if overrides.contains("cover_url") {
        existing_cover_url.clone()
      } else {
        preserve_existing_text(cover_url, existing_cover_url.clone())
      };
      let cover_local_path = if cover_url == existing_cover_url {
        existing_cover_local_path
      } else {
        None
      };

      tx.execute(
        "UPDATE books SET title = ?1, subtitle = ?2, authors_json = ?3, publisher = ?4, publish_date = ?5, isbn10 = ?6, isbn13 = ?7, description = ?8, language = ?9, page_count = ?10, series = ?11, series_index = ?12, cover_url = ?13, cover_local_path = ?14, metadata_source = ?15, confidence = ?16, updated_at = ?17 WHERE id = ?18",
        params![
          title,
          subtitle,
          authors_json,
          publisher,
          publish_date,
          isbn10,
          isbn13,
          description,
          language,
          page_count,
          series,
          series_index,
          cover_url,
          cover_local_path,
          metadata_source,
          confidence,
          now,
          book_id,
        ],
      )?;
      book_id
    } else {
      let id = Uuid::new_v4().to_string();
      tx.execute(
        "INSERT INTO books(id, title, subtitle, authors_json, publisher, publish_date, isbn10, isbn13, description, language, page_count, series, series_index, cover_url, cover_local_path, metadata_source, confidence, created_at, updated_at) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, NULL, ?15, ?16, ?17, ?17)",
        params![
          id,
          title,
          subtitle,
          incoming_authors_json,
          publisher,
          publish_date,
          isbn10,
          isbn13,
          description,
          language,
          page_count,
          series,
          series_index,
          cover_url,
          metadata_source,
          confidence,
          now,
        ],
      )?;
      id
    };
    tx.commit()?;
    Ok(book_id)
  }

  pub fn update_book_by_id_ignoring_manual_overrides(
    &self,
    book_id: &str,
    input: UpsertBookInput,
    now: &str,
  ) -> anyhow::Result<()> {
    self.update_book_by_id_with_override_policy(book_id, input, now, false)
  }

  pub fn repair_legacy_library_thing_publication(
    &self,
    book_id: &str,
    publication_display: &str,
    publisher: Option<&str>,
    publish_date: Option<&str>,
    page_count: Option<i64>,
    now: &str,
  ) -> anyhow::Result<()> {
    let conn = self.conn()?;
    conn.execute(
      "UPDATE books
       SET publisher = COALESCE(?2, publisher),
           publish_date = COALESCE(publish_date, ?3),
           page_count = COALESCE(page_count, ?4),
           updated_at = ?5
       WHERE id = ?1
         AND publisher = ?6
         AND EXISTS (
           SELECT 1 FROM book_external_sources
           WHERE book_id = books.id AND source = 'librarything'
         )",
      params![book_id, publisher, publish_date, page_count, now, publication_display],
    )?;
    Ok(())
  }

  fn update_book_by_id_with_override_policy(
    &self,
    book_id: &str,
    input: UpsertBookInput,
    now: &str,
    respect_manual_overrides: bool,
  ) -> anyhow::Result<()> {
    let UpsertBookInput {
      title,
      subtitle,
      authors,
      publisher,
      publish_date,
      isbn10,
      isbn13,
      description,
      language,
      page_count,
      series,
      series_index,
      cover_url,
      metadata_source,
      confidence,
    } = input;

    let conn = self.conn()?;
    let overrides = if respect_manual_overrides {
      self.get_manual_override_fields(book_id)?
    } else {
      HashSet::new()
    };
    let incoming_authors_json = serde_json::to_string(&authors)?;

    let title = if overrides.contains("title") {
      self.get_book_field(book_id, "title")?.unwrap_or(title)
    } else {
      title
    };
    let subtitle = if overrides.contains("subtitle") {
      self.get_book_field(book_id, "subtitle")?
    } else {
      preserve_existing_text(subtitle, self.get_book_field(book_id, "subtitle")?)
    };
    let authors_json = if overrides.contains("authors_json") || authors.is_empty() {
      self
        .get_book_field(book_id, "authors_json")?
        .unwrap_or(incoming_authors_json.clone())
    } else {
      incoming_authors_json
    };
    let publisher = if overrides.contains("publisher") {
      self.get_book_field(book_id, "publisher")?
    } else {
      preserve_existing_text(publisher, self.get_book_field(book_id, "publisher")?)
    };
    let publish_date = if overrides.contains("publish_date") {
      self.get_book_field(book_id, "publish_date")?
    } else {
      preserve_existing_text(publish_date, self.get_book_field(book_id, "publish_date")?)
    };
    let isbn10 = if overrides.contains("isbn10") {
      self.get_book_field(book_id, "isbn10")?
    } else {
      preserve_existing_text(isbn10, self.get_book_field(book_id, "isbn10")?)
    };
    let isbn13 = if overrides.contains("isbn13") {
      self.get_book_field(book_id, "isbn13")?
    } else {
      preserve_existing_text(isbn13, self.get_book_field(book_id, "isbn13")?)
    };
    let description = if overrides.contains("description") {
      self.get_book_field(book_id, "description")?
    } else {
      preserve_existing_text(description, self.get_book_field(book_id, "description")?)
    };
    let language = if overrides.contains("language") {
      self.get_book_field(book_id, "language")?
    } else {
      preserve_existing_text(language, self.get_book_field(book_id, "language")?)
    };
    let page_count = if overrides.contains("page_count") {
      self.get_book_i64_field(book_id, "page_count")?
    } else {
      preserve_existing_i64(page_count, self.get_book_i64_field(book_id, "page_count")?)
    };
    let series = if overrides.contains("series") {
      self.get_book_field(book_id, "series")?
    } else {
      preserve_existing_text(series, self.get_book_field(book_id, "series")?)
    };
    let series_index = if overrides.contains("series_index") {
      self.get_book_i64_field(book_id, "series_index")?
    } else {
      preserve_existing_i64(series_index, self.get_book_i64_field(book_id, "series_index")?)
    };
    let existing_cover_url = self.get_book_field(book_id, "cover_url")?;
    let existing_cover_local_path = self.get_book_field(book_id, "cover_local_path")?;
    let cover_url = if overrides.contains("cover_url") {
      existing_cover_url.clone()
    } else {
      preserve_existing_text(cover_url, existing_cover_url.clone())
    };
    let cover_local_path = if cover_url == existing_cover_url {
      existing_cover_local_path
    } else {
      None
    };

    conn.execute(
      "UPDATE books SET title = ?1, subtitle = ?2, authors_json = ?3, publisher = ?4, publish_date = ?5, isbn10 = ?6, isbn13 = ?7, description = ?8, language = ?9, page_count = ?10, series = ?11, series_index = ?12, cover_url = ?13, cover_local_path = ?14, metadata_source = ?15, confidence = ?16, updated_at = ?17 WHERE id = ?18",
      params![
        title,
        subtitle,
        authors_json,
        publisher,
        publish_date,
        isbn10,
        isbn13,
        description,
        language,
        page_count,
        series,
        series_index,
        cover_url,
        cover_local_path,
        metadata_source,
        confidence,
        now,
        book_id,
      ],
    )?;
    Ok(())
  }

  pub fn link_file_to_book(
    &self,
    file_id: &str,
    book_id: &str,
    format: &str,
    is_primary: bool,
    now: &str,
  ) -> anyhow::Result<()> {
    let mut conn = self.conn()?;
    let tx = conn.transaction()?;
    // Make the first operation a write so SQLite obtains the writer lock before
    // this transaction has a read snapshot. A deferred read followed by a write
    // can otherwise fail with SQLITE_BUSY_SNAPSHOT under concurrent scan workers
    // without invoking the configured busy timeout.
    let updated = tx.execute(
      "UPDATE files SET status = 'matched', parser_error = NULL, last_seen_at = ?1 WHERE id = ?2 AND status <> 'missing'",
      params![now, file_id],
    )?;
    if updated == 0 {
      return Err(anyhow!("file no longer available for matching"));
    }

    tx.execute(
      "INSERT INTO book_files(id, book_id, file_id, format, is_primary) VALUES(?1, ?2, ?3, ?4, ?5) ON CONFLICT(file_id) DO UPDATE SET book_id = excluded.book_id, format = excluded.format, is_primary = excluded.is_primary",
      params![Uuid::new_v4().to_string(), book_id, file_id, format, is_primary as i64],
    )?;
    tx.execute("DELETE FROM enrichment_jobs WHERE file_id = ?1", params![file_id])?;
    tx.commit()?;
    Ok(())
  }

  pub fn mark_discovered(
    &self,
    file_id: &str,
    reason: &str,
    guessed_title: Option<String>,
    guessed_author: Option<String>,
    guessed_isbn: Option<String>,
    parser_error: Option<String>,
    query: JsonValue,
    now: &str,
  ) -> anyhow::Result<()> {
    let mut conn = self.conn()?;
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM book_files WHERE file_id = ?1", params![file_id])?;
    tx.execute(
      "UPDATE files SET status = ?1, guessed_title = ?2, guessed_author = ?3, guessed_isbn = ?4, parser_error = ?5, last_seen_at = ?6 WHERE id = ?7",
      params![
        if parser_error.is_some() { "error" } else { "discovered" },
        guessed_title,
        guessed_author,
        guessed_isbn,
        parser_error,
        now,
        file_id,
      ],
    )?;
    tx.execute(
      "INSERT INTO enrichment_jobs(id, file_id, query_json, status, attempt_count, last_attempt_at, error) VALUES(?1, ?2, ?3, 'pending', 0, ?4, ?5) ON CONFLICT(file_id) DO UPDATE SET query_json = excluded.query_json, status = 'pending', last_attempt_at = excluded.last_attempt_at, error = excluded.error",
      params![Uuid::new_v4().to_string(), file_id, query.to_string(), now, reason],
    )?;
    tx.commit()?;
    Ok(())
  }

  pub fn get_book_detail(&self, book_id: &str) -> anyhow::Result<BookDetail> {
    let conn = self.conn()?;
    let library_thing_enabled = library_thing_enabled_from_conn(&conn)?;
    let mut detail = conn
      .query_row(
        "SELECT id, title, subtitle, authors_json, publisher, publish_date, created_at, isbn10, isbn13, description, language, page_count, series, series_index, cover_url, cover_local_path, metadata_source, confidence FROM books WHERE id = ?1",
        params![book_id],
        |row| {
          let authors_json = row.get::<_, String>(3)?;
          Ok(BookDetail {
            id: row.get(0)?,
            title: row.get(1)?,
            subtitle: row.get(2)?,
            authors: serde_json::from_str(&authors_json).unwrap_or_default(),
            tags: Vec::new(),
            publisher: row.get(4)?,
            publish_date: row.get(5)?,
            added_at: row.get(6)?,
            isbn10: row.get(7)?,
            isbn13: row.get(8)?,
            description: row.get(9)?,
            language: row.get(10)?,
            page_count: row.get(11)?,
            series: row.get(12)?,
            series_index: row.get(13)?,
            cover_url: row.get(14)?,
            cover_local_path: row.get(15)?,
            metadata_source: row.get(16)?,
            confidence: row.get(17)?,
            files: Vec::new(),
            library_thing_url: None,
          })
        },
      )
      .optional()?
      .ok_or_else(|| anyhow!("book not found"))?;

    let mut stmt = conn.prepare(
      "SELECT f.id, f.abs_path, bf.format, f.status, lf.path, f.size_bytes
       FROM book_files bf
       JOIN files f ON f.id = bf.file_id
       JOIN library_folders lf ON lf.id = f.folder_id
       WHERE bf.book_id = ?1
       ORDER BY bf.is_primary DESC, f.abs_path ASC",
    )?;

    for row in stmt.query_map(params![book_id], |row| {
      Ok(BookFile {
        file_id: row.get(0)?,
        abs_path: row.get(1)?,
        format: row.get(2)?,
        status: row.get(3)?,
        folder_path: row.get(4)?,
        size_bytes: row.get(5)?,
      })
    })? {
      detail.files.push(row?);
    }

    let mut tag_stmt = conn.prepare(
      "SELECT t.label
       FROM book_tags bt
       JOIN tags t ON t.id = bt.tag_id
       WHERE bt.book_id = ?1
       ORDER BY lower(t.label) ASC",
    )?;
    for row in tag_stmt.query_map(params![book_id], |row| row.get::<_, String>(0))? {
      detail.tags.push(row?);
    }
    if library_thing_enabled {
      detail.library_thing_url = conn
        .query_row(
          "SELECT external_url FROM book_external_sources WHERE book_id = ?1 AND source = 'librarything' LIMIT 1",
          params![book_id],
          |row| row.get::<_, String>(0),
        )
        .optional()?;
    }
    Ok(detail)
  }

  pub fn list_book_ids_missing_cover(&self) -> anyhow::Result<Vec<String>> {
    let conn = self.conn()?;
    let mut stmt = conn.prepare(
      "SELECT id
       FROM books
       WHERE trim(COALESCE(cover_url, '')) = ''
          OR (
            lower(COALESCE(cover_url, '')) LIKE '%books.google.%'
            AND lower(COALESCE(cover_url, '')) LIKE '%/books/content%'
          )
       ORDER BY updated_at DESC",
    )?;
    let mut out = Vec::new();
    for row in stmt.query_map([], |row| row.get::<_, String>(0))? {
      out.push(row?);
    }
    Ok(out)
  }

  pub fn set_book_cover_url(&self, book_id: &str, cover_url: &str, now: &str) -> anyhow::Result<()> {
    let conn = self.conn()?;
    conn.execute(
      "UPDATE books SET cover_url = ?1, cover_local_path = NULL, updated_at = ?2 WHERE id = ?3",
      params![cover_url, now, book_id],
    )?;
    Ok(())
  }

  pub fn set_book_cover_local_path(&self, book_id: &str, cover_local_path: &str) -> anyhow::Result<()> {
    let conn = self.conn()?;
    conn.execute(
      "UPDATE books SET cover_local_path = ?1 WHERE id = ?2",
      params![cover_local_path, book_id],
    )?;
    Ok(())
  }

  pub fn clear_book_cover_url(&self, book_id: &str, now: &str) -> anyhow::Result<()> {
    let conn = self.conn()?;
    conn.execute(
      "UPDATE books SET cover_url = NULL, cover_local_path = NULL, updated_at = ?1 WHERE id = ?2",
      params![now, book_id],
    )?;
    Ok(())
  }

  pub fn get_library_books(
    &self,
    query: Option<String>,
    filters: BookFilters,
    sort: SortSpec,
    page: Option<u32>,
    page_size: Option<u32>,
  ) -> anyhow::Result<Paged<BookCard>> {
    let conn = self.conn()?;
    let library_thing_enabled = library_thing_enabled_from_conn(&conn)?;
    let pagination = page_size.map(|value| {
      let normalized_page_size = value.clamp(1, 200);
      let normalized_page = page.unwrap_or(1).max(1);
      let offset = pagination_offset(normalized_page, normalized_page_size);
      (normalized_page, normalized_page_size, offset)
    });

    let mut where_clauses = vec![
      "b.hidden = 0".to_string(),
      if library_thing_enabled {
        "(EXISTS (SELECT 1 FROM book_files bf0 WHERE bf0.book_id = b.id) OR EXISTS (SELECT 1 FROM book_external_sources bes0 WHERE bes0.book_id = b.id AND bes0.source = 'librarything'))".to_string()
      } else {
        "EXISTS (SELECT 1 FROM book_files bf0 WHERE bf0.book_id = b.id)".to_string()
      },
    ];
    let mut values: Vec<Value> = Vec::new();
    if let Some(text) = query.as_deref().and_then(search_prefix_query) {
      where_clauses.push("b.id IN (SELECT book_id FROM fts_books WHERE fts_books MATCH ?)".to_string());
      values.push(Value::from(text));
    }
    let requested_formats = filters
      .formats
      .iter()
      .map(|item| item.trim().to_lowercase())
      .filter(|item| !item.is_empty())
      .collect::<Vec<_>>();
    if !requested_formats.is_empty() {
      let wants_library_thing = requested_formats.iter().any(|item| item == "librarything");
      let local_formats = requested_formats
        .iter()
        .filter(|item| item.as_str() != "librarything")
        .cloned()
        .collect::<Vec<_>>();
      let mut format_clauses = Vec::new();

      if !local_formats.is_empty() {
        let placeholders = vec!["?"; local_formats.len()].join(",");
        format_clauses.push(format!(
          "EXISTS (SELECT 1 FROM book_files bf2 WHERE bf2.book_id = b.id AND lower(bf2.format) IN ({placeholders}))"
        ));
        for item in local_formats {
          values.push(Value::from(item));
        }
      }

      if wants_library_thing && library_thing_enabled {
        format_clauses.push(
          "EXISTS (SELECT 1 FROM book_external_sources bes2 WHERE bes2.book_id = b.id AND bes2.source = 'librarything')"
            .to_string(),
        );
      }

      if format_clauses.is_empty() {
        where_clauses.push("0 = 1".to_string());
      } else {
        where_clauses.push(format!("({})", format_clauses.join(" OR ")));
      }
    }
    if !filters.tags.is_empty() {
      for tag in filters.tags {
        if let Some(tag_key) = normalize_tag_key(&tag) {
          where_clauses.push(
            "EXISTS (SELECT 1 FROM book_tags btx JOIN tags tx ON tx.id = btx.tag_id WHERE btx.book_id = b.id AND tx.key = ?)"
              .to_string(),
          );
          values.push(Value::from(tag_key));
        }
      }
    }
    if let Some(publisher) = filters.publisher.filter(|value| !value.trim().is_empty()) {
      where_clauses.push("lower(b.publisher) LIKE lower(?)".to_string());
      values.push(Value::from(format!("%{}%", publisher)));
    }
    if let Some(status) = filters.status.filter(|value| !value.trim().is_empty()) {
      where_clauses.push("EXISTS (SELECT 1 FROM book_files bfs JOIN files fs ON fs.id = bfs.file_id WHERE bfs.book_id = b.id AND fs.status = ?)".to_string());
      values.push(Value::from(status));
    }
    if !filters.authors.is_empty() {
      for author in filters.authors {
        where_clauses.push(
          "EXISTS (SELECT 1 FROM json_each(b.authors_json) a WHERE lower(a.value) LIKE lower(?))"
            .to_string(),
        );
        values.push(Value::from(format!("%{}%", author)));
      }
    }

    let (sort_column, outer_sort_column) = match sort.field.as_str() {
      "publisher" => ("lower(COALESCE(b.publisher, ''))", "lower(COALESCE(lb.publisher, ''))"),
      "publishDate" => ("b.publish_date", "lb.publish_date"),
      "createdAt" => ("b.created_at", "lb.created_at"),
      "updatedAt" => ("b.updated_at", "lb.updated_at"),
      "author" => (
        "lower(COALESCE(json_extract(b.authors_json, '$[0]'), ''))",
        "lower(COALESCE(json_extract(lb.authors_json, '$[0]'), ''))",
      ),
      _ => ("lower(b.title)", "lower(lb.title)"),
    };
    let sort_direction = if sort.direction.eq_ignore_ascii_case("desc") { "DESC" } else { "ASC" };
    let title_tiebreaker_direction = if sort.field == "title" { sort_direction } else { "ASC" };
    let where_sql = where_clauses.join(" AND ");

    let total = if pagination.is_some() {
      let total_sql = format!("SELECT COUNT(*) FROM books b WHERE {where_sql}");
      Some(conn.query_row(&total_sql, params_from_iter(values.iter()), |row| row.get(0))?)
    } else {
      None
    };

    let mut list_values = values;
    let mut pagination_clause = String::new();
    if let Some((_, normalized_page_size, offset)) = pagination {
      pagination_clause = "LIMIT ? OFFSET ?".to_string();
      list_values.push(Value::from(normalized_page_size as i64));
      list_values.push(Value::from(offset as i64));
    }
    let list_sql = format!(
      "WITH limited_books AS (
         SELECT b.id, b.title, b.authors_json, b.publisher, b.publish_date, b.cover_url, b.cover_local_path, b.confidence, b.created_at, b.updated_at
         FROM books b
         WHERE {where_sql}
         ORDER BY {sort_column} {sort_direction}, lower(b.title) {title_tiebreaker_direction}, b.title {title_tiebreaker_direction}, b.id ASC
         {pagination_clause}
       )
       SELECT lb.id, lb.title, lb.authors_json, lb.publisher, lb.publish_date, lb.cover_url, lb.cover_local_path, lb.confidence,
        (SELECT COALESCE(group_concat(DISTINCT bf.format), '') FROM book_files bf WHERE bf.book_id = lb.id),
        (SELECT COUNT(DISTINCT bf.file_id) FROM book_files bf WHERE bf.book_id = lb.id),
        (SELECT COUNT(DISTINCT f.id) FROM book_files bf JOIN files f ON f.id = bf.file_id WHERE bf.book_id = lb.id AND f.status = 'missing'),
        (SELECT COALESCE(group_concat(DISTINCT t.label), '') FROM book_tags bt JOIN tags t ON t.id = bt.tag_id WHERE bt.book_id = lb.id),
        CASE WHEN {library_thing_url_enabled} THEN (SELECT external_url FROM book_external_sources bes WHERE bes.book_id = lb.id AND bes.source = 'librarything' LIMIT 1) ELSE NULL END
       FROM limited_books lb
       ORDER BY {outer_sort_column} {sort_direction}, lower(lb.title) {title_tiebreaker_direction}, lb.title {title_tiebreaker_direction}, lb.id ASC"
      ,
      library_thing_url_enabled = if library_thing_enabled { "1" } else { "0" },
    );
    let mut stmt = conn.prepare(&list_sql)?;
    let mut items = Vec::new();
    for row in stmt.query_map(params_from_iter(list_values.iter()), |row| {
      let authors_json = row.get::<_, String>(2)?;
      let formats = row.get::<_, String>(8)?;
      let tags = row.get::<_, String>(11)?;
      let library_thing_url = row.get::<_, Option<String>>(12)?;
      let mut format_values = formats
        .split(',')
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.to_string())
        .collect::<Vec<_>>();
      if library_thing_url.is_some() {
        format_values.push("librarything".to_string());
      }
      Ok(BookCard {
        id: row.get(0)?,
        title: row.get(1)?,
        authors: serde_json::from_str(&authors_json).unwrap_or_default(),
        tags: tags
          .split(',')
          .filter(|value| !value.trim().is_empty())
          .map(|value| value.to_string())
          .collect(),
        publisher: row.get(3)?,
        publish_date: row.get(4)?,
        cover_url: row.get(5)?,
        cover_local_path: row.get(6)?,
        confidence: row.get(7)?,
        formats: format_values,
        file_count: row.get(9)?,
        missing_files: row.get(10)?,
        library_thing_url,
      })
    })? {
      items.push(row?);
    }

    let (response_page, response_page_size) = if let Some((normalized_page, normalized_page_size, _)) = pagination {
      (normalized_page, normalized_page_size)
    } else {
      (
        1,
        if items.is_empty() {
          1
        } else {
          u32::try_from(items.len()).unwrap_or(u32::MAX)
        },
      )
    };

    let total = total.unwrap_or_else(|| i64::try_from(items.len()).unwrap_or(i64::MAX));

    Ok(Paged {
      items,
      total,
      page: response_page,
      page_size: response_page_size,
    })
  }

  pub fn set_books_hidden(&self, book_ids: Vec<String>, hidden: bool, now: &str) -> anyhow::Result<u64> {
    if book_ids.is_empty() {
      return Ok(0);
    }

    let conn = self.conn()?;
    let placeholders = vec!["?"; book_ids.len()].join(",");
    let sql = format!("UPDATE books SET hidden = ?, updated_at = ? WHERE id IN ({placeholders})");

    let mut values: Vec<Value> = Vec::with_capacity(book_ids.len() + 2);
    values.push(Value::from(if hidden { 1_i64 } else { 0_i64 }));
    values.push(Value::from(now.to_string()));
    for book_id in book_ids {
      values.push(Value::from(book_id));
    }

    let updated = conn.execute(&sql, params_from_iter(values.iter()))?;
    Ok(updated as u64)
  }

  pub fn restore_all_hidden_books(&self, now: &str) -> anyhow::Result<u64> {
    let updated = self.conn()?.execute(
      "UPDATE books SET hidden = 0, updated_at = ?1 WHERE hidden = 1",
      params![now],
    )?;
    Ok(updated as u64)
  }

  pub fn get_hidden_books(
    &self,
    query: Option<String>,
    page: Option<u32>,
    page_size: Option<u32>,
  ) -> anyhow::Result<Paged<BookCard>> {
    let conn = self.conn()?;
    let library_thing_enabled = library_thing_enabled_from_conn(&conn)?;
    let page = page.unwrap_or(1).max(1);
    let page_size = page_size.unwrap_or(50).clamp(1, 200);
    let offset = pagination_offset(page, page_size);

    let mut where_clauses = vec![
      "b.hidden = 1".to_string(),
      if library_thing_enabled {
        "(EXISTS (SELECT 1 FROM book_files bf0 WHERE bf0.book_id = b.id) OR EXISTS (SELECT 1 FROM book_external_sources bes0 WHERE bes0.book_id = b.id AND bes0.source = 'librarything'))".to_string()
      } else {
        "EXISTS (SELECT 1 FROM book_files bf0 WHERE bf0.book_id = b.id)".to_string()
      },
    ];
    let mut values: Vec<Value> = Vec::new();
    if let Some(text) = query.as_deref().and_then(search_prefix_query) {
      where_clauses.push("b.id IN (SELECT book_id FROM fts_books WHERE fts_books MATCH ?)".to_string());
      values.push(Value::from(text));
    }

    let where_sql = where_clauses.join(" AND ");
    let total_sql = format!("SELECT COUNT(*) FROM books b WHERE {where_sql}");
    let total: i64 = conn.query_row(&total_sql, params_from_iter(values.iter()), |row| row.get(0))?;

    let mut list_values = values;
    list_values.push(Value::from(page_size as i64));
    list_values.push(Value::from(offset as i64));

    let list_sql = format!(
      "WITH limited_books AS (
         SELECT b.id, b.title, b.authors_json, b.publisher, b.publish_date, b.cover_url, b.cover_local_path, b.confidence, b.updated_at
         FROM books b
         WHERE {where_sql}
         ORDER BY b.updated_at DESC, lower(b.title) ASC, b.title ASC, b.id ASC
         LIMIT ? OFFSET ?
       )
       SELECT lb.id, lb.title, lb.authors_json, lb.publisher, lb.publish_date, lb.cover_url, lb.cover_local_path, lb.confidence,
        (SELECT COALESCE(group_concat(DISTINCT bf.format), '') FROM book_files bf WHERE bf.book_id = lb.id),
        (SELECT COUNT(DISTINCT bf.file_id) FROM book_files bf WHERE bf.book_id = lb.id),
        (SELECT COUNT(DISTINCT f.id) FROM book_files bf JOIN files f ON f.id = bf.file_id WHERE bf.book_id = lb.id AND f.status = 'missing'),
        (SELECT COALESCE(group_concat(DISTINCT t.label), '') FROM book_tags bt JOIN tags t ON t.id = bt.tag_id WHERE bt.book_id = lb.id),
        CASE WHEN {library_thing_url_enabled} THEN (SELECT external_url FROM book_external_sources bes WHERE bes.book_id = lb.id AND bes.source = 'librarything' LIMIT 1) ELSE NULL END
       FROM limited_books lb
       ORDER BY lb.updated_at DESC, lower(lb.title) ASC, lb.title ASC, lb.id ASC"
      ,
      library_thing_url_enabled = if library_thing_enabled { "1" } else { "0" },
    );

    let mut stmt = conn.prepare(&list_sql)?;
    let mut items = Vec::new();
    for row in stmt.query_map(params_from_iter(list_values.iter()), |row| {
      let authors_json = row.get::<_, String>(2)?;
      let formats = row.get::<_, String>(8)?;
      let tags = row.get::<_, String>(11)?;
      let library_thing_url = row.get::<_, Option<String>>(12)?;
      let mut format_values = formats
        .split(',')
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.to_string())
        .collect::<Vec<_>>();
      if library_thing_url.is_some() {
        format_values.push("librarything".to_string());
      }
      Ok(BookCard {
        id: row.get(0)?,
        title: row.get(1)?,
        authors: serde_json::from_str(&authors_json).unwrap_or_default(),
        tags: tags
          .split(',')
          .filter(|value| !value.trim().is_empty())
          .map(|value| value.to_string())
          .collect(),
        publisher: row.get(3)?,
        publish_date: row.get(4)?,
        cover_url: row.get(5)?,
        cover_local_path: row.get(6)?,
        confidence: row.get(7)?,
        formats: format_values,
        file_count: row.get(9)?,
        missing_files: row.get(10)?,
        library_thing_url,
      })
    })? {
      items.push(row?);
    }

    Ok(Paged {
      items,
      total,
      page,
      page_size,
    })
  }

  pub fn get_discovered_files(
    &self,
    query: Option<String>,
    page: Option<u32>,
    page_size: Option<u32>,
  ) -> anyhow::Result<Paged<DiscoveredFile>> {
    let conn = self.conn()?;
    let page = page.unwrap_or(1).max(1);
    let page_size = page_size.unwrap_or(25).clamp(1, 200);
    let offset = pagination_offset(page, page_size);

    let mut where_clauses = vec!["bf.book_id IS NULL".to_string(), "f.status IN ('discovered','error')".to_string()];
    let mut values: Vec<Value> = Vec::new();
    if let Some(text) = query.filter(|value| !value.trim().is_empty()) {
      where_clauses.push("(lower(f.abs_path) LIKE lower(?) OR lower(COALESCE(f.guessed_title,'')) LIKE lower(?) OR lower(COALESCE(f.guessed_author,'')) LIKE lower(?))".to_string());
      let like = format!("%{}%", text);
      values.push(Value::from(like.clone()));
      values.push(Value::from(like.clone()));
      values.push(Value::from(like));
    }

    let where_sql = where_clauses.join(" AND ");
    let total_sql =
      format!("SELECT COUNT(*) FROM files f LEFT JOIN book_files bf ON bf.file_id=f.id WHERE {where_sql}");
    let total: i64 = conn.query_row(&total_sql, params_from_iter(values.iter()), |row| row.get(0))?;

    let mut list_values = values;
    list_values.push(Value::from(page_size as i64));
    list_values.push(Value::from(offset as i64));
    // ⚡ Bolt Optimization: Deferred Join Pagination
    // By applying the LIMIT and OFFSET clauses in a CTE on the base tables first,
    // we prevent SQLite from computing the potentially expensive LEFT JOIN against
    // enrichment_jobs for thousands of discarded rows. This significantly reduces
    // query execution time, especially for pages with large offsets.
    let list_sql = format!(
      "WITH limited_files AS (
         SELECT f.id, f.abs_path, f.folder_id, f.guessed_title, f.guessed_author, f.guessed_isbn, f.status, f.parser_error, f.last_seen_at
         FROM files f
         LEFT JOIN book_files bf ON bf.file_id = f.id
         WHERE {where_sql}
         ORDER BY f.last_seen_at DESC
         LIMIT ? OFFSET ?
       )
       SELECT lf_cte.id, lf_cte.abs_path, lf.path, lf_cte.guessed_title, lf_cte.guessed_author, lf_cte.guessed_isbn, lf_cte.status, lf_cte.parser_error, COALESCE(ej.error, 'Needs metadata match'), lf_cte.last_seen_at
       FROM limited_files lf_cte
       JOIN library_folders lf ON lf.id = lf_cte.folder_id
       LEFT JOIN enrichment_jobs ej ON ej.file_id = lf_cte.id
       ORDER BY lf_cte.last_seen_at DESC"
    );
    let mut stmt = conn.prepare(&list_sql)?;
    let mut items = Vec::new();
    for row in stmt.query_map(params_from_iter(list_values.iter()), map_discovered_file)? {
      items.push(row?);
    }

    Ok(Paged {
      items,
      total,
      page,
      page_size,
    })
  }

  pub fn for_each_discovered_file_unbounded<F>(&self, mut visit: F) -> anyhow::Result<usize>
  where
    F: FnMut(DiscoveredFile) -> anyhow::Result<()>,
  {
    let conn = self.conn()?;
    let sql = "SELECT f.id, f.abs_path, lf.path, f.guessed_title, f.guessed_author, f.guessed_isbn, f.status, f.parser_error, COALESCE(ej.error, 'Needs metadata match'), f.last_seen_at
       FROM files f
       JOIN library_folders lf ON lf.id = f.folder_id
       LEFT JOIN book_files bf ON bf.file_id = f.id
       LEFT JOIN enrichment_jobs ej ON ej.file_id = f.id
       WHERE bf.book_id IS NULL AND f.status IN ('discovered','error')
       ORDER BY f.last_seen_at DESC";
    let mut stmt = conn.prepare(sql)?;
    let mut count = 0usize;
    for row in stmt.query_map([], map_discovered_file)? {
      visit(row?)?;
      count += 1;
    }
    Ok(count)
  }

  pub fn apply_curated_metadata(
    &self,
    book_id: &str,
    selection: Vec<MetadataFieldSelection>,
    lock_updates: Vec<MetadataLockUpdate>,
    now: &str,
  ) -> anyhow::Result<()> {
    let mut conn = self.conn()?;
    let tx = conn.transaction()?;

    let existing_locks = Self::get_manual_override_fields_conn(&tx, book_id)?;
    let unlocked_fields: HashSet<String> = lock_updates
      .iter()
      .filter_map(|update| {
        if update.locked {
          None
        } else {
          metadata_field_to_override_name(&update.field).map(ToString::to_string)
        }
      })
      .collect();

    let mut updates: Vec<String> = Vec::new();
    let mut values: Vec<Value> = Vec::new();
    let mut cover_url_updated = false;
    for selected in selection {
      let Some(db_field) = metadata_field_to_book_column(&selected.field) else {
        continue;
      };
      let Some(lock_field) = metadata_field_to_override_name(&selected.field) else {
        continue;
      };
      if existing_locks.contains(lock_field) && !unlocked_fields.contains(lock_field) {
        continue;
      }
      if selected.field == MetadataField::CoverUrl {
        cover_url_updated = true;
      }

      match selected.field {
        MetadataField::Authors => {
          let Some(list) = selected.values else {
            continue;
          };
          let serialized = serde_json::to_string(&list)?;
          updates.push(format!("{db_field} = ?"));
          values.push(Value::from(serialized));
        }
        MetadataField::PageCount | MetadataField::SeriesIndex => {
          let Some(value) = selected.int_value else {
            continue;
          };
          updates.push(format!("{db_field} = ?"));
          values.push(Value::from(value));
        }
        _ => {
          let Some(value) = selected.value else {
            continue;
          };
          updates.push(format!("{db_field} = ?"));
          values.push(Value::from(value));
        }
      }
    }

    if !updates.is_empty() {
      if cover_url_updated {
        updates.push("cover_local_path = NULL".to_string());
      }
      updates.push("metadata_source = 'curated'".to_string());
      updates.push("updated_at = ?".to_string());
      values.push(Value::from(now.to_string()));
      values.push(Value::from(book_id.to_string()));
      let sql = format!("UPDATE books SET {} WHERE id = ?", updates.join(", "));
      tx.execute(&sql, params_from_iter(values.iter()))?;
    }

    for update in lock_updates {
      let Some(db_field) = metadata_field_to_override_name(&update.field) else {
        continue;
      };
      if update.locked {
        let lock_value = get_book_field_value_for_lock(&tx, book_id, db_field)?;
        tx.execute(
          "INSERT INTO manual_overrides(id, book_id, field_name, field_value, edited_at) VALUES(?1, ?2, ?3, ?4, ?5) ON CONFLICT(book_id, field_name) DO UPDATE SET field_value = excluded.field_value, edited_at = excluded.edited_at",
          params![Uuid::new_v4().to_string(), book_id, db_field, lock_value, now],
        )?;
      } else {
        tx.execute(
          "DELETE FROM manual_overrides WHERE book_id = ?1 AND field_name = ?2",
          params![book_id, db_field],
        )?;
      }
    }

    tx.commit()?;
    Ok(())
  }

  pub fn apply_manual_book_edit(&self, book_id: &str, patch: BookPatch, now: &str) -> anyhow::Result<()> {
    let mut conn = self.conn()?;
    let tx = conn.transaction()?;
    Self::apply_manual_book_edit_tx(&tx, book_id, patch, now)?;
    tx.commit()?;
    Ok(())
  }

  pub fn apply_manual_book_edit_with_tags(
    &self,
    book_id: &str,
    patch: BookPatch,
    tags: Vec<String>,
    now: &str,
  ) -> anyhow::Result<()> {
    let mut conn = self.conn()?;
    let tx = conn.transaction()?;
    Self::apply_manual_book_edit_tx(&tx, book_id, patch, now)?;
    Self::set_book_tags_tx(&tx, book_id, tags, now)?;
    tx.commit()?;
    Ok(())
  }

  fn apply_manual_book_edit_tx(
    tx: &rusqlite::Transaction<'_>,
    book_id: &str,
    patch: BookPatch,
    now: &str,
  ) -> anyhow::Result<()> {
    let mut updates: Vec<String> = Vec::new();
    let mut values: Vec<Value> = Vec::new();
    let mut overrides: Vec<(String, Option<String>)> = Vec::new();

    macro_rules! push_text_field {
      ($field:literal, $value:expr) => {
        if let Some(value) = $value {
          updates.push(format!("{} = ?", $field));
          values.push(Value::from(value.clone()));
          overrides.push(($field.to_string(), Some(value)));
        }
      };
    }

    push_text_field!("title", patch.title);
    push_text_field!("subtitle", patch.subtitle);
    push_text_field!("publisher", patch.publisher);
    push_text_field!("publish_date", patch.publish_date);
    push_text_field!("isbn10", patch.isbn10);
    push_text_field!("isbn13", patch.isbn13);
    push_text_field!("description", patch.description);
    push_text_field!("language", patch.language);
    push_text_field!("series", patch.series);
    if let Some(cover_url) = patch.cover_url {
      updates.push("cover_url = ?".to_string());
      values.push(Value::from(cover_url.clone()));
      updates.push("cover_local_path = NULL".to_string());
      overrides.push(("cover_url".to_string(), Some(cover_url)));
    }

    if let Some(authors) = patch.authors {
      let serialized = serde_json::to_string(&authors)?;
      updates.push("authors_json = ?".to_string());
      values.push(Value::from(serialized.clone()));
      overrides.push(("authors_json".to_string(), Some(serialized)));
    }

    if let Some(page_count) = patch.page_count {
      updates.push("page_count = ?".to_string());
      values.push(Value::from(page_count));
      overrides.push(("page_count".to_string(), Some(page_count.to_string())));
    }

    if let Some(series_index) = patch.series_index {
      updates.push("series_index = ?".to_string());
      values.push(Value::from(series_index));
      overrides.push(("series_index".to_string(), Some(series_index.to_string())));
    }

    if !updates.is_empty() {
      updates.push("metadata_source = 'manual'".to_string());
      updates.push("updated_at = ?".to_string());
      values.push(Value::from(now.to_string()));
      values.push(Value::from(book_id.to_string()));
      let sql = format!("UPDATE books SET {} WHERE id = ?", updates.join(", "));
      tx.execute(&sql, params_from_iter(values.iter()))?;

      for (field_name, field_value) in overrides {
        tx.execute(
          "INSERT INTO manual_overrides(id, book_id, field_name, field_value, edited_at) VALUES(?1, ?2, ?3, ?4, ?5) ON CONFLICT(book_id, field_name) DO UPDATE SET field_value = excluded.field_value, edited_at = excluded.edited_at",
          params![Uuid::new_v4().to_string(), book_id, field_name, field_value, now],
        )?;
      }
    }
    Ok(())
  }

  pub fn get_manual_override_fields(&self, book_id: &str) -> anyhow::Result<HashSet<String>> {
    let conn = self.conn()?;
    Self::get_manual_override_fields_conn(&conn, book_id)
  }

  fn get_manual_override_fields_conn(conn: &Connection, book_id: &str) -> anyhow::Result<HashSet<String>> {
    let mut stmt = conn.prepare("SELECT field_name FROM manual_overrides WHERE book_id = ?1")?;
    let mut out = HashSet::new();
    for row in stmt.query_map(params![book_id], |row| row.get::<_, String>(0))? {
      out.insert(row?);
    }
    Ok(out)
  }

  fn get_book_field(&self, book_id: &str, field_name: &str) -> anyhow::Result<Option<String>> {
    let conn = self.conn()?;
    Self::get_book_field_conn(&conn, book_id, field_name)
  }

  fn get_book_field_conn(
    conn: &Connection,
    book_id: &str,
    field_name: &str,
  ) -> anyhow::Result<Option<String>> {
    anyhow::ensure!(is_book_column_allowed(field_name), "invalid book column name");
    let query = format!("SELECT {field_name} FROM books WHERE id = ?1");
    Ok(
      conn
        .query_row(&query, params![book_id], |row| row.get::<_, Option<String>>(0))
        .optional()?
        .flatten(),
    )
  }

  fn get_book_i64_field(&self, book_id: &str, field_name: &str) -> anyhow::Result<Option<i64>> {
    let conn = self.conn()?;
    Self::get_book_i64_field_conn(&conn, book_id, field_name)
  }

  fn get_book_i64_field_conn(
    conn: &Connection,
    book_id: &str,
    field_name: &str,
  ) -> anyhow::Result<Option<i64>> {
    anyhow::ensure!(is_book_column_allowed(field_name), "invalid book column name");
    let query = format!("SELECT {field_name} FROM books WHERE id = ?1");
    Ok(
      conn
        .query_row(&query, params![book_id], |row| row.get::<_, Option<i64>>(0))
        .optional()?
        .flatten(),
    )
  }
}

fn ensure_column(conn: &Connection, table_name: &str, column_name: &str, definition: &str) -> anyhow::Result<()> {
  let mut stmt = conn.prepare(&format!("PRAGMA table_info({table_name})"))?;
  let mut exists = false;
  for row in stmt.query_map([], |row| row.get::<_, String>(1))? {
    if row?.eq_ignore_ascii_case(column_name) {
      exists = true;
      break;
    }
  }
  if !exists {
    conn.execute(
      &format!("ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}"),
      [],
    )?;
  }
  Ok(())
}

fn normalize_tag_label(raw_tag: &str) -> Option<String> {
  let cleaned = raw_tag.split_whitespace().collect::<Vec<_>>().join(" ");
  if cleaned.is_empty() {
    None
  } else {
    Some(cleaned)
  }
}

fn normalize_tag_key(raw_tag: &str) -> Option<String> {
  normalize_tag_label(raw_tag).map(|value| value.to_lowercase())
}

fn parse_bool_setting(value: Option<&str>, default_value: bool) -> bool {
  let Some(raw) = value.map(str::trim).filter(|item| !item.is_empty()) else {
    return default_value;
  };
  if matches!(raw, "1" | "true" | "TRUE" | "True" | "yes" | "YES" | "on" | "ON") {
    return true;
  }
  if matches!(raw, "0" | "false" | "FALSE" | "False" | "no" | "NO" | "off" | "OFF") {
    return false;
  }
  default_value
}

fn library_thing_enabled_from_conn(conn: &Connection) -> anyhow::Result<bool> {
  let value = conn
    .query_row(
      "SELECT value FROM library_settings WHERE key = 'library_thing_enabled' LIMIT 1",
      [],
      |row| row.get::<_, String>(0),
    )
    .optional()?;
  Ok(parse_bool_setting(value.as_deref(), false))
}

fn normalized_non_empty_setting(value: &str) -> Option<String> {
  let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
  if normalized.is_empty() {
    None
  } else {
    Some(normalized)
  }
}

fn normalize_tag_keys(raw_tags: Vec<String>) -> Vec<String> {
  let mut seen = HashSet::new();
  let mut keys = Vec::new();
  for raw in raw_tags {
    let Some(key) = normalize_tag_key(&raw) else {
      continue;
    };
    if seen.insert(key.clone()) {
      keys.push(key);
    }
  }
  keys
}

fn preserve_existing_text(incoming: Option<String>, existing: Option<String>) -> Option<String> {
  match incoming {
    Some(value) if value.trim().is_empty() => existing,
    Some(value) => Some(value),
    None => existing,
  }
}

fn preserve_existing_i64(incoming: Option<i64>, existing: Option<i64>) -> Option<i64> {
  incoming.or(existing)
}

fn metadata_field_to_book_column(field: &MetadataField) -> Option<&'static str> {
  match field {
    MetadataField::Title => Some("title"),
    MetadataField::Subtitle => Some("subtitle"),
    MetadataField::Authors => Some("authors_json"),
    MetadataField::Publisher => Some("publisher"),
    MetadataField::PublishDate => Some("publish_date"),
    MetadataField::Isbn10 => Some("isbn10"),
    MetadataField::Isbn13 => Some("isbn13"),
    MetadataField::Description => Some("description"),
    MetadataField::Language => Some("language"),
    MetadataField::PageCount => Some("page_count"),
    MetadataField::Series => Some("series"),
    MetadataField::SeriesIndex => Some("series_index"),
    MetadataField::CoverUrl => Some("cover_url"),
  }
}

fn metadata_field_to_override_name(field: &MetadataField) -> Option<&'static str> {
  metadata_field_to_book_column(field)
}

fn is_book_column_allowed(field_name: &str) -> bool {
  matches!(
    field_name,
    "title"
      | "subtitle"
      | "authors_json"
      | "publisher"
      | "publish_date"
      | "isbn10"
      | "isbn13"
      | "description"
      | "language"
      | "page_count"
      | "series"
      | "series_index"
      | "cover_url"
      | "cover_local_path"
  )
}

fn get_book_field_value_for_lock(
  tx: &rusqlite::Transaction<'_>,
  book_id: &str,
  field_name: &str,
) -> anyhow::Result<Option<String>> {
  anyhow::ensure!(is_book_column_allowed(field_name), "invalid book column name");
  let query = format!("SELECT {field_name} FROM books WHERE id = ?1 LIMIT 1");
  if matches!(field_name, "page_count" | "series_index") {
    let numeric = tx
      .query_row(&query, params![book_id], |row| row.get::<_, Option<i64>>(0))
      .optional()?
      .flatten()
      .map(|value| value.to_string());
    return Ok(numeric);
  }
  let text = tx
    .query_row(&query, params![book_id], |row| row.get::<_, Option<String>>(0))
    .optional()?
    .flatten();
  Ok(text)
}

fn book_dedup_keys(candidate: &BookDedupCandidate) -> Vec<String> {
  let mut keys = Vec::new();
  if let Some(isbn13) = candidate
    .isbn13
    .as_deref()
    .map(normalize_isbn)
    .filter(|value| value.len() == 13)
  {
    keys.push(format!("isbn13::{isbn13}"));
  }
  if let Some(isbn10) = candidate
    .isbn10
    .as_deref()
    .map(normalize_isbn)
    .filter(|value| value.len() == 10)
  {
    keys.push(format!("isbn10::{isbn10}"));
  }

  let normalized_title = normalize_text(&candidate.title);
  if !normalized_title.is_empty() {
    let mut normalized_authors: Vec<String> = candidate
      .authors
      .iter()
      .map(|value| normalize_text(value))
      .filter(|value| !value.is_empty())
      .collect();
    if !normalized_authors.is_empty() {
      normalized_authors.sort();
      normalized_authors.dedup();
      keys.push(format!("title_author::{}::{}", normalized_title, normalized_authors.join("|")));
    }
  }

  keys
}

fn find_parent(parents: &mut [usize], index: usize) -> usize {
  let parent = parents[index];
  if parent == index {
    index
  } else {
    let root = find_parent(parents, parent);
    parents[index] = root;
    root
  }
}

fn union_parent(parents: &mut [usize], left: usize, right: usize) {
  let left_root = find_parent(parents, left);
  let right_root = find_parent(parents, right);
  if left_root != right_root {
    parents[right_root] = left_root;
  }
}

fn map_folder(row: &rusqlite::Row<'_>) -> rusqlite::Result<LibraryFolder> {
  Ok(LibraryFolder {
    id: row.get(0)?,
    path: row.get(1)?,
    recursive: row.get::<_, i64>(2)? == 1,
    enabled: row.get::<_, i64>(3)? == 1,
    added_at: row.get(4)?,
    last_scan_at: row.get(5)?,
  })
}

fn map_file(row: &rusqlite::Row<'_>) -> rusqlite::Result<FileRecord> {
  Ok(FileRecord {
    id: row.get(0)?,
    folder_id: row.get(1)?,
    abs_path: row.get(2)?,
    ext: row.get(3)?,
    size_bytes: row.get(4)?,
    mtime_utc: row.get(5)?,
    hash_sha256: row.get(6)?,
    status: row.get(7)?,
    first_seen_at: row.get(8)?,
    last_seen_at: row.get(9)?,
    parser_error: row.get(10)?,
    guessed_title: row.get(11)?,
    guessed_author: row.get(12)?,
    guessed_isbn: row.get(13)?,
  })
}

fn map_discovered_file(row: &rusqlite::Row<'_>) -> rusqlite::Result<DiscoveredFile> {
  let abs_path: String = row.get(1)?;
  Ok(DiscoveredFile {
    file_id: row.get(0)?,
    file_name: Path::new(&abs_path)
      .file_name()
      .and_then(OsStr::to_str)
      .unwrap_or_default()
      .to_string(),
    abs_path,
    folder_path: row.get(2)?,
    guessed_title: row.get(3)?,
    guessed_author: row.get(4)?,
    guessed_isbn: row.get(5)?,
    status: row.get(6)?,
    parser_error: row.get(7)?,
    reason: row.get(8)?,
    last_seen_at: row.get(9)?,
  })
}

fn pagination_offset(page: u32, page_size: u32) -> u32 {
  page.saturating_sub(1).saturating_mul(page_size)
}

fn search_prefix_query(input: &str) -> Option<String> {
  let terms: Vec<String> = normalize_text(input)
    .split_whitespace()
    .map(|term| format!("\"{term}\"*"))
    .collect();

  if terms.is_empty() {
    None
  } else {
    Some(terms.join(" AND "))
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  struct TestDb {
    repo: Repository,
    path: PathBuf,
  }

  impl TestDb {
    fn new() -> Self {
      let path = std::env::temp_dir().join(format!("lumina-library-test-{}.db", Uuid::new_v4()));
      let repo = Repository::new(path.clone()).expect("repo init");
      repo.init_schema().expect("schema init");
      Self { repo, path }
    }
  }

  impl Drop for TestDb {
    fn drop(&mut self) {
      let _ = std::fs::remove_file(&self.path);
      let _ = std::fs::remove_file(format!("{}-shm", self.path.display()));
      let _ = std::fs::remove_file(format!("{}-wal", self.path.display()));
    }
  }

  fn now() -> &'static str {
    "2026-01-01T00:00:00Z"
  }

  #[test]
  fn pagination_offset_saturates_for_large_page_numbers() {
    assert_eq!(pagination_offset(1, 200), 0);
    assert_eq!(pagination_offset(3, 25), 50);
    assert_eq!(pagination_offset(u32::MAX, 200), u32::MAX);
  }

  fn create_matched_book(db: &TestDb, base: &str) -> (String, String) {
    let folder = db
      .repo
      .add_folder(base, true, now())
      .expect("add folder");

    let (file, _) = db
      .repo
      .upsert_file_with_existing(
        UpsertFilePayload {
          folder_id: folder.id.clone(),
          abs_path: format!("{base}\\book.pdf"),
          ext: "pdf".to_string(),
          size_bytes: 1_024,
          mtime_utc: now().to_string(),
          hash_sha256: None,
          status: "discovered".to_string(),
          parser_error: None,
          guessed_title: Some("Dune".to_string()),
          guessed_author: Some("Frank Herbert".to_string()),
          guessed_isbn: None,
        },
        None,
        now(),
      )
      .expect("upsert file");

    let book_id = db
      .repo
      .upsert_book(
        UpsertBookInput {
          title: "Dune".to_string(),
          subtitle: None,
          authors: vec!["Frank Herbert".to_string()],
          publisher: Some("Chilton Books".to_string()),
          publish_date: Some("1965-08-01".to_string()),
          isbn10: None,
          isbn13: Some("9780441172719".to_string()),
          description: Some("A science fiction classic".to_string()),
          language: Some("en".to_string()),
          page_count: Some(412),
          series: Some("Dune".to_string()),
          series_index: Some(1),
          cover_url: None,
          metadata_source: "manual".to_string(),
          confidence: Some(1.0),
        },
        now(),
      )
      .expect("upsert book");

    db.repo
      .link_file_to_book(&file.id, &book_id, "pdf", true, now())
      .expect("link file");

    (book_id, file.id)
  }

  fn create_matched_book_with_title(db: &TestDb, base: &str, title: &str, author: &str) -> (String, String) {
    let folder = db
      .repo
      .add_folder(base, true, now())
      .expect("add folder");

    let (file, _) = db
      .repo
      .upsert_file_with_existing(
        UpsertFilePayload {
          folder_id: folder.id.clone(),
          abs_path: format!("{base}\\book.pdf"),
          ext: "pdf".to_string(),
          size_bytes: 1_024,
          mtime_utc: now().to_string(),
          hash_sha256: None,
          status: "discovered".to_string(),
          parser_error: None,
          guessed_title: Some(title.to_string()),
          guessed_author: Some(author.to_string()),
          guessed_isbn: None,
        },
        None,
        now(),
      )
      .expect("upsert file");

    let book_id = db
      .repo
      .upsert_book(
        UpsertBookInput {
          title: title.to_string(),
          subtitle: None,
          authors: vec![author.to_string()],
          publisher: Some("Test Publisher".to_string()),
          publish_date: Some("2026".to_string()),
          isbn10: None,
          isbn13: None,
          description: Some("Search test fixture".to_string()),
          language: Some("en".to_string()),
          page_count: None,
          series: None,
          series_index: None,
          cover_url: None,
          metadata_source: "manual".to_string(),
          confidence: Some(1.0),
        },
        now(),
      )
      .expect("upsert book");

    db.repo
      .link_file_to_book(&file.id, &book_id, "pdf", true, now())
      .expect("link file");

    (book_id, file.id)
  }

  fn create_book_with_isbn(
    db: &TestDb,
    title: &str,
    isbn10: Option<&str>,
    isbn13: Option<&str>,
  ) -> String {
    db
      .repo
      .upsert_book(
        UpsertBookInput {
          title: title.to_string(),
          subtitle: None,
          authors: vec!["Test Author".to_string()],
          publisher: None,
          publish_date: None,
          isbn10: isbn10.map(ToString::to_string),
          isbn13: isbn13.map(ToString::to_string),
          description: None,
          language: None,
          page_count: None,
          series: None,
          series_index: None,
          cover_url: None,
          metadata_source: "manual".to_string(),
          confidence: Some(1.0),
        },
        now(),
      )
      .expect("upsert book with isbn")
  }

  #[test]
  fn search_prefix_query_normalizes_user_input_for_partial_fts_matches() {
    assert_eq!(search_prefix_query(" psal "), Some("\"psal\"*".to_string()));
    assert_eq!(
      search_prefix_query("Psalm stu"),
      Some("\"psalm\"* AND \"stu\"*".to_string())
    );
    assert_eq!(search_prefix_query("!!!"), None);
  }

  #[test]
  fn library_search_matches_partial_words_as_user_types() {
    let db = TestDb::new();
    let (psalm_id, _) = create_matched_book_with_title(
      &db,
      "C:\\Books\\PsalmStudy",
      "Psalm Study Guide",
      "Example Author",
    );
    let (psalms_id, _) = create_matched_book_with_title(
      &db,
      "C:\\Books\\BookOfPsalms",
      "Book of Psalms",
      "Example Author",
    );

    let partial = db
      .repo
      .get_library_books(
        Some("psal".to_string()),
        BookFilters::default(),
        SortSpec::default(),
        Some(1),
        Some(20),
      )
      .expect("partial search");
    assert_eq!(partial.total, 2);
    assert!(partial.items.iter().any(|item| item.id == psalm_id));
    assert!(partial.items.iter().any(|item| item.id == psalms_id));

    let multi_word_partial = db
      .repo
      .get_library_books(
        Some("psalm stu".to_string()),
        BookFilters::default(),
        SortSpec::default(),
        Some(1),
        Some(20),
      )
      .expect("multi-word partial search");
    assert_eq!(multi_word_partial.total, 1);
    assert_eq!(multi_word_partial.items[0].id, psalm_id);

    let plural = db
      .repo
      .get_library_books(
        Some("psalms".to_string()),
        BookFilters::default(),
        SortSpec::default(),
        Some(1),
        Some(20),
      )
      .expect("plural search");
    assert_eq!(plural.total, 1);
    assert_eq!(plural.items[0].id, psalms_id);

    let operator_like = db
      .repo
      .get_library_books(
        Some("near".to_string()),
        BookFilters::default(),
        SortSpec::default(),
        Some(1),
        Some(20),
      )
      .expect("operator-like search input should not break fts parsing");
    assert_eq!(operator_like.total, 0);
  }

  #[test]
  fn get_library_books_applies_requested_sort_order() {
    let db = TestDb::new();
    let (middle_id, _) = create_matched_book_with_title(
      &db,
      "C:\\Books\\SortMiddle",
      "Middle Book",
      "Charlie Author",
    );
    let (alpha_id, _) = create_matched_book_with_title(
      &db,
      "C:\\Books\\SortAlpha",
      "Alpha Book",
      "Bravo Author",
    );
    let (omega_id, _) = create_matched_book_with_title(
      &db,
      "C:\\Books\\SortOmega",
      "Omega Book",
      "Alpha Author",
    );

    let conn = db.repo.conn().expect("conn");
    conn
      .execute(
        "UPDATE books SET created_at = ?1 WHERE id = ?2",
        params!["2026-01-02T00:00:00Z", &middle_id],
      )
      .expect("set middle date");
    conn
      .execute(
        "UPDATE books SET created_at = ?1 WHERE id = ?2",
        params!["2026-01-01T00:00:00Z", &alpha_id],
      )
      .expect("set alpha date");
    conn
      .execute(
        "UPDATE books SET created_at = ?1 WHERE id = ?2",
        params!["2026-01-03T00:00:00Z", &omega_id],
      )
      .expect("set omega date");
    drop(conn);

    let title_desc = db
      .repo
      .get_library_books(
        None,
        BookFilters::default(),
        SortSpec {
          field: "title".to_string(),
          direction: "desc".to_string(),
        },
        Some(1),
        Some(10),
      )
      .expect("title desc");
    assert_eq!(
      title_desc.items.iter().map(|book| book.title.as_str()).collect::<Vec<_>>(),
      vec!["Omega Book", "Middle Book", "Alpha Book"]
    );

    let author_asc = db
      .repo
      .get_library_books(
        None,
        BookFilters::default(),
        SortSpec {
          field: "author".to_string(),
          direction: "asc".to_string(),
        },
        Some(1),
        Some(10),
      )
      .expect("author asc");
    assert_eq!(
      author_asc.items.iter().map(|book| book.title.as_str()).collect::<Vec<_>>(),
      vec!["Omega Book", "Alpha Book", "Middle Book"]
    );

    let created_desc = db
      .repo
      .get_library_books(
        None,
        BookFilters::default(),
        SortSpec {
          field: "createdAt".to_string(),
          direction: "desc".to_string(),
        },
        Some(1),
        Some(10),
      )
      .expect("created desc");
    assert_eq!(
      created_desc.items.iter().map(|book| book.title.as_str()).collect::<Vec<_>>(),
      vec!["Omega Book", "Middle Book", "Alpha Book"]
    );
  }

  #[test]
  fn init_schema_is_idempotent_and_applies_migrations() {
    let db = TestDb::new();
    db.repo.init_schema().expect("re-run schema");

    let conn = db.repo.conn().expect("conn");
    let mut stmt = conn
      .prepare("PRAGMA table_info(books)")
      .expect("table info");
    let columns: Vec<String> = stmt
      .query_map([], |row| row.get::<_, String>(1))
      .expect("query cols")
      .collect::<Result<Vec<_>, _>>()
      .expect("collect cols");

    assert!(columns.iter().any(|value| value == "series"));
    assert!(columns.iter().any(|value| value == "series_index"));

    let tags_table_exists: i64 = conn
      .query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='tags'",
        [],
        |row| row.get(0),
      )
      .expect("tags table query");
    let book_tags_table_exists: i64 = conn
      .query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='book_tags'",
        [],
        |row| row.get(0),
      )
      .expect("book_tags table query");

    assert_eq!(tags_table_exists, 1);
    assert_eq!(book_tags_table_exists, 1);
  }

  #[test]
  fn tags_are_case_insensitive_and_filterable() {
    let db = TestDb::new();
    let (book_id, _) = create_matched_book(&db, "C:\\Books\\TagCase");

    db.repo
      .set_book_tags(&book_id, vec!["Sci-Fi".to_string(), "sci-fi".to_string()], now())
      .expect("set tags");

    let tags = db.repo.get_library_tags().expect("get tags");
    assert_eq!(tags.len(), 1);
    assert_eq!(tags[0].tag, "Sci-Fi");

    let detail = db.repo.get_book_detail(&book_id).expect("detail");
    assert_eq!(detail.tags.len(), 1);
    assert_eq!(detail.tags[0], "Sci-Fi");

    let filtered = db
      .repo
      .get_library_books(
        None,
        BookFilters {
          tags: vec!["SCI-FI".to_string()],
          ..Default::default()
        },
        SortSpec::default(),
        Some(1),
        Some(20),
      )
      .expect("filtered books");
    assert_eq!(filtered.total, 1);
    assert_eq!(filtered.items[0].id, book_id);
  }

  #[test]
  fn merge_tags_reassigns_books_to_target_tag() {
    let db = TestDb::new();
    let book_a = create_book_with_isbn(&db, "Church History", None, Some("9780441172719"));
    let book_b = create_book_with_isbn(&db, "Church Growth", None, Some("9780441172726"));

    db.repo
      .set_book_tags(
        &book_a,
        vec!["church history".to_string(), "church".to_string()],
        now(),
      )
      .expect("set tags for book A");
    db.repo
      .set_book_tags(
        &book_b,
        vec!["church growth".to_string(), "ministry".to_string()],
        now(),
      )
      .expect("set tags for book B");

    let result = db
      .repo
      .merge_tags(
        vec![
          "church history".to_string(),
          "church growth".to_string(),
          "church".to_string(),
        ],
        "church".to_string(),
        now(),
      )
      .expect("merge tags");

    assert_eq!(result.target_tag, "church");
    assert_eq!(result.merged_tag_count, 2);
    assert_eq!(result.affected_books, 2);

    let book_a_detail = db.repo.get_book_detail(&book_a).expect("book A detail");
    assert_eq!(book_a_detail.tags, vec!["church".to_string()]);

    let book_b_detail = db.repo.get_book_detail(&book_b).expect("book B detail");
    assert_eq!(
      book_b_detail.tags,
      vec!["church".to_string(), "ministry".to_string()]
    );

    let tags = db.repo.get_library_tags().expect("get tags");
    assert_eq!(tags.len(), 2);
    assert_eq!(tags[0].tag, "church");
    assert_eq!(tags[0].count, 2);
    assert_eq!(tags[1].tag, "ministry");
    assert_eq!(tags[1].count, 1);
  }

  #[test]
  fn delete_tags_removes_tag_from_all_books() {
    let db = TestDb::new();
    let book_a = create_book_with_isbn(&db, "History", None, Some("9780441172733"));
    let book_b = create_book_with_isbn(&db, "Reference", None, Some("9780441172740"));

    db.repo
      .set_book_tags(
        &book_a,
        vec!["history".to_string(), "shared".to_string()],
        now(),
      )
      .expect("set tags for book A");
    db.repo
      .set_book_tags(
        &book_b,
        vec!["shared".to_string(), "reference".to_string()],
        now(),
      )
      .expect("set tags for book B");

    let result = db
      .repo
      .delete_tags(vec!["shared".to_string(), "missing".to_string()])
      .expect("delete tags");
    assert_eq!(result.deleted_tag_count, 1);
    assert_eq!(result.affected_books, 2);

    let book_a_detail = db.repo.get_book_detail(&book_a).expect("book A detail");
    assert_eq!(book_a_detail.tags, vec!["history".to_string()]);

    let book_b_detail = db.repo.get_book_detail(&book_b).expect("book B detail");
    assert_eq!(book_b_detail.tags, vec!["reference".to_string()]);
  }

  #[test]
  fn upsert_book_reuses_existing_title_author_when_isbn_missing() {
    let db = TestDb::new();
    let first_id = db
      .repo
      .upsert_book(
        UpsertBookInput {
          title: "A Concise Dictionary of Theological Terms".to_string(),
          subtitle: None,
          authors: vec!["Ferdinand Deist".to_string()],
          publisher: Some("Publisher A".to_string()),
          publish_date: Some("1984".to_string()),
          isbn10: None,
          isbn13: None,
          description: Some("First import".to_string()),
          language: Some("en".to_string()),
          page_count: Some(320),
          series: None,
          series_index: None,
          cover_url: None,
          metadata_source: "api".to_string(),
          confidence: Some(0.91),
        },
        now(),
      )
      .expect("insert first book");

    let second_id = db
      .repo
      .upsert_book(
        UpsertBookInput {
          title: "A concise dictionary of theological terms".to_string(),
          subtitle: None,
          authors: vec!["Ferdinand Deist".to_string()],
          publisher: Some("Publisher B".to_string()),
          publish_date: Some("1984".to_string()),
          isbn10: None,
          isbn13: None,
          description: Some("Second import".to_string()),
          language: Some("en".to_string()),
          page_count: Some(322),
          series: None,
          series_index: None,
          cover_url: None,
          metadata_source: "api".to_string(),
          confidence: Some(0.93),
        },
        now(),
      )
      .expect("upsert by title/author");

    assert_eq!(first_id, second_id);
    let conn = db.repo.conn().expect("conn");
    let count: i64 = conn
      .query_row(
        "SELECT COUNT(*) FROM books WHERE lower(title) = lower(?1)",
        params!["A concise dictionary of theological terms"],
        |row| row.get(0),
      )
      .expect("count books");
    assert_eq!(count, 1);
  }

  #[test]
  fn consolidate_duplicate_books_merges_file_links() {
    let db = TestDb::new();
    let folder = db
      .repo
      .add_folder("C:\\Books\\Dedup", true, now())
      .expect("add folder");

    let (file_a, _) = db
      .repo
      .upsert_file_with_existing(
        UpsertFilePayload {
          folder_id: folder.id.clone(),
          abs_path: "C:\\Books\\Dedup\\book-a.pdf".to_string(),
          ext: "pdf".to_string(),
          size_bytes: 1_024,
          mtime_utc: now().to_string(),
          hash_sha256: None,
          status: "matched".to_string(),
          parser_error: None,
          guessed_title: Some("Sample Title".to_string()),
          guessed_author: Some("Sample Author".to_string()),
          guessed_isbn: None,
        },
        None,
        now(),
      )
      .expect("upsert file a");
    let (file_b, _) = db
      .repo
      .upsert_file_with_existing(
        UpsertFilePayload {
          folder_id: folder.id.clone(),
          abs_path: "C:\\Books\\Dedup\\book-a.epub".to_string(),
          ext: "epub".to_string(),
          size_bytes: 2_048,
          mtime_utc: now().to_string(),
          hash_sha256: None,
          status: "matched".to_string(),
          parser_error: None,
          guessed_title: Some("Sample Title".to_string()),
          guessed_author: Some("Sample Author".to_string()),
          guessed_isbn: None,
        },
        None,
        now(),
      )
      .expect("upsert file b");

    let book_a = Uuid::new_v4().to_string();
    let book_b = Uuid::new_v4().to_string();
    let authors_json = serde_json::to_string(&vec!["Sample Author".to_string()]).expect("serialize authors");
    let conn = db.repo.conn().expect("conn");
    conn
      .execute(
        "INSERT INTO books(id, title, subtitle, authors_json, publisher, publish_date, isbn10, isbn13, description, language, page_count, series, series_index, cover_url, cover_local_path, metadata_source, confidence, created_at, updated_at)
         VALUES(?1, ?2, NULL, ?3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'api', 0.9, ?4, ?4)",
        params![&book_a, "Sample Title", &authors_json, now()],
      )
      .expect("insert book a");
    conn
      .execute(
        "INSERT INTO books(id, title, subtitle, authors_json, publisher, publish_date, isbn10, isbn13, description, language, page_count, series, series_index, cover_url, cover_local_path, metadata_source, confidence, created_at, updated_at)
         VALUES(?1, ?2, NULL, ?3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'api', 0.9, ?4, ?4)",
        params![&book_b, "Sample Title", &authors_json, now()],
      )
      .expect("insert book b");

    db.repo
      .link_file_to_book(&file_a.id, &book_a, "pdf", true, now())
      .expect("link file a");
    db.repo
      .link_file_to_book(&file_b.id, &book_b, "epub", true, now())
      .expect("link file b");

    let merged = db
      .repo
      .consolidate_duplicate_books(now())
      .expect("consolidate duplicate books");
    assert_eq!(merged, 1);

    let conn = db.repo.conn().expect("conn");
    let remaining_books: i64 = conn
      .query_row(
        "SELECT COUNT(*) FROM books WHERE lower(title) = lower('Sample Title')",
        [],
        |row| row.get(0),
      )
      .expect("count remaining books");
    assert_eq!(remaining_books, 1);
    let linked_files: i64 = conn
      .query_row(
        "SELECT COUNT(*) FROM book_files bf JOIN books b ON b.id = bf.book_id WHERE lower(b.title) = lower('Sample Title')",
        [],
        |row| row.get(0),
      )
      .expect("count linked files");
    assert_eq!(linked_files, 2);
  }

  #[test]
  fn consolidate_duplicate_books_merges_shared_isbn() {
    let db = TestDb::new();
    let folder = db
      .repo
      .add_folder("C:\\Books\\DedupIsbn", true, now())
      .expect("add folder");

    let (file_a, _) = db
      .repo
      .upsert_file_with_existing(
        UpsertFilePayload {
          folder_id: folder.id.clone(),
          abs_path: "C:\\Books\\DedupIsbn\\book-a.pdf".to_string(),
          ext: "pdf".to_string(),
          size_bytes: 1_024,
          mtime_utc: now().to_string(),
          hash_sha256: None,
          status: "matched".to_string(),
          parser_error: None,
          guessed_title: Some("Wrong Title".to_string()),
          guessed_author: Some("Wrong Author".to_string()),
          guessed_isbn: Some("9781579582920".to_string()),
        },
        None,
        now(),
      )
      .expect("upsert file a");
    let (file_b, _) = db
      .repo
      .upsert_file_with_existing(
        UpsertFilePayload {
          folder_id: folder.id.clone(),
          abs_path: "C:\\Books\\DedupIsbn\\book-b.epub".to_string(),
          ext: "epub".to_string(),
          size_bytes: 2_048,
          mtime_utc: now().to_string(),
          hash_sha256: None,
          status: "matched".to_string(),
          parser_error: None,
          guessed_title: Some("Correct Title".to_string()),
          guessed_author: Some("Correct Author".to_string()),
          guessed_isbn: Some("9781579582920".to_string()),
        },
        None,
        now(),
      )
      .expect("upsert file b");

    let book_a = Uuid::new_v4().to_string();
    let book_b = Uuid::new_v4().to_string();
    let authors_a_json = serde_json::to_string(&vec!["Wrong Author".to_string()]).expect("serialize authors a");
    let authors_b_json = serde_json::to_string(&vec!["Correct Author".to_string()]).expect("serialize authors b");
    let conn = db.repo.conn().expect("conn");
    conn
      .execute(
        "INSERT INTO books(id, title, subtitle, authors_json, publisher, publish_date, isbn10, isbn13, description, language, page_count, series, series_index, cover_url, cover_local_path, metadata_source, confidence, created_at, updated_at)
         VALUES(?1, ?2, NULL, ?3, NULL, NULL, NULL, ?4, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'api', 0.9, ?5, ?5)",
        params![&book_a, "Wrong Title", &authors_a_json, "9781579582920", now()],
      )
      .expect("insert book a");
    conn
      .execute(
        "INSERT INTO books(id, title, subtitle, authors_json, publisher, publish_date, isbn10, isbn13, description, language, page_count, series, series_index, cover_url, cover_local_path, metadata_source, confidence, created_at, updated_at)
         VALUES(?1, ?2, NULL, ?3, NULL, NULL, NULL, ?4, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'api', 0.9, ?5, ?5)",
        params![&book_b, "Correct Title", &authors_b_json, "9781579582920", now()],
      )
      .expect("insert book b");

    db.repo
      .link_file_to_book(&file_a.id, &book_a, "pdf", true, now())
      .expect("link file a");
    db.repo
      .link_file_to_book(&file_b.id, &book_b, "epub", true, now())
      .expect("link file b");

    let merged = db
      .repo
      .consolidate_duplicate_books(now())
      .expect("consolidate duplicate books");
    assert_eq!(merged, 1);

    let conn = db.repo.conn().expect("conn");
    let remaining_books: i64 = conn
      .query_row(
        "SELECT COUNT(*) FROM books WHERE isbn13 = '9781579582920'",
        [],
        |row| row.get(0),
      )
      .expect("count remaining books");
    assert_eq!(remaining_books, 1);
    let linked_files: i64 = conn
      .query_row(
        "SELECT COUNT(*) FROM book_files bf JOIN books b ON b.id = bf.book_id WHERE b.isbn13 = '9781579582920'",
        [],
        |row| row.get(0),
      )
      .expect("count linked files");
    assert_eq!(linked_files, 2);
  }

  #[test]
  fn update_book_by_id_preserves_existing_metadata_when_input_is_partial() {
    let db = TestDb::new();
    let (book_id, _) = create_matched_book(&db, "C:\\Books\\PartialUpdate");

    db.repo
      .update_book_by_id_with_override_policy(
        &book_id,
        UpsertBookInput {
          title: "Dune".to_string(),
          subtitle: None,
          authors: vec![],
          publisher: None,
          publish_date: None,
          isbn10: None,
          isbn13: Some("9780441172719".to_string()),
          description: None,
          language: None,
          page_count: None,
          series: None,
          series_index: None,
          cover_url: None,
          metadata_source: "api".to_string(),
          confidence: Some(0.95),
        },
        now(),
        true,
      )
      .expect("partial update should succeed");

    let detail = db.repo.get_book_detail(&book_id).expect("book detail");
    assert_eq!(detail.title, "Dune");
    assert_eq!(detail.authors, vec!["Frank Herbert".to_string()]);
    assert_eq!(detail.publisher, Some("Chilton Books".to_string()));
    assert_eq!(detail.publish_date, Some("1965-08-01".to_string()));
    assert_eq!(detail.description, Some("A science fiction classic".to_string()));
    assert_eq!(detail.language, Some("en".to_string()));
    assert_eq!(detail.page_count, Some(412));
    assert_eq!(detail.series, Some("Dune".to_string()));
    assert_eq!(detail.series_index, Some(1));
    assert_eq!(detail.metadata_source, "api");
  }

  #[test]
  fn find_book_by_isbn_prioritizes_isbn13_when_both_present() {
    let db = TestDb::new();
    let by_isbn13 = create_book_with_isbn(&db, "Book via 13", None, Some("9780441172719"));
    let by_isbn10 = create_book_with_isbn(&db, "Book via 10", Some("0441172717"), None);

    let resolved = db
      .repo
      .find_book_by_isbn(Some("0441172717"), Some("9780441172719"))
      .expect("find by isbn")
      .expect("book should exist");
    assert_eq!(resolved, by_isbn13);

    let resolved_10 = db
      .repo
      .find_book_by_isbn(Some("0441172717"), None)
      .expect("find by isbn10")
      .expect("book should exist");
    assert_eq!(resolved_10, by_isbn10);
  }

  #[test]
  fn upsert_book_tries_isbn10_when_isbn13_not_found() {
    let db = TestDb::new();
    let existing = create_book_with_isbn(&db, "Book via 10", Some("0441172717"), None);

    let upserted = db
      .repo
      .upsert_book(
        UpsertBookInput {
          title: "Book via 10".to_string(),
          subtitle: None,
          authors: vec!["Frank Herbert".to_string()],
          publisher: Some("Ace".to_string()),
          publish_date: None,
          isbn10: Some("0441172717".to_string()),
          isbn13: Some("9780000000002".to_string()),
          description: None,
          language: None,
          page_count: None,
          series: None,
          series_index: None,
          cover_url: None,
          metadata_source: "api".to_string(),
          confidence: Some(0.9),
        },
        now(),
      )
      .expect("upsert should resolve existing isbn10 match");

    assert_eq!(upserted, existing);
  }

  #[test]
  fn apply_curated_metadata_respects_locks_and_updates_requested_fields() {
    let db = TestDb::new();
    let (book_id, _) = create_matched_book(&db, "C:\\Books\\Curated");

    db
      .repo
      .apply_manual_book_edit(
        &book_id,
        BookPatch {
          publisher: Some("Locked Publisher".to_string()),
          ..Default::default()
        },
        now(),
      )
      .expect("seed publisher lock");

    db
      .repo
      .apply_curated_metadata(
        &book_id,
        vec![
          MetadataFieldSelection {
            field: MetadataField::Publisher,
            candidate_id: Some("open_library:0".to_string()),
            value: Some("Remote Publisher".to_string()),
            values: None,
            int_value: None,
          },
          MetadataFieldSelection {
            field: MetadataField::Description,
            candidate_id: Some("google_books:0".to_string()),
            value: Some("Curated description".to_string()),
            values: None,
            int_value: None,
          },
        ],
        vec![
          MetadataLockUpdate {
            field: MetadataField::Publisher,
            locked: true,
          },
          MetadataLockUpdate {
            field: MetadataField::Description,
            locked: true,
          },
        ],
        now(),
      )
      .expect("apply curated metadata");

    let detail = db.repo.get_book_detail(&book_id).expect("detail");
    assert_eq!(detail.publisher.as_deref(), Some("Locked Publisher"));
    assert_eq!(detail.description.as_deref(), Some("Curated description"));
    assert_eq!(detail.metadata_source, "curated");

    let locks = db
      .repo
      .get_manual_override_fields(&book_id)
      .expect("locks");
    assert!(locks.contains("publisher"));
    assert!(locks.contains("description"));
  }

  #[test]
  fn find_book_by_title_author_uses_prefilter_on_large_catalog() {
    let db = TestDb::new();
    for i in 0..2_050usize {
      let isbn13 = format!("978{:010}", i as u64);
      let _ = db
        .repo
        .upsert_book(
          UpsertBookInput {
            title: format!("Noise Title {i}"),
            subtitle: None,
            authors: vec![format!("Noise Author {i}")],
            publisher: None,
            publish_date: None,
            isbn10: None,
            isbn13: Some(isbn13),
            description: None,
            language: None,
            page_count: None,
            series: None,
            series_index: None,
            cover_url: None,
            metadata_source: "api".to_string(),
            confidence: Some(0.85),
          },
          now(),
        )
        .expect("insert noise book");
    }

    let target_id = db
      .repo
      .upsert_book(
        UpsertBookInput {
          title: "Holman NT Commentary Luke".to_string(),
          subtitle: None,
          authors: vec!["Trent C. Butler".to_string()],
          publisher: None,
          publish_date: None,
          isbn10: None,
          isbn13: None,
          description: None,
          language: None,
          page_count: None,
          series: None,
          series_index: None,
          cover_url: None,
          metadata_source: "api".to_string(),
          confidence: Some(0.9),
        },
        now(),
      )
      .expect("insert target");

    let resolved = db
      .repo
      .find_book_by_title_author("holman nt commentary luke", &["Trent C. Butler".to_string()])
      .expect("find target");
    assert_eq!(resolved, Some(target_id));
  }

  #[test]
  fn find_unique_book_by_exact_title_only_matches_unambiguous_titles() {
    let db = TestDb::new();
    let unique_book = create_book_with_isbn(&db, "Unique Match Title", None, Some("9780000001111"));

    let unique = db
      .repo
      .find_unique_book_by_exact_title(" unique match title ")
      .expect("find unique");
    assert_eq!(unique, Some(unique_book));

    let conn = db.repo.conn().expect("conn");
    let authors_a = serde_json::to_string(&vec!["Author A".to_string()]).expect("authors a");
    let authors_b = serde_json::to_string(&vec!["Author B".to_string()]).expect("authors b");
    conn
      .execute(
        "INSERT INTO books(id, title, subtitle, authors_json, publisher, publish_date, isbn10, isbn13, description, language, page_count, series, series_index, cover_url, cover_local_path, metadata_source, confidence, created_at, updated_at)
         VALUES(?1, ?2, NULL, ?3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'api', 0.8, ?4, ?4)",
        params![Uuid::new_v4().to_string(), "Ambiguous Title", &authors_a, now()],
      )
      .expect("insert ambiguous a");
    conn
      .execute(
        "INSERT INTO books(id, title, subtitle, authors_json, publisher, publish_date, isbn10, isbn13, description, language, page_count, series, series_index, cover_url, cover_local_path, metadata_source, confidence, created_at, updated_at)
         VALUES(?1, ?2, NULL, ?3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'api', 0.8, ?4, ?4)",
        params![Uuid::new_v4().to_string(), "Ambiguous Title", &authors_b, now()],
      )
      .expect("insert ambiguous b");

    let ambiguous = db
      .repo
      .find_unique_book_by_exact_title("ambiguous title")
      .expect("find ambiguous");
    assert_eq!(ambiguous, None);
  }

  #[test]
  fn find_book_by_file_hash_prefers_existing_linked_book() {
    let db = TestDb::new();
    let folder = db
      .repo
      .add_folder("C:\\Books\\HashMatch", true, now())
      .expect("add folder");

    let (linked_file, _) = db
      .repo
      .upsert_file_with_existing(
        UpsertFilePayload {
          folder_id: folder.id.clone(),
          abs_path: "C:\\Books\\HashMatch\\a.pdf".to_string(),
          ext: "pdf".to_string(),
          size_bytes: 100,
          mtime_utc: now().to_string(),
          hash_sha256: Some("hash-123".to_string()),
          status: "matched".to_string(),
          parser_error: None,
          guessed_title: Some("Hash Match".to_string()),
          guessed_author: Some("Hash Author".to_string()),
          guessed_isbn: None,
        },
        None,
        now(),
      )
      .expect("insert linked file");
    let (incoming_file, _) = db
      .repo
      .upsert_file_with_existing(
        UpsertFilePayload {
          folder_id: folder.id.clone(),
          abs_path: "C:\\Books\\HashMatch\\b.pdf".to_string(),
          ext: "pdf".to_string(),
          size_bytes: 100,
          mtime_utc: now().to_string(),
          hash_sha256: Some("hash-123".to_string()),
          status: "discovered".to_string(),
          parser_error: None,
          guessed_title: Some("Hash Match".to_string()),
          guessed_author: Some("Hash Author".to_string()),
          guessed_isbn: None,
        },
        None,
        now(),
      )
      .expect("insert incoming file");

    let book_id = create_book_with_isbn(&db, "Hash Match", None, Some("9780000002222"));
    db.repo
      .link_file_to_book(&linked_file.id, &book_id, "pdf", true, now())
      .expect("link original file");

    let resolved = db
      .repo
      .find_book_by_file_hash("hash-123", &incoming_file.id)
      .expect("find by hash");
    assert_eq!(resolved, Some(book_id));
  }

  #[test]
  fn find_book_id_for_file_returns_current_link() {
    let db = TestDb::new();
    let (book_id, file_id) = create_matched_book(&db, "C:\\Books\\FindLinkedBook");

    let linked_book_id = db
      .repo
      .find_book_id_for_file(&file_id)
      .expect("find linked book id");
    assert_eq!(linked_book_id, Some(book_id));
  }

  #[test]
  fn scan_on_startup_setting_defaults_true_and_persists() {
    let db = TestDb::new();
    assert!(db.repo.get_scan_on_startup().expect("default scan_on_startup"));

    db.repo
      .set_scan_on_startup(false, now())
      .expect("disable scan_on_startup");
    assert!(!db.repo.get_scan_on_startup().expect("read disabled scan_on_startup"));

    db.repo
      .set_scan_on_startup(true, now())
      .expect("enable scan_on_startup");
    assert!(db.repo.get_scan_on_startup().expect("read enabled scan_on_startup"));
  }

  #[test]
  fn mark_discovered_unlinks_file_and_removes_orphaned_book() {
    let db = TestDb::new();
    let (book_id, file_id) = create_matched_book(&db, "C:\\Books\\DiscoverUnlink");

    db.repo
      .mark_discovered(
        &file_id,
        "manual_test",
        Some("Dune".to_string()),
        Some("Frank Herbert".to_string()),
        None,
        None,
        serde_json::json!({}),
        now(),
      )
      .expect("mark discovered");

    assert!(db.repo.get_book_detail(&book_id).is_err());

    let discovered = db
      .repo
      .get_discovered_files(None, Some(1), Some(20))
      .expect("discovered list");
    assert!(discovered.items.iter().any(|item| item.file_id == file_id));

    let removed_orphans = db.repo.cleanup_orphan_books().expect("cleanup orphans");
    assert_eq!(removed_orphans, 0);
  }

  #[test]
  fn get_library_books_omits_books_without_linked_files() {
    let db = TestDb::new();
    db
      .repo
      .upsert_book(
        UpsertBookInput {
          title: "Orphan".to_string(),
          subtitle: None,
          authors: vec!["Nobody".to_string()],
          publisher: None,
          publish_date: None,
          isbn10: None,
          isbn13: None,
          description: None,
          language: None,
          page_count: None,
          series: None,
          series_index: None,
          cover_url: None,
          metadata_source: "api".to_string(),
          confidence: Some(0.8),
        },
        now(),
      )
      .expect("insert orphan book");

    let books = db
      .repo
      .get_library_books(None, BookFilters::default(), SortSpec::default(), Some(1), Some(10))
      .expect("list books");
    assert_eq!(books.total, 0);
    assert!(books.items.is_empty());
  }

  #[test]
  fn library_thing_books_are_visible_only_when_enabled() {
    let db = TestDb::new();
    let book_id = db
      .repo
      .upsert_book(
        UpsertBookInput {
          title: "LibraryThing Only".to_string(),
          subtitle: None,
          authors: vec!["Catalog Author".to_string()],
          publisher: None,
          publish_date: None,
          isbn10: None,
          isbn13: Some("9780441172719".to_string()),
          description: None,
          language: None,
          page_count: None,
          series: None,
          series_index: None,
          cover_url: None,
          metadata_source: "librarything".to_string(),
          confidence: Some(0.92),
        },
        now(),
      )
      .expect("upsert book");
    db
      .repo
      .upsert_external_source(
        &book_id,
        "librarything",
        "301952134",
        Some("12345"),
        "https://www.librarything.com/work/book/301952134",
        "{}",
        now(),
      )
      .expect("upsert source");

    let removed_orphans = db.repo.cleanup_orphan_books().expect("cleanup orphans");
    assert_eq!(removed_orphans, 0);
    assert!(db.repo.get_book_detail(&book_id).is_ok());

    let disabled = db
      .repo
      .get_library_books(None, BookFilters::default(), SortSpec::default(), Some(1), Some(20))
      .expect("disabled list");
    assert_eq!(disabled.total, 0);
    let disabled_filtered = db
      .repo
      .get_library_books(
        None,
        BookFilters {
          formats: vec!["librarything".to_string()],
          ..Default::default()
        },
        SortSpec::default(),
        Some(1),
        Some(20),
      )
      .expect("disabled filtered list");
    assert_eq!(disabled_filtered.total, 0);
    let disabled_detail = db.repo.get_book_detail(&book_id).expect("disabled detail");
    assert_eq!(disabled_detail.library_thing_url, None);

    db.repo.set_library_thing_enabled(true, now()).expect("enable");
    let enabled = db
      .repo
      .get_library_books(None, BookFilters::default(), SortSpec::default(), Some(1), Some(20))
      .expect("enabled list");
    assert_eq!(enabled.total, 1);
    assert_eq!(
      enabled.items[0].library_thing_url.as_deref(),
      Some("https://www.librarything.com/work/book/301952134")
    );
    let enabled_detail = db.repo.get_book_detail(&book_id).expect("enabled detail");
    assert_eq!(
      enabled_detail.library_thing_url.as_deref(),
      Some("https://www.librarything.com/work/book/301952134")
    );

    let enabled_filtered = db
      .repo
      .get_library_books(
        None,
        BookFilters {
          formats: vec!["librarything".to_string()],
          ..Default::default()
        },
        SortSpec::default(),
        Some(1),
        Some(20),
      )
      .expect("enabled filtered list");
    assert_eq!(enabled_filtered.total, 1);
    assert_eq!(enabled_filtered.items[0].id, book_id);
    assert!(enabled_filtered.items[0].formats.contains(&"librarything".to_string()));
  }

  #[test]
  fn legacy_library_thing_publication_values_are_repaired_on_reimport() {
    let db = TestDb::new();
    let book_id = db
      .repo
      .upsert_book(
        UpsertBookInput {
          title: "Example Book".to_string(),
          subtitle: None,
          authors: vec!["Example Author".to_string()],
          publisher: Some("Zondervan (2021), 208 pages".to_string()),
          publish_date: None,
          isbn10: None,
          isbn13: None,
          description: None,
          language: None,
          page_count: None,
          series: None,
          series_index: None,
          cover_url: None,
          metadata_source: "librarything".to_string(),
          confidence: Some(0.92),
        },
        now(),
      )
      .expect("upsert book");
    db
      .repo
      .upsert_external_source(
        &book_id,
        "librarything",
        "301952134",
        None,
        "https://www.librarything.com/work/book/301952134",
        "{}",
        now(),
      )
      .expect("upsert source");

    db
      .repo
      .repair_legacy_library_thing_publication(
        &book_id,
        "Zondervan (2021), 208 pages",
        Some("Zondervan"),
        Some("2021"),
        Some(208),
        now(),
      )
      .expect("repair legacy publication");

    let detail = db.repo.get_book_detail(&book_id).expect("book detail");
    assert_eq!(detail.publisher.as_deref(), Some("Zondervan"));
    assert_eq!(detail.publish_date.as_deref(), Some("2021"));
    assert_eq!(detail.page_count, Some(208));
  }

  #[test]
  fn removing_local_files_preserves_books_with_external_sources() {
    let db = TestDb::new();
    let (book_id, file_id) = create_matched_book(&db, "C:\\Books\\LibraryThingFileRemoval");
    db
      .repo
      .upsert_external_source(
        &book_id,
        "librarything",
        "301952134",
        None,
        "https://www.librarything.com/work/book/301952134",
        "{}",
        now(),
      )
      .expect("source");

    let (removed_files, removed_orphans) = db
      .repo
      .remove_files_and_cleanup_orphan_books(&[file_id], now())
      .expect("remove file");
    assert_eq!(removed_files, 1);
    assert_eq!(removed_orphans, 0);
    assert!(db.repo.get_book_detail(&book_id).is_ok());
  }

  #[test]
  fn clearing_library_thing_sources_removes_imported_only_books_and_preserves_local_books() {
    let db = TestDb::new();
    let (local_book_id, _) = create_matched_book(&db, "C:\\Books\\LibraryThingLocal");
    db
      .repo
      .upsert_external_source(
        &local_book_id,
        "librarything",
        "301952134",
        None,
        "https://www.librarything.com/work/book/301952134",
        "{}",
        now(),
      )
      .expect("local source");
    let imported_book_id = db
      .repo
      .upsert_book(
        UpsertBookInput {
          title: "Imported Only".to_string(),
          subtitle: None,
          authors: vec!["Catalog Author".to_string()],
          publisher: None,
          publish_date: None,
          isbn10: None,
          isbn13: None,
          description: None,
          language: None,
          page_count: None,
          series: None,
          series_index: None,
          cover_url: None,
          metadata_source: "librarything".to_string(),
          confidence: Some(0.92),
        },
        now(),
      )
      .expect("imported book");
    db
      .repo
      .upsert_external_source(
        &imported_book_id,
        "librarything",
        "301952135",
        None,
        "https://www.librarything.com/work/book/301952135",
        "{}",
        now(),
      )
      .expect("imported source");

    let (removed_sources, removed_books) = db.repo.clear_library_thing_sources(now()).expect("clear sources");
    assert_eq!(removed_sources, 2);
    assert_eq!(removed_books, 1);
    assert!(db.repo.get_book_detail(&local_book_id).is_ok());
    assert!(db.repo.get_book_detail(&imported_book_id).is_err());
    assert_eq!(db.repo.count_library_thing_books().expect("count"), 0);
  }

  #[test]
  fn hidden_books_are_excluded_and_restorable() {
    let db = TestDb::new();
    let (visible_book_id, _) = create_matched_book(&db, "C:\\Books\\Visible");
    let hidden_folder = db
      .repo
      .add_folder("C:\\Books\\Hidden", true, now())
      .expect("add hidden folder");
    let (hidden_file, _) = db
      .repo
      .upsert_file_with_existing(
        UpsertFilePayload {
          folder_id: hidden_folder.id.clone(),
          abs_path: "C:\\Books\\Hidden\\hidden.epub".to_string(),
          ext: "epub".to_string(),
          size_bytes: 2_048,
          mtime_utc: now().to_string(),
          hash_sha256: None,
          status: "discovered".to_string(),
          parser_error: None,
          guessed_title: Some("Hidden Title".to_string()),
          guessed_author: Some("Hidden Author".to_string()),
          guessed_isbn: Some("9780000009999".to_string()),
        },
        None,
        now(),
      )
      .expect("upsert hidden file");
    let hidden_book_id = create_book_with_isbn(&db, "Hidden Title", None, Some("9780000009999"));
    db.repo
      .link_file_to_book(&hidden_file.id, &hidden_book_id, "epub", true, now())
      .expect("link hidden file");

    let hidden_count = db
      .repo
      .set_books_hidden(vec![hidden_book_id.clone()], true, now())
      .expect("hide book");
    assert_eq!(hidden_count, 1);

    let visible_books = db
      .repo
      .get_library_books(None, BookFilters::default(), SortSpec::default(), Some(1), Some(20))
      .expect("visible books");
    assert!(visible_books.items.iter().any(|item| item.id == visible_book_id));
    assert!(!visible_books.items.iter().any(|item| item.id == hidden_book_id));

    let hidden_books = db
      .repo
      .get_hidden_books(None, Some(1), Some(20))
      .expect("hidden books");
    assert!(hidden_books.items.iter().any(|item| item.id == hidden_book_id));
    assert!(!hidden_books.items.iter().any(|item| item.id == visible_book_id));

    let restored_count = db
      .repo
      .set_books_hidden(vec![hidden_book_id.clone()], false, now())
      .expect("restore book");
    assert_eq!(restored_count, 1);

    let hidden_books_after_restore = db
      .repo
      .get_hidden_books(None, Some(1), Some(20))
      .expect("hidden books after restore");
    assert!(!hidden_books_after_restore.items.iter().any(|item| item.id == hidden_book_id));
  }

  #[test]
  fn folder_removal_preview_counts_files_and_orphaned_books() {
    let db = TestDb::new();
    let folder_a = db
      .repo
      .add_folder("C:\\Books\\PreviewA", true, now())
      .expect("add folder a");
    let folder_b = db
      .repo
      .add_folder("C:\\Books\\PreviewB", true, now())
      .expect("add folder b");

    let (a_file_orphan, _) = db
      .repo
      .upsert_file_with_existing(
        UpsertFilePayload {
          folder_id: folder_a.id.clone(),
          abs_path: "C:\\Books\\PreviewA\\orphan.pdf".to_string(),
          ext: "pdf".to_string(),
          size_bytes: 111,
          mtime_utc: now().to_string(),
          hash_sha256: None,
          status: "matched".to_string(),
          parser_error: None,
          guessed_title: Some("Only In A".to_string()),
          guessed_author: Some("Author A".to_string()),
          guessed_isbn: None,
        },
        None,
        now(),
      )
      .expect("insert orphan file in a");
    let (a_file_shared, _) = db
      .repo
      .upsert_file_with_existing(
        UpsertFilePayload {
          folder_id: folder_a.id.clone(),
          abs_path: "C:\\Books\\PreviewA\\shared.pdf".to_string(),
          ext: "pdf".to_string(),
          size_bytes: 222,
          mtime_utc: now().to_string(),
          hash_sha256: None,
          status: "matched".to_string(),
          parser_error: None,
          guessed_title: Some("Shared".to_string()),
          guessed_author: Some("Author Shared".to_string()),
          guessed_isbn: None,
        },
        None,
        now(),
      )
      .expect("insert shared file in a");
    let (b_file_shared, _) = db
      .repo
      .upsert_file_with_existing(
        UpsertFilePayload {
          folder_id: folder_b.id.clone(),
          abs_path: "C:\\Books\\PreviewB\\shared.epub".to_string(),
          ext: "epub".to_string(),
          size_bytes: 333,
          mtime_utc: now().to_string(),
          hash_sha256: None,
          status: "matched".to_string(),
          parser_error: None,
          guessed_title: Some("Shared".to_string()),
          guessed_author: Some("Author Shared".to_string()),
          guessed_isbn: None,
        },
        None,
        now(),
      )
      .expect("insert shared file in b");

    let orphan_book = db
      .repo
      .upsert_book(
        UpsertBookInput {
          title: "Only In A".to_string(),
          subtitle: None,
          authors: vec!["Author A".to_string()],
          publisher: None,
          publish_date: None,
          isbn10: None,
          isbn13: Some("9780000000101".to_string()),
          description: None,
          language: None,
          page_count: None,
          series: None,
          series_index: None,
          cover_url: None,
          metadata_source: "api".to_string(),
          confidence: Some(0.8),
        },
        now(),
      )
      .expect("insert orphan book");
    let shared_book = db
      .repo
      .upsert_book(
        UpsertBookInput {
          title: "Shared".to_string(),
          subtitle: None,
          authors: vec!["Author Shared".to_string()],
          publisher: None,
          publish_date: None,
          isbn10: None,
          isbn13: Some("9780000000102".to_string()),
          description: None,
          language: None,
          page_count: None,
          series: None,
          series_index: None,
          cover_url: None,
          metadata_source: "api".to_string(),
          confidence: Some(0.8),
        },
        now(),
      )
      .expect("insert shared book");

    db.repo
      .link_file_to_book(&a_file_orphan.id, &orphan_book, "pdf", true, now())
      .expect("link orphan");
    db.repo
      .link_file_to_book(&a_file_shared.id, &shared_book, "pdf", true, now())
      .expect("link shared a");
    db.repo
      .link_file_to_book(&b_file_shared.id, &shared_book, "epub", false, now())
      .expect("link shared b");

    let file_count = db
      .repo
      .count_files_for_folder(&folder_a.id)
      .expect("count files in folder a");
    let orphaned_books = db
      .repo
      .count_books_orphaned_by_folder_removal(&folder_a.id)
      .expect("count orphaned books in folder a removal");

    assert_eq!(file_count, 2);
    assert_eq!(orphaned_books, 1);
  }

  #[test]
  fn delete_book_moves_files_back_to_discovered() {
    let db = TestDb::new();
    let (book_id, file_id) = create_matched_book(&db, "C:\\Books\\DeleteFlow");

    db.repo.delete_book(&book_id, now()).expect("delete book");

    let books = db
      .repo
      .get_library_books(None, BookFilters::default(), SortSpec::default(), Some(1), Some(10))
      .expect("list books");
    assert_eq!(books.total, 0);

    let file = db
      .repo
      .get_file_by_id(&file_id)
      .expect("fetch file")
      .expect("file exists");
    assert_eq!(file.status, "discovered");

    let discovered = db
      .repo
      .get_discovered_files(None, Some(1), Some(20))
      .expect("discovered");
    assert!(discovered.items.iter().any(|item| item.file_id == file_id));
  }

  #[test]
  fn list_book_ids_missing_cover_includes_google_content_and_excludes_openlibrary() {
    let db = TestDb::new();

    let missing_id = db
      .repo
      .upsert_book(
        UpsertBookInput {
          title: "Missing Cover Book".to_string(),
          subtitle: None,
          authors: vec!["Author One".to_string()],
          publisher: None,
          publish_date: None,
          isbn10: None,
          isbn13: Some("9780000099001".to_string()),
          description: None,
          language: None,
          page_count: None,
          series: None,
          series_index: None,
          cover_url: None,
          metadata_source: "api".to_string(),
          confidence: Some(0.8),
        },
        now(),
      )
      .expect("insert missing-cover book");

    let google_id = db
      .repo
      .upsert_book(
        UpsertBookInput {
          title: "Google Cover Book".to_string(),
          subtitle: None,
          authors: vec!["Author Two".to_string()],
          publisher: None,
          publish_date: None,
          isbn10: None,
          isbn13: Some("9780000099002".to_string()),
          description: None,
          language: None,
          page_count: None,
          series: None,
          series_index: None,
          cover_url: Some(
            "https://books.google.com/books/content?id=abc123&printsec=frontcover&img=1".to_string(),
          ),
          metadata_source: "api".to_string(),
          confidence: Some(0.8),
        },
        now(),
      )
      .expect("insert google-cover book");

    let openlibrary_id = db
      .repo
      .upsert_book(
        UpsertBookInput {
          title: "Open Library Cover Book".to_string(),
          subtitle: None,
          authors: vec!["Author Three".to_string()],
          publisher: None,
          publish_date: None,
          isbn10: None,
          isbn13: Some("9780000099003".to_string()),
          description: None,
          language: None,
          page_count: None,
          series: None,
          series_index: None,
          cover_url: Some("https://covers.openlibrary.org/b/id/31906-L.jpg?default=false".to_string()),
          metadata_source: "api".to_string(),
          confidence: Some(0.8),
        },
        now(),
      )
      .expect("insert openlibrary-cover book");

    let candidates = db
      .repo
      .list_book_ids_missing_cover()
      .expect("list cover refresh candidates");

    assert!(candidates.contains(&missing_id));
    assert!(candidates.contains(&google_id));
    assert!(!candidates.contains(&openlibrary_id));
  }
}
