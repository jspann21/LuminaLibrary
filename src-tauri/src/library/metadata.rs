use std::{
  ffi::OsStr,
  fmt::Write as _,
  fs::File,
  io::Read,
  path::Path,
  sync::Arc,
  time::{Duration, SystemTime},
};

use anyhow::{anyhow, Context};
use chrono::{DateTime, LocalResult, NaiveTime, TimeZone, Utc};
use chrono_tz::America::Los_Angeles;
use once_cell::sync::Lazy;
use parking_lot::RwLock;
use regex::Regex;
use reqwest::{blocking::Client, StatusCode};
use roxmltree::Document as XmlDocument;
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use sha2::{Digest, Sha256};
use strsim::jaro_winkler;
use zip::ZipArchive;

use crate::library::types::{EnrichedBook, MetadataCandidate, MetadataSourceStatus, ParsedMetadata};

pub const AUTO_MATCH_THRESHOLD: f64 = 0.88;

static ISBN_PATTERN: Lazy<Regex> = Lazy::new(|| {
  Regex::new(r"(?i)(97[89][-\s]?)?\d[-\s]?\d{2,5}[-\s]?\d{2,7}[-\s]?\d{1,7}[-\s]?[\dX]")
    .expect("valid isbn regex")
});
static FILENAME_NOISE_PATTERN: Lazy<Regex> = Lazy::new(|| {
  Regex::new(
    r"(?ix)
      \b(
        bookcrawler|
        kingdomsermons(?:\.com)?|
        scan(?:ned)?|
        ocr|
        copy|
        final|
        draft|
        v\d+|
        pdf|
        epub
      )\b",
  )
  .expect("valid filename noise regex")
});
static FILENAME_TIMESTAMP_PATTERN: Lazy<Regex> = Lazy::new(|| {
  Regex::new(r"\b\d{4}(?:[-_]\d{2}){2,5}\b").expect("valid timestamp regex")
});
static FILENAME_TRAILING_COUNTER_PATTERN: Lazy<Regex> = Lazy::new(|| {
  Regex::new(r"(?i)\s+(?:copy\s*)?\d{1,2}[A-Z]?\s*$").expect("valid trailing counter regex")
});
static FILENAME_TRAILING_DIGIT_TOKEN_PATTERN: Lazy<Regex> = Lazy::new(|| {
  Regex::new(r"(?i)\b([A-Z]{3,})(\d{1,2})\b").expect("valid alnum token regex")
});
static AUTHOR_TRAILING_LIFESPAN_PATTERN: Lazy<Regex> = Lazy::new(|| {
  Regex::new(r"(?i)[,\s-]*\d{4}\s*-\s*$").expect("valid author lifespan regex")
});
static TITLE_VOLUME_PATTERN: Lazy<Regex> = Lazy::new(|| {
  Regex::new(r"(?i)\bvol(?:ume)?\.?\s*\d+[A-Z]?\b").expect("valid title volume regex")
});
const COVER_MATCH_THRESHOLD: f64 = 0.86;
const ENRICHMENT_TITLE_VARIANT_LIMIT: usize = 6;
const MAX_CANDIDATES_PER_SOURCE: usize = 5;
const GOOGLE_BOOKS_PLACEHOLDER_SHA256: [&str; 1] = [
  // Google Books "image not available" placeholder observed from books/content endpoint.
  "12557f8948b8bdc6af436e3a8b3adddd45f7f7d2b67c5832e799cdf4686f72bb",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EnrichmentSource {
  OpenLibrary,
  GoogleBooks,
}

#[derive(Debug, Clone)]
struct SourcedEnrichedBook {
  source: EnrichmentSource,
  book: EnrichedBook,
}

#[derive(Clone)]
pub struct OpenLibraryEnricher {
  client: Client,
  google_books_api_key: Arc<RwLock<Option<String>>>,
  google_books_quota: Arc<RwLock<GoogleBooksQuotaState>>,
}

#[derive(Debug, Clone, Default)]
struct GoogleBooksQuotaState {
  limited_until: Option<SystemTime>,
}

impl OpenLibraryEnricher {
  pub fn new() -> Self {
    let client = Client::builder()
      .timeout(Duration::from_secs(12))
      .user_agent("lumina-library-desktop/0.1")
      .build()
      .expect("failed to build reqwest client");
    let google_books_api_key = Arc::new(RwLock::new(env_google_books_api_key()));
    let google_books_quota = Arc::new(RwLock::new(GoogleBooksQuotaState::default()));
    Self {
      client,
      google_books_api_key,
      google_books_quota,
    }
  }

  pub fn set_google_books_api_key(&self, api_key: Option<String>) {
    *self.google_books_api_key.write() = api_key
      .map(|value| value.trim().to_string())
      .filter(|value| !value.is_empty());
    self.google_books_quota.write().limited_until = None;
  }

  pub fn google_books_api_key_configured(&self) -> bool {
    self
      .google_books_api_key
      .read()
      .as_ref()
      .map(|value| !value.trim().is_empty())
      .unwrap_or(false)
  }

  pub fn google_books_quota_notice(&self) -> Option<(String, String)> {
    let until = self.google_books_quota_until()?;
    let until_dt: DateTime<Utc> = until.into();
    let until_pt = until_dt.with_timezone(&Los_Angeles);
    let until_iso = until_dt.to_rfc3339();
    let message = format!(
      "Google Books API daily quota appears to be exhausted. Continuing with Open Library only until {} PT.",
      until_pt.format("%Y-%m-%d %I:%M %p")
    );
    Some((message, until_iso))
  }

  pub fn enrich(&self, metadata: &ParsedMetadata) -> anyhow::Result<Option<EnrichedBook>> {
    let mut errors: Vec<String> = Vec::new();

    let open_candidate = match self.enrich_open_library(metadata) {
      Ok(value) => value,
      Err(err) => {
        errors.push(format!("open library: {err}"));
        None
      }
    };

    let google_candidate = match self.enrich_google_books(metadata) {
      Ok(value) => value,
      Err(err) => {
        errors.push(format!("google books: {err}"));
        None
      }
    };

    if open_candidate.is_none() && google_candidate.is_none() {
      if errors.is_empty() {
        return Ok(None);
      }
      return Err(anyhow!(errors.join(" | ")));
    }

    let (primary, secondary) = choose_primary_candidate(open_candidate, google_candidate)
      .ok_or_else(|| anyhow!("no metadata candidates available"))?;
    let prefer_google_cover = matches!(primary.source, EnrichmentSource::GoogleBooks);
    let mut merged = merge_enriched_books(primary.book, secondary.map(|candidate| candidate.book));
    if merged.confidence >= AUTO_MATCH_THRESHOLD {
      merged = self.with_resolved_cover(merged, metadata, prefer_google_cover);
    }
    Ok(Some(merged))
  }

  pub fn preview_metadata_candidates(
    &self,
    metadata: &ParsedMetadata,
  ) -> (Vec<MetadataCandidate>, Vec<MetadataSourceStatus>) {
    let mut candidates: Vec<MetadataCandidate> = Vec::new();
    let mut statuses: Vec<MetadataSourceStatus> = Vec::new();

    match self.enrich_open_library_multi(metadata) {
      Ok(results) if !results.is_empty() => {
        let count = results.len() as u32;
        for (i, sourced) in results.iter().enumerate() {
          let id = format!("open_library:{i}");
          candidates.push(metadata_candidate_from_enriched(&id, "open_library", &sourced.book));
        }
        statuses.push(MetadataSourceStatus {
          source: "open_library".to_string(),
          status: "ok".to_string(),
          message: None,
          candidate_count: count,
        });
      }
      Ok(_) => {
        statuses.push(MetadataSourceStatus {
          source: "open_library".to_string(),
          status: "no_match".to_string(),
          message: None,
          candidate_count: 0,
        });
      }
      Err(err) => {
        statuses.push(MetadataSourceStatus {
          source: "open_library".to_string(),
          status: "error".to_string(),
          message: Some(err.to_string()),
          candidate_count: 0,
        });
      }
    }

    let quota_notice = self.google_books_quota_notice();
    match self.enrich_google_books_multi(metadata) {
      Ok(results) if !results.is_empty() => {
        let count = results.len() as u32;
        for (i, sourced) in results.iter().enumerate() {
          let id = format!("google_books:{i}");
          candidates.push(metadata_candidate_from_enriched(&id, "google_books", &sourced.book));
        }
        statuses.push(MetadataSourceStatus {
          source: "google_books".to_string(),
          status: "ok".to_string(),
          message: None,
          candidate_count: count,
        });
      }
      Ok(_) => {
        let (status, message) = if let Some((quota_message, _)) = quota_notice {
          ("limited".to_string(), Some(quota_message))
        } else {
          ("no_match".to_string(), None)
        };
        statuses.push(MetadataSourceStatus {
          source: "google_books".to_string(),
          status,
          message,
          candidate_count: 0,
        });
      }
      Err(err) => {
        statuses.push(MetadataSourceStatus {
          source: "google_books".to_string(),
          status: "error".to_string(),
          message: Some(err.to_string()),
          candidate_count: 0,
        });
      }
    }

    (candidates, statuses)
  }

  fn enrich_open_library(&self, metadata: &ParsedMetadata) -> anyhow::Result<Option<SourcedEnrichedBook>> {
    if let Some(exact_match) = self.enrich_open_library_by_isbn(metadata)? {
      return Ok(Some(SourcedEnrichedBook {
        source: EnrichmentSource::OpenLibrary,
        book: exact_match,
      }));
    }

    let mut query_sets: Vec<Vec<(String, String)>> = Vec::new();
    if let Some(isbn) = metadata.isbn13.clone().or(metadata.isbn10.clone()) {
      query_sets.push(vec![("isbn".to_string(), isbn)]);
    }
    if let Some(title) = metadata.title.as_deref() {
      let title_candidates = title_query_candidates(title);
      let author_candidates = author_query_candidates(metadata.authors.first().map(String::as_str));
      for title_candidate in title_candidates.iter().take(ENRICHMENT_TITLE_VARIANT_LIMIT) {
        for author_candidate in &author_candidates {
          let mut set = vec![("title".to_string(), title_candidate.clone())];
          if let Some(author) = author_candidate.clone() {
            set.push(("author".to_string(), author));
          }
          query_sets.push(set);
        }
      }
    } else if let Some(author) = metadata.authors.first().cloned() {
      query_sets.push(vec![("author".to_string(), author)]);
    }

    let fallback_titles = metadata
      .title
      .as_deref()
      .map(title_query_candidates)
      .unwrap_or_default();
    if fallback_titles.is_empty() {
      let fallback_query = [
        metadata.title.clone().unwrap_or_default(),
        metadata.authors.first().cloned().unwrap_or_default(),
        metadata
          .isbn13
          .clone()
          .or(metadata.isbn10.clone())
          .unwrap_or_default(),
      ]
      .join(" ")
      .trim()
      .to_string();
      if !fallback_query.is_empty() {
        query_sets.push(vec![("q".to_string(), fallback_query)]);
      }
    } else {
      for title_candidate in fallback_titles.iter().take(ENRICHMENT_TITLE_VARIANT_LIMIT) {
        let fallback_query = [
          title_candidate.clone(),
          metadata.authors.first().cloned().unwrap_or_default(),
          metadata
            .isbn13
            .clone()
            .or(metadata.isbn10.clone())
            .unwrap_or_default(),
        ]
        .join(" ")
        .trim()
        .to_string();
        if !fallback_query.is_empty() {
          query_sets.push(vec![("q".to_string(), fallback_query)]);
        }
      }
    }

    let mut deduped_sets = Vec::new();
    let mut seen_queries = HashSet::new();
    for set in query_sets {
      let mut key_parts: Vec<String> = set.iter().map(|(k, v)| format!("{k}={v}")).collect();
      key_parts.sort();
      let key = key_parts.join("&");
      if seen_queries.insert(key) {
        deduped_sets.push(set);
      }
    }

    let collected = self.collect_open_library_search_candidates(metadata, deduped_sets)?;

    let Some(book) = collected.into_iter().next() else {
      return Ok(None);
    };

    let book = self.enrich_open_library_candidate_by_isbn(book);

    Ok(Some(SourcedEnrichedBook {
      source: EnrichmentSource::OpenLibrary,
      book,
    }))
  }

  /// Collects multiple Open Library search candidates across all query sets,
  /// deduplicating by normalized (title, authors) and returning up to `MAX_CANDIDATES_PER_SOURCE`
  /// results sorted by confidence descending.
  fn collect_open_library_search_candidates(
    &self,
    metadata: &ParsedMetadata,
    deduped_sets: Vec<Vec<(String, String)>>,
  ) -> anyhow::Result<Vec<EnrichedBook>> {
    const MIN_CONFIDENCE: f64 = 0.3;

    let mut all_candidates: Vec<EnrichedBook> = Vec::new();
    let mut seen_keys: HashSet<String> = HashSet::new();

    for mut query_set in deduped_sets {
      query_set.push(("limit".to_string(), "8".to_string()));
      let response = self
        .client
        .get("https://openlibrary.org/search.json")
        .query(&query_set)
        .send()
        .context("open library request failed")?;

      if !response.status().is_success() {
        continue;
      }

      let payload: OpenLibrarySearchResponse = match response.json() {
        Ok(value) => value,
        Err(_) => continue,
      };
      for doc in payload.docs {
        let title = doc.title.unwrap_or_default();
        if title.trim().is_empty() {
          continue;
        }

        let authors = doc.author_name.unwrap_or_default();
        let publisher = doc.publisher.and_then(|values| values.into_iter().next());
        let publish_date = doc.first_publish_year.map(|year| year.to_string());
        let language = doc
          .language
          .and_then(|values| values.into_iter().next())
          .map(|value| value.to_string());
        let description = doc
          .first_sentence
          .as_ref()
          .and_then(open_library_text_value_to_string);

        let mut isbn10: Option<String> = None;
        let mut isbn13: Option<String> = None;
        let mut matched_query_isbn = false;
        if let Some(isbns) = doc.isbn {
          for value in isbns {
            let Some(normalized) = normalize_valid_isbn(&value) else {
              continue;
            };
            match normalized.len() {
              10 if isbn10.is_none() => isbn10 = Some(normalized.clone()),
              13 if isbn13.is_none() => isbn13 = Some(normalized.clone()),
              _ => {}
            }
            if metadata
              .isbn13
              .as_deref()
              .map(|isbn| isbn == normalized)
              .unwrap_or(false)
              || metadata
                .isbn10
                .as_deref()
                .map(|isbn| isbn == normalized)
                .unwrap_or(false)
            {
              matched_query_isbn = true;
            }
          }
        }

        let mut confidence = confidence_score(metadata, &title, &authors, publish_date.as_deref());
        if matched_query_isbn {
          confidence = confidence.max(0.97);
        }

        if confidence < MIN_CONFIDENCE {
          continue;
        }

        // Deduplicate by normalized title + authors + isbn
        let dedup_key = candidate_dedup_key(&title, &authors, isbn13.as_deref(), isbn10.as_deref());
        if !seen_keys.insert(dedup_key) {
          continue;
        }

        all_candidates.push(EnrichedBook {
          title,
          subtitle: None,
          authors,
          publisher,
          publish_date,
          isbn10,
          isbn13,
          description,
          language,
          page_count: None,
          cover_url: normalize_cover_url(
            doc
              .cover_i
              .map(|cover_id| format!("https://covers.openlibrary.org/b/id/{cover_id}-M.jpg?default=false")),
          ),
          confidence,
        });
      }
    }

    // Sort by confidence descending, cap at limit
    all_candidates.sort_by(|a, b| b.confidence.partial_cmp(&a.confidence).unwrap_or(std::cmp::Ordering::Equal));
    all_candidates.truncate(MAX_CANDIDATES_PER_SOURCE);
    Ok(all_candidates)
  }

  /// Returns multiple Open Library candidates for the preview UI.
  fn enrich_open_library_multi(&self, metadata: &ParsedMetadata) -> anyhow::Result<Vec<SourcedEnrichedBook>> {
    // ISBN exact match first — if found, include it as the top candidate
    let isbn_candidate = self.enrich_open_library_by_isbn(metadata)?;

    let mut query_sets: Vec<Vec<(String, String)>> = Vec::new();
    if let Some(isbn) = metadata.isbn13.clone().or(metadata.isbn10.clone()) {
      query_sets.push(vec![("isbn".to_string(), isbn)]);
    }
    if let Some(title) = metadata.title.as_deref() {
      let title_candidates = title_query_candidates(title);
      let author_candidates = author_query_candidates(metadata.authors.first().map(String::as_str));
      for title_candidate in title_candidates.iter().take(ENRICHMENT_TITLE_VARIANT_LIMIT) {
        for author_candidate in &author_candidates {
          let mut set = vec![("title".to_string(), title_candidate.clone())];
          if let Some(author) = author_candidate.clone() {
            set.push(("author".to_string(), author));
          }
          query_sets.push(set);
        }
      }
    } else if let Some(author) = metadata.authors.first().cloned() {
      query_sets.push(vec![("author".to_string(), author)]);
    }

    let fallback_titles = metadata
      .title
      .as_deref()
      .map(title_query_candidates)
      .unwrap_or_default();
    if fallback_titles.is_empty() {
      let fallback_query = [
        metadata.title.clone().unwrap_or_default(),
        metadata.authors.first().cloned().unwrap_or_default(),
        metadata.isbn13.clone().or(metadata.isbn10.clone()).unwrap_or_default(),
      ]
      .join(" ")
      .trim()
      .to_string();
      if !fallback_query.is_empty() {
        query_sets.push(vec![("q".to_string(), fallback_query)]);
      }
    } else {
      for title_candidate in fallback_titles.iter().take(ENRICHMENT_TITLE_VARIANT_LIMIT) {
        let fallback_query = [
          title_candidate.clone(),
          metadata.authors.first().cloned().unwrap_or_default(),
          metadata.isbn13.clone().or(metadata.isbn10.clone()).unwrap_or_default(),
        ]
        .join(" ")
        .trim()
        .to_string();
        if !fallback_query.is_empty() {
          query_sets.push(vec![("q".to_string(), fallback_query)]);
        }
      }
    }

    let mut deduped_sets = Vec::new();
    let mut seen_queries = HashSet::new();
    for set in query_sets {
      let mut key_parts: Vec<String> = set.iter().map(|(k, v)| format!("{k}={v}")).collect();
      key_parts.sort();
      let key = key_parts.join("&");
      if seen_queries.insert(key) {
        deduped_sets.push(set);
      }
    }

    let mut collected = self.collect_open_library_search_candidates(metadata, deduped_sets)?;

    // If we got an ISBN exact match, ensure it's at the front (dedup against search results)
    if let Some(isbn_book) = isbn_candidate {
      let isbn_key = candidate_dedup_key(
        &isbn_book.title,
        &isbn_book.authors,
        isbn_book.isbn13.as_deref(),
        isbn_book.isbn10.as_deref(),
      );
      collected.retain(|c| candidate_dedup_key(&c.title, &c.authors, c.isbn13.as_deref(), c.isbn10.as_deref()) != isbn_key);
      collected.insert(0, isbn_book);
      collected.truncate(MAX_CANDIDATES_PER_SOURCE);
    }

    Ok(collected.into_iter().map(|book| SourcedEnrichedBook {
      source: EnrichmentSource::OpenLibrary,
      book,
    }).collect())
  }

  pub fn resolve_cover_only(
    &self,
    metadata: &ParsedMetadata,
    existing_cover_url: Option<String>,
  ) -> Option<String> {
    self.resolve_cover_url(
      existing_cover_url,
      metadata.title.as_deref(),
      &metadata.authors,
      metadata.isbn13.as_deref(),
      metadata.isbn10.as_deref(),
      false,
    )
  }

  pub fn is_google_placeholder_cover_url(&self, cover_url: &str) -> bool {
    let normalized = match normalize_cover_url(Some(cover_url.to_string())) {
      Some(url) => url,
      None => return false,
    };
    if !is_google_books_cover_url(&normalized) {
      return false;
    }
    let response = match self.client.get(&normalized).send() {
      Ok(value) => value,
      Err(_) => return false,
    };
    if !response.status().is_success() {
      return false;
    }
    let content_type = response
      .headers()
      .get(reqwest::header::CONTENT_TYPE)
      .and_then(|value| value.to_str().ok())
      .unwrap_or_default()
      .to_ascii_lowercase();
    if !content_type.is_empty() && !content_type.starts_with("image/") {
      return false;
    }
    match response.bytes() {
      Ok(bytes) => is_known_google_placeholder_image(bytes.as_ref()),
      Err(_) => false,
    }
  }

  fn enrich_open_library_by_isbn(&self, metadata: &ParsedMetadata) -> anyhow::Result<Option<EnrichedBook>> {
    let mut isbn_candidates: Vec<String> = Vec::new();
    if let Some(isbn13) = metadata
      .isbn13
      .as_deref()
      .and_then(normalize_valid_isbn)
      .filter(|value| value.len() == 13)
    {
      isbn_candidates.push(isbn13);
    }
    if let Some(isbn10) = metadata
      .isbn10
      .as_deref()
      .and_then(normalize_valid_isbn)
      .filter(|value| value.len() == 10)
    {
      if !isbn_candidates.iter().any(|value| value == &isbn10) {
        isbn_candidates.push(isbn10);
      }
    }
    if isbn_candidates.is_empty() {
      return Ok(None);
    }

    let mut matched_input_isbn: Option<String> = None;
    let mut matched_book: Option<OpenLibraryBookData> = None;
    for isbn in isbn_candidates {
      let bib_key = format!("ISBN:{isbn}");
      let response = self
        .client
        .get("https://openlibrary.org/api/books")
        .query(&[
          ("bibkeys", bib_key.as_str()),
          ("format", "json"),
          ("jscmd", "data"),
        ])
        .send()
        .context("open library isbn request failed")?;
      if !response.status().is_success() {
        continue;
      }

      let mut payload: HashMap<String, OpenLibraryBookData> = response.json().unwrap_or_default();
      if let Some(book) = payload.remove(&bib_key) {
        matched_input_isbn = Some(isbn);
        matched_book = Some(book);
        break;
      }
    }

    let Some(isbn) = matched_input_isbn else {
      return Ok(None);
    };
    let Some(book) = matched_book.as_ref() else {
      return Ok(None);
    };

    let title = sanitize_metadata_value(&book.title).unwrap_or_default();
    if title.is_empty() {
      return Ok(None);
    }

    let authors = book
      .authors
      .clone()
      .unwrap_or_default()
      .into_iter()
      .filter_map(|author| sanitize_metadata_value(&author.name))
      .collect::<Vec<_>>();

    let publisher = book
      .publishers
      .clone()
      .unwrap_or_default()
      .into_iter()
      .find_map(|publisher| sanitize_metadata_value(&publisher.name));

    let mut isbn10 = book
      .identifiers
      .as_ref()
      .and_then(|ids| ids.isbn_10.clone())
      .and_then(|values| values.into_iter().next())
      .and_then(|value| normalize_valid_isbn(&value))
      .filter(|value| value.len() == 10);

    let mut isbn13 = book
      .identifiers
      .as_ref()
      .and_then(|ids| ids.isbn_13.clone())
      .and_then(|values| values.into_iter().next())
      .and_then(|value| normalize_valid_isbn(&value))
      .filter(|value| value.len() == 13);

    if isbn.len() == 10 && isbn10.is_none() {
      isbn10 = Some(isbn.clone());
    }
    if isbn.len() == 13 && isbn13.is_none() {
      isbn13 = Some(isbn.clone());
    }

    let cover_url = normalize_cover_url(book.cover.as_ref().and_then(|cover| {
      cover
        .large
        .clone()
        .or(cover.medium.clone())
        .or(cover.small.clone())
    }));
    let description = book
      .description
      .as_ref()
      .and_then(open_library_text_value_to_string)
      .or_else(|| book.notes.as_ref().and_then(open_library_text_value_to_string));

    Ok(Some(EnrichedBook {
      title,
      subtitle: sanitize_metadata_value(book.subtitle.as_deref().unwrap_or("")),
      authors,
      publisher,
      publish_date: sanitize_metadata_value(book.publish_date.as_deref().unwrap_or("")),
      isbn10,
      isbn13,
      description,
      language: None,
      page_count: book.number_of_pages,
      cover_url,
      confidence: 1.0,
    }))
  }

  fn enrich_open_library_candidate_by_isbn(&self, book: EnrichedBook) -> EnrichedBook {
    let isbn = book.isbn13.clone().or(book.isbn10.clone());
    let Some(isbn) = isbn else {
      return book;
    };
    let mut isbn_lookup = ParsedMetadata::default();
    if isbn.len() == 13 {
      isbn_lookup.isbn13 = Some(isbn);
    } else if isbn.len() == 10 {
      isbn_lookup.isbn10 = Some(isbn);
    } else {
      return book;
    }

    let base_confidence = book.confidence;
    match self.enrich_open_library_by_isbn(&isbn_lookup) {
      Ok(Some(by_isbn)) => {
        let mut merged = merge_enriched_books(book, Some(by_isbn));
        // Keep search confidence to avoid over-promoting unrelated fuzzy candidates.
        merged.confidence = base_confidence;
        merged
      }
      _ => book,
    }
  }

  fn with_resolved_cover(
    &self,
    mut book: EnrichedBook,
    metadata: &ParsedMetadata,
    prefer_google_cover: bool,
  ) -> EnrichedBook {
    let title = if !book.title.trim().is_empty() {
      Some(book.title.as_str())
    } else {
      metadata.title.as_deref()
    };
    let authors_ref: &[String] = if !book.authors.is_empty() {
      &book.authors
    } else {
      &metadata.authors
    };
    book.cover_url = self.resolve_cover_url(
      book.cover_url.clone(),
      title,
      authors_ref,
      book.isbn13.as_deref().or(metadata.isbn13.as_deref()),
      book.isbn10.as_deref().or(metadata.isbn10.as_deref()),
      prefer_google_cover,
    );
    book
  }

  fn resolve_cover_url(
    &self,
    existing_cover_url: Option<String>,
    title: Option<&str>,
    authors: &[String],
    isbn13: Option<&str>,
    isbn10: Option<&str>,
    prefer_google_cover: bool,
  ) -> Option<String> {
    let mut isbn_candidates: Vec<&str> = Vec::new();
    if let Some(value) = isbn13.filter(|value| !value.trim().is_empty()) {
      isbn_candidates.push(value);
    }
    if let Some(value) = isbn10.filter(|value| !value.trim().is_empty()) {
      if !isbn_candidates.iter().any(|existing| existing == &value) {
        isbn_candidates.push(value);
      }
    }

    if let Some(existing) = normalize_cover_url(existing_cover_url) {
      if is_google_books_cover_url(&existing) {
        for isbn in &isbn_candidates {
          if let Some(url) = self.open_library_cover_by_isbn(isbn) {
            return Some(url);
          }
        }
        if self.probe_cover_url(&existing).is_some() {
          return Some(existing);
        }
      } else {
        return Some(existing);
      }
    }

    if prefer_google_cover {
      for isbn in &isbn_candidates {
        if let Some(url) = self.google_cover_by_isbn(isbn) {
          return Some(url);
        }
      }
      for isbn in &isbn_candidates {
        if let Some(url) = self.open_library_cover_by_isbn(isbn) {
          return Some(url);
        }
      }
    } else {
      for isbn in &isbn_candidates {
        if let Some(url) = self.open_library_cover_by_isbn(isbn) {
          return Some(url);
        }
      }
      for isbn in &isbn_candidates {
        if let Some(url) = self.google_cover_by_isbn(isbn) {
          return Some(url);
        }
      }
    }

    let title = title.map(str::trim).filter(|value| !value.is_empty());
    if let Some(title) = title {
      let first_author = authors.first().map(String::as_str);
      if prefer_google_cover {
        if let Some(url) = self.google_cover_by_title_author(title, first_author) {
          return Some(url);
        }
        if let Some(url) = self.open_library_cover_by_title_author(title, first_author) {
          return Some(url);
        }
      } else {
        if let Some(url) = self.open_library_cover_by_title_author(title, first_author) {
          return Some(url);
        }
        if let Some(url) = self.google_cover_by_title_author(title, first_author) {
          return Some(url);
        }
      }
    }

    None
  }

  fn open_library_cover_by_isbn(&self, isbn: &str) -> Option<String> {
    let url = format!("https://covers.openlibrary.org/b/isbn/{isbn}-M.jpg?default=false");
    self.probe_cover_url(&url)
  }

  fn open_library_cover_by_title_author(&self, title: &str, author: Option<&str>) -> Option<String> {
    let attempts = build_cover_search_attempts(title, author);
    let mut best_cover: Option<(f64, i64)> = None;

    for (title_query, author_query) in attempts {
      let mut query = vec![
        ("title".to_string(), title_query.clone()),
        ("limit".to_string(), "12".to_string()),
        ("fields".to_string(), "cover_i,title,author_name".to_string()),
      ];
      if let Some(author_name) = author_query.as_ref() {
        query.push(("author".to_string(), author_name.clone()));
      }

      let response = self
        .client
        .get("https://openlibrary.org/search.json")
        .query(&query)
        .send()
        .ok();
      let Some(response) = response else {
        continue;
      };
      if !response.status().is_success() {
        continue;
      }
      let payload: OpenLibrarySearchResponse = match response.json() {
        Ok(value) => value,
        Err(_) => continue,
      };
      for doc in payload.docs {
        let Some(cover_id) = doc.cover_i else {
          continue;
        };
        let remote_title = doc.title.unwrap_or_default();
        if remote_title.trim().is_empty() {
          continue;
        }

        let title_score = jaro_winkler(&normalize_text(&title_query), &normalize_text(&remote_title));
        let author_score = author_query
          .as_deref()
          .map(|query_author| author_similarity(query_author, doc.author_name.as_deref()))
          .unwrap_or(0.65);
        let score = (title_score * 0.8 + author_score * 0.2).clamp(0.0, 1.0);
        if score < COVER_MATCH_THRESHOLD {
          continue;
        }

        if best_cover
          .as_ref()
          .map(|(best_score, _)| score > *best_score)
          .unwrap_or(true)
        {
          best_cover = Some((score, cover_id));
        }
      }
    }

    let (_, cover_id) = best_cover?;
    normalize_cover_url(Some(format!("https://covers.openlibrary.org/b/id/{cover_id}-M.jpg?default=false")))
  }

  fn enrich_google_books(&self, metadata: &ParsedMetadata) -> anyhow::Result<Option<SourcedEnrichedBook>> {
    if self.google_books_quota_active() {
      return Ok(None);
    }

    let mut query_candidates: Vec<String> = Vec::new();
    if let Some(isbn) = metadata.isbn13.clone().or(metadata.isbn10.clone()) {
      query_candidates.push(format!("isbn:{isbn}"));
    }

    let title_candidates = metadata
      .title
      .as_deref()
      .map(title_query_candidates)
      .unwrap_or_default();
    if !title_candidates.is_empty() {
      let author_candidate = metadata.authors.first().and_then(|value| first_author_token(value));
      for title_candidate in title_candidates.iter().take(ENRICHMENT_TITLE_VARIANT_LIMIT) {
        if let Some(author) = author_candidate.as_ref() {
          query_candidates.push(format!("intitle:{title_candidate} inauthor:{author}"));
        }
        query_candidates.push(format!("intitle:{title_candidate}"));
      }
    }

    if title_candidates.is_empty() {
      let fallback = [
        metadata.title.clone().unwrap_or_default(),
        metadata.authors.first().cloned().unwrap_or_default(),
        metadata
          .isbn13
          .clone()
          .or(metadata.isbn10.clone())
          .unwrap_or_default(),
      ]
      .join(" ")
      .split_whitespace()
      .collect::<Vec<_>>()
      .join(" ");
      if !fallback.trim().is_empty() {
        query_candidates.push(fallback);
      }
    } else {
      for title_candidate in title_candidates.iter().take(ENRICHMENT_TITLE_VARIANT_LIMIT) {
        let fallback = [
          title_candidate.clone(),
          metadata.authors.first().cloned().unwrap_or_default(),
          metadata
            .isbn13
            .clone()
            .or(metadata.isbn10.clone())
            .unwrap_or_default(),
        ]
        .join(" ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
        if !fallback.trim().is_empty() {
          query_candidates.push(fallback);
        }
      }
    }

    let collected = self.collect_google_books_candidates(metadata, query_candidates)?;

    let best = collected.into_iter().next();
    Ok(best.map(|book| SourcedEnrichedBook {
      source: EnrichmentSource::GoogleBooks,
      book,
    }))
  }

  /// Collects multiple Google Books candidates across all query variants,
  /// deduplicating and returning up to `MAX_CANDIDATES_PER_SOURCE` results sorted by confidence descending.
  fn collect_google_books_candidates(
    &self,
    metadata: &ParsedMetadata,
    query_candidates: Vec<String>,
  ) -> anyhow::Result<Vec<EnrichedBook>> {
    const MIN_CONFIDENCE: f64 = 0.3;

    let mut seen_queries: HashSet<String> = HashSet::new();
    let mut all_candidates: Vec<EnrichedBook> = Vec::new();
    let mut seen_keys: HashSet<String> = HashSet::new();

    for query in query_candidates {
      let normalized_query = query.trim().to_string();
      if normalized_query.is_empty() || !seen_queries.insert(normalized_query.clone()) {
        continue;
      }

      let mut params = vec![
        ("q".to_string(), normalized_query),
        ("maxResults".to_string(), "8".to_string()),
        ("printType".to_string(), "books".to_string()),
      ];
      if let Some(api_key) = self.google_books_api_key.read().as_ref().cloned() {
        params.push(("key".to_string(), api_key));
      }

      let response = self
        .client
        .get("https://www.googleapis.com/books/v1/volumes")
        .query(&params)
        .send()
        .context("google books request failed")?;
      let status = response.status();
      if !status.is_success() {
        let body = response.text().unwrap_or_default();
        if self.handle_google_books_error_status(status, &body) {
          return Ok(all_candidates);
        }
        continue;
      }

      let payload: GoogleBooksResponse = match response.json() {
        Ok(value) => value,
        Err(_) => continue,
      };
      let Some(items) = payload.items else {
        continue;
      };

      for item in items {
        let Some(info) = item.volume_info else {
          continue;
        };
        let title = sanitize_metadata_value(info.title.as_deref().unwrap_or("")).unwrap_or_default();
        if title.is_empty() {
          continue;
        }
        let authors = info
          .authors
          .unwrap_or_default()
          .into_iter()
          .filter_map(|value| sanitize_metadata_value(&value))
          .collect::<Vec<_>>();
        let publisher = sanitize_metadata_value(info.publisher.as_deref().unwrap_or(""));
        let publish_date = sanitize_metadata_value(info.published_date.as_deref().unwrap_or(""));
        let description = sanitize_metadata_value(info.description.as_deref().unwrap_or(""));
        let language = sanitize_metadata_value(info.language.as_deref().unwrap_or(""));
        let subtitle = sanitize_metadata_value(info.subtitle.as_deref().unwrap_or(""));
        let cover_url = normalize_cover_url(info.image_links.and_then(|links| {
          links
            .medium
            .or(links.small)
            .or(links.thumbnail)
            .or(links.small_thumbnail)
            .or(links.large)
            .or(links.extra_large)
            .and_then(|value| normalize_google_cover_url(&value))
        }));
        let (isbn10, isbn13, matched_query_isbn) =
          extract_google_isbns(info.industry_identifiers, metadata);

        let mut confidence = confidence_score(metadata, &title, &authors, publish_date.as_deref());
        if matched_query_isbn {
          confidence = confidence.max(0.97);
        }

        if confidence < MIN_CONFIDENCE {
          continue;
        }

        let dedup_key = candidate_dedup_key(&title, &authors, isbn13.as_deref(), isbn10.as_deref());
        if !seen_keys.insert(dedup_key) {
          continue;
        }

        all_candidates.push(EnrichedBook {
          title,
          subtitle,
          authors,
          publisher,
          publish_date,
          isbn10,
          isbn13,
          description,
          language,
          page_count: info.page_count,
          cover_url,
          confidence,
        });
      }
    }

    all_candidates.sort_by(|a, b| b.confidence.partial_cmp(&a.confidence).unwrap_or(std::cmp::Ordering::Equal));
    all_candidates.truncate(MAX_CANDIDATES_PER_SOURCE);
    Ok(all_candidates)
  }

  /// Returns multiple Google Books candidates for the preview UI.
  fn enrich_google_books_multi(&self, metadata: &ParsedMetadata) -> anyhow::Result<Vec<SourcedEnrichedBook>> {
    if self.google_books_quota_active() {
      return Ok(Vec::new());
    }

    let mut query_candidates: Vec<String> = Vec::new();
    if let Some(isbn) = metadata.isbn13.clone().or(metadata.isbn10.clone()) {
      query_candidates.push(format!("isbn:{isbn}"));
    }

    let title_candidates = metadata
      .title
      .as_deref()
      .map(title_query_candidates)
      .unwrap_or_default();
    if !title_candidates.is_empty() {
      let author_candidate = metadata.authors.first().and_then(|value| first_author_token(value));
      for title_candidate in title_candidates.iter().take(ENRICHMENT_TITLE_VARIANT_LIMIT) {
        if let Some(author) = author_candidate.as_ref() {
          query_candidates.push(format!("intitle:{title_candidate} inauthor:{author}"));
        }
        query_candidates.push(format!("intitle:{title_candidate}"));
      }
    }

    if title_candidates.is_empty() {
      let fallback = [
        metadata.title.clone().unwrap_or_default(),
        metadata.authors.first().cloned().unwrap_or_default(),
        metadata.isbn13.clone().or(metadata.isbn10.clone()).unwrap_or_default(),
      ]
      .join(" ")
      .split_whitespace()
      .collect::<Vec<_>>()
      .join(" ");
      if !fallback.trim().is_empty() {
        query_candidates.push(fallback);
      }
    } else {
      for title_candidate in title_candidates.iter().take(ENRICHMENT_TITLE_VARIANT_LIMIT) {
        let fallback = [
          title_candidate.clone(),
          metadata.authors.first().cloned().unwrap_or_default(),
          metadata.isbn13.clone().or(metadata.isbn10.clone()).unwrap_or_default(),
        ]
        .join(" ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
        if !fallback.trim().is_empty() {
          query_candidates.push(fallback);
        }
      }
    }

    let collected = self.collect_google_books_candidates(metadata, query_candidates)?;
    Ok(collected.into_iter().map(|book| SourcedEnrichedBook {
      source: EnrichmentSource::GoogleBooks,
      book,
    }).collect())
  }

  fn google_cover_by_isbn(&self, isbn: &str) -> Option<String> {
    self.google_cover_by_query(&format!("isbn:{isbn}"))
  }

  fn google_cover_by_title_author(&self, title: &str, author: Option<&str>) -> Option<String> {
    let query = if let Some(author_name) = author.and_then(first_author_token) {
      format!("{title} {author_name}")
    } else {
      title.to_string()
    };
    self.google_cover_by_query(&query)
  }

  fn google_cover_by_query(&self, query: &str) -> Option<String> {
    if self.google_books_quota_active() {
      return None;
    }
    if query.trim().is_empty() {
      return None;
    }
    let mut params = vec![
      ("q".to_string(), query.to_string()),
      ("maxResults".to_string(), "1".to_string()),
      ("printType".to_string(), "books".to_string()),
    ];
    if let Some(api_key) = self.google_books_api_key.read().as_ref().cloned() {
      params.push(("key".to_string(), api_key));
    }
    let response = self
      .client
      .get("https://www.googleapis.com/books/v1/volumes")
      .query(&params)
      .send()
      .ok()?;
    let status = response.status();
    if !status.is_success() {
      let body = response.text().unwrap_or_default();
      let _ = self.handle_google_books_error_status(status, &body);
      return None;
    }
    let payload: GoogleBooksResponse = response.json().ok()?;
    let item = payload.items.and_then(|items| items.into_iter().next())?;
    let links = item.volume_info.and_then(|info| info.image_links)?;
    let image_url = links
      .medium
      .or(links.small)
      .or(links.thumbnail)
      .or(links.small_thumbnail)
      .or(links.large)
      .or(links.extra_large)?;
    let normalized = normalize_google_cover_url(&image_url)?;
    self.probe_cover_url(&normalized)
  }

  fn probe_cover_url(&self, url: &str) -> Option<String> {
    let normalized = normalize_cover_url(Some(url.to_string()))?;
    let response = self.client.get(&normalized).send().ok()?;
    if !response.status().is_success() {
      return None;
    }
    let content_type = response
      .headers()
      .get(reqwest::header::CONTENT_TYPE)
      .and_then(|value| value.to_str().ok())
      .unwrap_or_default()
      .to_ascii_lowercase();
    if !content_type.is_empty() && !content_type.starts_with("image/") {
      return None;
    }
    if is_google_books_cover_url(&normalized) {
      let bytes = response.bytes().ok()?;
      if is_known_google_placeholder_image(bytes.as_ref()) {
        return None;
      }
    }
    Some(normalized)
  }

  fn google_books_quota_until(&self) -> Option<SystemTime> {
    let mut state = self.google_books_quota.write();
    if let Some(until) = state.limited_until {
      if SystemTime::now() < until {
        return Some(until);
      }
      state.limited_until = None;
    }
    None
  }

  fn google_books_quota_active(&self) -> bool {
    self.google_books_quota_until().is_some()
  }

  fn mark_google_books_quota_limited(&self) {
    let now_pt = Utc::now().with_timezone(&Los_Angeles);
    let next_date = now_pt.date_naive().succ_opt().unwrap_or(now_pt.date_naive());
    let next_midnight_local = next_date.and_time(NaiveTime::MIN);
    let until_pt = match Los_Angeles.from_local_datetime(&next_midnight_local) {
      LocalResult::Single(value) => value,
      LocalResult::Ambiguous(first, _) => first,
      LocalResult::None => return,
    };
    self
      .google_books_quota
      .write()
      .limited_until = Some(until_pt.with_timezone(&Utc).into());
  }

  fn handle_google_books_error_status(&self, status: StatusCode, body: &str) -> bool {
    if is_google_books_quota_exceeded(status, body) {
      self.mark_google_books_quota_limited();
      return true;
    }
    false
  }

  pub fn search_cover_candidates(
    &self,
    title: Option<&str>,
    authors: &[String],
    isbn13: Option<&str>,
    isbn10: Option<&str>,
  ) -> Vec<crate::library::types::CoverCandidate> {
    use crate::library::types::CoverCandidate;
    let mut candidates: Vec<CoverCandidate> = Vec::new();
    let mut seen_urls: HashSet<String> = HashSet::new();

    let push_candidate = |url: String, source: &str, seen: &mut HashSet<String>, out: &mut Vec<CoverCandidate>| {
      if seen.insert(url.clone()) {
        out.push(CoverCandidate { url, source: source.to_string() });
      }
    };

    // Collect ISBN candidates.
    let mut isbn_candidates: Vec<&str> = Vec::new();
    if let Some(value) = isbn13.filter(|v| !v.trim().is_empty()) {
      isbn_candidates.push(value);
    }
    if let Some(value) = isbn10.filter(|v| !v.trim().is_empty()) {
      if !isbn_candidates.contains(&value) {
        isbn_candidates.push(value);
      }
    }

    // 1. Open Library ISBN covers.
    for isbn in &isbn_candidates {
      if let Some(url) = self.open_library_cover_by_isbn(isbn) {
        push_candidate(url, "open_library", &mut seen_urls, &mut candidates);
      }
    }

    // 2. Open Library search by title/author — collect ALL covers above threshold.
    let title_str = title.map(str::trim).filter(|v| !v.is_empty());
    if let Some(title_val) = title_str {
      let first_author = authors.first().map(String::as_str);
      let attempts = build_cover_search_attempts(title_val, first_author);
      for (title_query, author_query) in attempts {
        let mut query = vec![
          ("title".to_string(), title_query.clone()),
          ("limit".to_string(), "12".to_string()),
          ("fields".to_string(), "cover_i,title,author_name".to_string()),
        ];
        if let Some(author_name) = author_query.as_ref() {
          query.push(("author".to_string(), author_name.clone()));
        }
        let response = self.client.get("https://openlibrary.org/search.json").query(&query).send().ok();
        let Some(response) = response else { continue };
        if !response.status().is_success() { continue }
        let payload: OpenLibrarySearchResponse = match response.json() {
          Ok(value) => value,
          Err(_) => continue,
        };
        for doc in payload.docs {
          let Some(cover_id) = doc.cover_i else { continue };
          let remote_title = doc.title.unwrap_or_default();
          if remote_title.trim().is_empty() { continue }
          let title_score = jaro_winkler(&normalize_text(&title_query), &normalize_text(&remote_title));
          let author_score = author_query
            .as_deref()
            .map(|qa| author_similarity(qa, doc.author_name.as_deref()))
            .unwrap_or(0.65);
          let score = (title_score * 0.8 + author_score * 0.2).clamp(0.0, 1.0);
          if score < COVER_MATCH_THRESHOLD { continue }
          if let Some(url) = normalize_cover_url(Some(format!("https://covers.openlibrary.org/b/id/{cover_id}-M.jpg?default=false"))) {
            push_candidate(url, "open_library", &mut seen_urls, &mut candidates);
          }
        }
      }
    }

    // 3. Google Books ISBN covers.
    for isbn in &isbn_candidates {
      if let Some(url) = self.google_cover_by_isbn(isbn) {
        push_candidate(url, "google_books", &mut seen_urls, &mut candidates);
      }
    }

    // 4. Google Books search by title/author — collect ALL covers from results.
    if let Some(title_val) = title_str {
      if !self.google_books_quota_active() {
        let first_author = authors.first().and_then(|v| first_author_token(v));
        let query_str = if let Some(author) = first_author.as_ref() {
          format!("intitle:{title_val} inauthor:{author}")
        } else {
          format!("intitle:{title_val}")
        };
        let mut params = vec![
          ("q".to_string(), query_str),
          ("maxResults".to_string(), "10".to_string()),
          ("printType".to_string(), "books".to_string()),
        ];
        if let Some(api_key) = self.google_books_api_key.read().as_ref().cloned() {
          params.push(("key".to_string(), api_key));
        }
        if let Ok(response) = self.client.get("https://www.googleapis.com/books/v1/volumes").query(&params).send() {
          let status = response.status();
          if status.is_success() {
            if let Ok(payload) = response.json::<GoogleBooksResponse>() {
              for item in payload.items.unwrap_or_default() {
                let links = item.volume_info.and_then(|info| info.image_links);
                if let Some(links) = links {
                  let image_url = links.medium.or(links.small).or(links.thumbnail).or(links.small_thumbnail).or(links.large).or(links.extra_large);
                  if let Some(raw_url) = image_url {
                    if let Some(normalized) = normalize_google_cover_url(&raw_url) {
                      if let Some(probed) = self.probe_cover_url(&normalized) {
                        push_candidate(probed, "google_books", &mut seen_urls, &mut candidates);
                      }
                    }
                  }
                }
              }
            }
          } else {
            let body = response.text().unwrap_or_default();
            let _ = self.handle_google_books_error_status(status, &body);
          }
        }
      }
    }

    candidates
  }
}

fn is_google_books_quota_exceeded(status: StatusCode, body: &str) -> bool {
  if status == StatusCode::TOO_MANY_REQUESTS {
    return true;
  }
  if status != StatusCode::FORBIDDEN && status != StatusCode::BAD_REQUEST {
    return false;
  }
  let text = body.to_ascii_lowercase();
  text.contains("quota")
    || text.contains("daily limit exceeded")
    || text.contains("dailylimitexceeded")
    || text.contains("userratelimitexceeded")
    || text.contains("ratelimitexceeded")
}

#[derive(Debug, Deserialize)]
struct OpenLibrarySearchResponse {
  docs: Vec<OpenLibraryDoc>,
}

#[derive(Debug, Deserialize)]
struct OpenLibraryDoc {
  title: Option<String>,
  author_name: Option<Vec<String>>,
  publisher: Option<Vec<String>>,
  first_publish_year: Option<i32>,
  isbn: Option<Vec<String>>,
  language: Option<Vec<String>>,
  first_sentence: Option<OpenLibraryTextValue>,
  cover_i: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct OpenLibraryBookData {
  title: String,
  subtitle: Option<String>,
  authors: Option<Vec<OpenLibraryNamedValue>>,
  publishers: Option<Vec<OpenLibraryNamedValue>>,
  publish_date: Option<String>,
  number_of_pages: Option<i64>,
  description: Option<OpenLibraryTextValue>,
  notes: Option<OpenLibraryTextValue>,
  identifiers: Option<OpenLibraryBookIdentifiers>,
  cover: Option<OpenLibraryCover>,
}

#[derive(Debug, Deserialize, Clone)]
struct OpenLibraryNamedValue {
  name: String,
}

#[derive(Debug, Deserialize)]
struct OpenLibraryBookIdentifiers {
  isbn_10: Option<Vec<String>>,
  isbn_13: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct OpenLibraryCover {
  small: Option<String>,
  medium: Option<String>,
  large: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(untagged)]
enum OpenLibraryTextValue {
  Plain(String),
  WithValue(OpenLibraryValueObject),
}

#[derive(Debug, Deserialize, Clone)]
struct OpenLibraryValueObject {
  value: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GoogleBooksResponse {
  items: Option<Vec<GoogleBooksItem>>,
}

#[derive(Debug, Deserialize)]
struct GoogleBooksItem {
  #[serde(rename = "volumeInfo")]
  volume_info: Option<GoogleBooksVolumeInfo>,
}

#[derive(Debug, Deserialize)]
struct GoogleBooksVolumeInfo {
  title: Option<String>,
  subtitle: Option<String>,
  authors: Option<Vec<String>>,
  publisher: Option<String>,
  #[serde(rename = "publishedDate")]
  published_date: Option<String>,
  description: Option<String>,
  language: Option<String>,
  #[serde(rename = "pageCount")]
  page_count: Option<i64>,
  #[serde(rename = "industryIdentifiers")]
  industry_identifiers: Option<Vec<GoogleBooksIndustryIdentifier>>,
  #[serde(rename = "imageLinks")]
  image_links: Option<GoogleBooksImageLinks>,
}

#[derive(Debug, Deserialize)]
struct GoogleBooksIndustryIdentifier {
  #[serde(rename = "type")]
  identifier_type: Option<String>,
  identifier: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GoogleBooksImageLinks {
  #[serde(rename = "smallThumbnail")]
  small_thumbnail: Option<String>,
  thumbnail: Option<String>,
  small: Option<String>,
  medium: Option<String>,
  large: Option<String>,
  #[serde(rename = "extraLarge")]
  extra_large: Option<String>,
}

pub fn parse_metadata(path: &Path, ext: &str) -> anyhow::Result<ParsedMetadata> {
  match ext {
    "pdf" => parse_pdf_metadata(path),
    "epub" => parse_epub_metadata(path),
    _ => Ok(ParsedMetadata::default()),
  }
}

pub fn parse_pdf_metadata(path: &Path) -> anyhow::Result<ParsedMetadata> {
  let mut metadata = ParsedMetadata::default();
  let document = lopdf::Document::load(path)
    .with_context(|| format!("failed to parse pdf metadata for {}", path.display()))?;

  if let Ok(info_ref) = document.trailer.get(b"Info") {
    if let Ok(info_obj) = document.get_object(info_ref.as_reference()?) {
      if let Ok(dictionary) = info_obj.as_dict() {
        if let Ok(title) = dictionary.get(b"Title") {
          metadata.title = decode_lopdf_string(title);
        }
        if let Ok(author) = dictionary.get(b"Author") {
          if let Some(author_name) = decode_lopdf_string(author) {
            metadata.authors = parse_pdf_authors(&author_name);
          }
        }
        if let Ok(subject) = dictionary.get(b"Subject") {
          metadata.description = decode_lopdf_string(subject);
        }
        if let Ok(keywords) = dictionary.get(b"Keywords") {
          if let Some(value) = decode_lopdf_string(keywords) {
            assign_isbn(&mut metadata, extract_isbn(&value));
          }
        }
      }
    }
  }

  if metadata.isbn10.is_none() && metadata.isbn13.is_none() {
    if let Some(file_name) = path.file_name().and_then(OsStr::to_str) {
      assign_isbn(&mut metadata, extract_isbn(file_name));
    }
  }

  Ok(metadata)
}

pub fn parse_epub_metadata(path: &Path) -> anyhow::Result<ParsedMetadata> {
  let file = File::open(path).with_context(|| format!("failed to open epub {}", path.display()))?;
  let mut zip = ZipArchive::new(file).context("failed to read epub zip")?;

  let mut container_xml = String::new();
  zip
    .by_name("META-INF/container.xml")
    .context("missing epub container.xml")?
    .read_to_string(&mut container_xml)?;

  let container_doc = XmlDocument::parse(&container_xml).context("invalid container.xml")?;
  let rootfile_path = container_doc
    .descendants()
    .find(|node| node.tag_name().name() == "rootfile")
    .and_then(|node| node.attribute("full-path"))
    .ok_or_else(|| anyhow!("epub rootfile path not found"))?
    .to_string();

  let mut opf_xml = String::new();
  zip
    .by_name(&rootfile_path)
    .with_context(|| format!("failed to open opf {rootfile_path}"))?
    .read_to_string(&mut opf_xml)?;

  let opf_doc = XmlDocument::parse(&opf_xml).context("invalid opf document")?;
  let mut metadata = ParsedMetadata::default();

  metadata.title = first_text_by_suffix(&opf_doc, "title");
  metadata.publisher = first_text_by_suffix(&opf_doc, "publisher");
  metadata.publish_date = first_text_by_suffix(&opf_doc, "date");
  metadata.description = first_text_by_suffix(&opf_doc, "description");
  metadata.language = first_text_by_suffix(&opf_doc, "language");
  metadata.authors = opf_doc
    .descendants()
    .filter(|node| tag_name_ends_with(node, "creator"))
    .filter_map(|node| node.text())
    .map(str::trim)
    .filter_map(sanitize_metadata_value)
    .collect();

  for candidate in opf_doc
    .descendants()
    .filter(|node| tag_name_ends_with(node, "identifier"))
    .filter_map(|node| node.text())
    .map(str::trim)
    .filter(|value| !value.is_empty())
  {
    let isbn = extract_isbn(candidate);
    if isbn.is_some() {
      assign_isbn(&mut metadata, isbn);
      break;
    }
  }

  if metadata.isbn10.is_none() && metadata.isbn13.is_none() {
    if let Some(file_name) = path.file_name().and_then(OsStr::to_str) {
      assign_isbn(&mut metadata, extract_isbn(file_name));
    }
  }

  Ok(metadata)
}

pub fn infer_metadata_from_filename(path: &Path) -> ParsedMetadata {
  let mut metadata = ParsedMetadata::default();
  let Some(file_name) = path.file_name().and_then(OsStr::to_str) else {
    return metadata;
  };
  assign_isbn(&mut metadata, extract_isbn(file_name));

  let Some(stem) = path.file_stem().and_then(OsStr::to_str) else {
    return metadata;
  };

  if let Some((title_part, author_part)) = split_filename_title_author(stem) {
    metadata.title = sanitize_filename_guess_title(&title_part);
    if let Some(author_name) = sanitize_filename_guess_author(&author_part) {
      metadata.authors = vec![author_name];
    }
  }

  if metadata.title.is_none() {
    let mut cleaned = stem.replace(['_', '-', '.', '[', ']', '(', ')', '+'], " ");
    cleaned = FILENAME_TIMESTAMP_PATTERN.replace_all(&cleaned, " ").to_string();
    cleaned = FILENAME_NOISE_PATTERN.replace_all(&cleaned, " ").to_string();
    cleaned = FILENAME_TRAILING_DIGIT_TOKEN_PATTERN
      .replace_all(&cleaned, "$1 $2")
      .to_string();
    cleaned = cleaned
      .split_whitespace()
      .collect::<Vec<_>>()
      .join(" ");

    let lower = cleaned.to_lowercase();
    if let Some(index) = lower.find(" by ") {
      let title_part = cleaned[..index].trim();
      let author_part = cleaned[index + 4..].trim();
      metadata.title = sanitize_filename_guess_title(title_part);
      if let Some(author_name) = sanitize_filename_guess_author(author_part) {
        metadata.authors = vec![author_name];
      }
    } else {
      metadata.title = sanitize_filename_guess_title(&cleaned);
    }
  }

  metadata
}

fn split_filename_title_author(raw_stem: &str) -> Option<(String, String)> {
  let normalized = raw_stem.replace(['_', '[', ']', '(', ')'], " ");
  let (left_raw, right_raw) = normalized.rsplit_once(" - ")?;
  let left = sanitize_metadata_value(left_raw)?;
  let right = sanitize_metadata_value(right_raw)?;
  let left_looks_author = looks_like_author_segment(&left);
  let right_looks_author = looks_like_author_segment(&right);
  if left_looks_author && !right_looks_author && looks_like_title_segment(&right) {
    return Some((right, left));
  }
  Some((left, right))
}

fn looks_like_author_segment(input: &str) -> bool {
  let normalized = normalize_text(input);
  if normalized.is_empty() {
    return false;
  }
  if normalized.chars().any(|ch| ch.is_ascii_digit()) {
    return false;
  }
  let token_count = normalized.split_whitespace().count();
  if token_count == 0 || token_count > 6 {
    return false;
  }
  if input.contains(',') {
    return true;
  }
  token_count <= 4
}

fn looks_like_title_segment(input: &str) -> bool {
  let normalized = normalize_text(input);
  if normalized.is_empty() {
    return false;
  }
  normalized.split_whitespace().count() >= 3
}

fn sanitize_filename_guess_title(input: &str) -> Option<String> {
  let mut value = sanitize_metadata_value(input)?;
  value = FILENAME_TIMESTAMP_PATTERN.replace_all(&value, " ").to_string();
  value = FILENAME_NOISE_PATTERN.replace_all(&value, " ").to_string();
  value = FILENAME_TRAILING_DIGIT_TOKEN_PATTERN
    .replace_all(&value, "$1 $2")
    .to_string();
  value = value.replace('+', " ");
  value = value
    .split_whitespace()
    .collect::<Vec<_>>()
    .join(" ");
  if value.split_whitespace().count() >= 3 {
    value = FILENAME_TRAILING_COUNTER_PATTERN.replace(&value, "").to_string();
  }
  let value = value
    .trim_matches(|ch: char| matches!(ch, ',' | ';' | ':' | '-' | '_' | '.'))
    .trim()
    .to_string();
  sanitize_metadata_value(&value)
}

fn sanitize_filename_guess_author(input: &str) -> Option<String> {
  let mut value = sanitize_metadata_value(input)?;
  value = FILENAME_TIMESTAMP_PATTERN.replace_all(&value, " ").to_string();
  value = FILENAME_NOISE_PATTERN.replace_all(&value, " ").to_string();
  value = AUTHOR_TRAILING_LIFESPAN_PATTERN.replace(&value, "").to_string();
  let value = value
    .trim_matches(|ch: char| matches!(ch, ',' | ';' | ':' | '-' | '_' | '.'))
    .trim()
    .to_string();
  sanitize_metadata_value(&value)
}

pub fn compute_sha256(path: &Path) -> anyhow::Result<String> {
  let mut file = File::open(path)?;
  let mut hasher = Sha256::new();
  let mut buffer = vec![0u8; 64 * 1024];

  loop {
    let read = file.read(&mut buffer)?;
    if read == 0 {
      break;
    }
    hasher.update(&buffer[..read]);
  }

  Ok(hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect())
}

pub fn extract_isbn(input: &str) -> Option<String> {
  ISBN_PATTERN
    .find(input)
    .and_then(|matched| normalize_valid_isbn(matched.as_str()))
}

pub fn normalize_isbn(input: &str) -> String {
  input
    .chars()
    .filter(|ch| ch.is_ascii_digit() || *ch == 'X' || *ch == 'x')
    .map(|ch| ch.to_ascii_uppercase())
    .collect()
}

pub fn normalize_valid_isbn(input: &str) -> Option<String> {
  let normalized = normalize_isbn(input);
  if is_valid_isbn10(&normalized) || is_valid_isbn13(&normalized) {
    Some(normalized)
  } else {
    None
  }
}

fn is_valid_isbn10(isbn: &str) -> bool {
  if isbn.len() != 10 {
    return false;
  }
  let mut total: u32 = 0;
  for (idx, ch) in isbn.chars().enumerate() {
    let position = idx as u32 + 1;
    let value = if idx == 9 && ch == 'X' {
      10
    } else if ch.is_ascii_digit() {
      ch.to_digit(10).unwrap_or(0)
    } else {
      return false;
    };
    total += position * value;
  }
  total % 11 == 0
}

fn is_valid_isbn13(isbn: &str) -> bool {
  if isbn.len() != 13 || !isbn.chars().all(|ch| ch.is_ascii_digit()) {
    return false;
  }
  let mut sum: u32 = 0;
  for (idx, ch) in isbn.chars().take(12).enumerate() {
    let digit = ch.to_digit(10).unwrap_or(0);
    sum += if idx % 2 == 0 { digit } else { digit * 3 };
  }
  let expected = (10 - (sum % 10)) % 10;
  let actual = isbn.chars().nth(12).and_then(|ch| ch.to_digit(10)).unwrap_or(11);
  expected == actual
}

pub fn normalize_text(input: &str) -> String {
  input
    .to_lowercase()
    .chars()
    .map(|ch| if ch.is_alphanumeric() || ch.is_whitespace() { ch } else { ' ' })
    .collect::<String>()
    .split_whitespace()
    .collect::<Vec<_>>()
    .join(" ")
}

/// Builds a deduplication key from normalized title + authors + ISBN for candidate deduplication.
fn candidate_dedup_key(title: &str, authors: &[String], isbn13: Option<&str>, isbn10: Option<&str>) -> String {
  let norm_title = normalize_text(title);
  let norm_authors = authors.iter().map(|a| normalize_text(a)).collect::<Vec<_>>().join("|");
  let isbn = isbn13.or(isbn10).unwrap_or_default();
  format!("{norm_title}::{norm_authors}::{isbn}")
}

pub fn confidence_score(
  metadata: &ParsedMetadata,
  remote_title: &str,
  remote_authors: &[String],
  remote_year: Option<&str>,
) -> f64 {
  let title_score = metadata
    .title
    .as_ref()
    .map(|title| jaro_winkler(&normalize_text(title), &normalize_text(remote_title)))
    .unwrap_or(0.4);

  let local_authors: Vec<String> = metadata.authors.iter().map(|value| normalize_text(value)).collect();
  let remote_authors: Vec<String> = remote_authors.iter().map(|value| normalize_text(value)).collect();
  let author_score = similarity_between_author_lists(&local_authors, &remote_authors);

  let mut year_score = 0.5;
  if let (Some(local_date), Some(remote_date)) = (metadata.publish_date.as_deref(), remote_year) {
    let local_year = local_date.get(0..4).and_then(|value| value.parse::<i32>().ok());
    let remote_year = remote_date.get(0..4).and_then(|value| value.parse::<i32>().ok());
    if let (Some(local_year), Some(remote_year)) = (local_year, remote_year) {
      let delta = (local_year - remote_year).abs();
      year_score = if delta == 0 {
        1.0
      } else if delta == 1 {
        0.8
      } else if delta <= 3 {
        0.6
      } else {
        0.3
      };
    }
  }

  let mut weighted_sum = 0.0;
  let mut total_weight = 0.0;

  if metadata.title.is_some() {
    weighted_sum += title_score * 0.7;
    total_weight += 0.7;
  } else if !remote_title.trim().is_empty() {
    weighted_sum += 0.35;
    total_weight += 0.7;
  }

  if !metadata.authors.is_empty() {
    weighted_sum += author_score * 0.2;
    total_weight += 0.2;
  }

  if metadata.publish_date.is_some() {
    weighted_sum += year_score * 0.1;
    total_weight += 0.1;
  }

  if total_weight <= f64::EPSILON {
    0.0
  } else {
    (weighted_sum / total_weight).clamp(0.0, 1.0)
  }
}

fn similarity_between_author_lists(left: &[String], right: &[String]) -> f64 {
  if left.is_empty() || right.is_empty() {
    return 0.5;
  }
  let mut best = 0.0;
  for left_author in left {
    for right_author in right {
      let score = jaro_winkler(left_author, right_author);
      if score > best {
        best = score;
      }
    }
  }
  best
}

fn metadata_candidate_from_enriched(id: &str, source: &str, book: &EnrichedBook) -> MetadataCandidate {
  MetadataCandidate {
    id: id.to_string(),
    source: source.to_string(),
    title: sanitize_metadata_value(&book.title),
    subtitle: book.subtitle.clone(),
    authors: if book.authors.is_empty() {
      None
    } else {
      Some(book.authors.clone())
    },
    publisher: book.publisher.clone(),
    publish_date: book.publish_date.clone(),
    isbn10: book.isbn10.clone(),
    isbn13: book.isbn13.clone(),
    description: book.description.clone(),
    language: book.language.clone(),
    page_count: book.page_count,
    series: None,
    series_index: None,
    cover_url: book.cover_url.clone(),
    confidence: Some(book.confidence),
  }
}

fn choose_primary_candidate(
  open_candidate: Option<SourcedEnrichedBook>,
  google_candidate: Option<SourcedEnrichedBook>,
) -> Option<(SourcedEnrichedBook, Option<SourcedEnrichedBook>)> {
  match (open_candidate, google_candidate) {
    (None, None) => None,
    (Some(primary), None) => Some((primary, None)),
    (None, Some(primary)) => Some((primary, None)),
    (Some(open), Some(google)) => {
      let open_confidence = open.book.confidence;
      let google_confidence = google.book.confidence;
      let primary_is_open = if (open_confidence - google_confidence).abs() >= 0.02 {
        open_confidence > google_confidence
      } else {
        completeness_score(&open.book) >= completeness_score(&google.book)
      };
      if primary_is_open {
        Some((open, Some(google)))
      } else {
        Some((google, Some(open)))
      }
    }
  }
}

fn merge_enriched_books(primary: EnrichedBook, fallback: Option<EnrichedBook>) -> EnrichedBook {
  let Some(secondary) = fallback else {
    return primary;
  };

  let description = choose_better_description(primary.description.clone(), secondary.description.clone());
  EnrichedBook {
    title: choose_non_empty(primary.title, secondary.title),
    subtitle: primary.subtitle.or(secondary.subtitle),
    authors: if primary.authors.is_empty() {
      secondary.authors
    } else {
      primary.authors
    },
    publisher: primary.publisher.or(secondary.publisher),
    publish_date: primary.publish_date.or(secondary.publish_date),
    isbn10: primary.isbn10.or(secondary.isbn10),
    isbn13: primary.isbn13.or(secondary.isbn13),
    description,
    language: primary.language.or(secondary.language),
    page_count: primary.page_count.or(secondary.page_count),
    cover_url: primary.cover_url.or(secondary.cover_url),
    confidence: primary.confidence.max(secondary.confidence),
  }
}

fn completeness_score(book: &EnrichedBook) -> usize {
  let mut score = 0usize;
  if !book.title.trim().is_empty() {
    score += 4;
  }
  if !book.authors.is_empty() {
    score += 2;
  }
  if book.publisher.as_ref().map(|value| !value.trim().is_empty()).unwrap_or(false) {
    score += 1;
  }
  if book.publish_date.as_ref().map(|value| !value.trim().is_empty()).unwrap_or(false) {
    score += 1;
  }
  if book.isbn10.as_ref().map(|value| !value.trim().is_empty()).unwrap_or(false) {
    score += 2;
  }
  if book.isbn13.as_ref().map(|value| !value.trim().is_empty()).unwrap_or(false) {
    score += 2;
  }
  if book.description.as_ref().map(|value| !value.trim().is_empty()).unwrap_or(false) {
    score += 2;
  }
  if book.language.as_ref().map(|value| !value.trim().is_empty()).unwrap_or(false) {
    score += 1;
  }
  if book.page_count.is_some() {
    score += 1;
  }
  if book.subtitle.as_ref().map(|value| !value.trim().is_empty()).unwrap_or(false) {
    score += 1;
  }
  if book.cover_url.as_ref().map(|value| !value.trim().is_empty()).unwrap_or(false) {
    score += 1;
  }
  score
}

fn choose_non_empty(primary: String, fallback: String) -> String {
  if primary.trim().is_empty() && !fallback.trim().is_empty() {
    fallback
  } else {
    primary
  }
}

fn choose_better_description(primary: Option<String>, fallback: Option<String>) -> Option<String> {
  match (primary, fallback) {
    (None, other) => other,
    (Some(value), None) => Some(value),
    (Some(primary), Some(fallback)) => {
      let primary_trimmed = primary.trim();
      let fallback_trimmed = fallback.trim();
      if primary_trimmed.is_empty() {
        sanitize_metadata_value(fallback_trimmed)
      } else if fallback_trimmed.len() > primary_trimmed.len() + 40 {
        Some(fallback_trimmed.to_string())
      } else {
        Some(primary_trimmed.to_string())
      }
    }
  }
}

fn open_library_text_value_to_string(value: &OpenLibraryTextValue) -> Option<String> {
  match value {
    OpenLibraryTextValue::Plain(text) => sanitize_metadata_value(text),
    OpenLibraryTextValue::WithValue(object) => object
      .value
      .as_deref()
      .and_then(sanitize_metadata_value),
  }
}

fn extract_google_isbns(
  identifiers: Option<Vec<GoogleBooksIndustryIdentifier>>,
  metadata: &ParsedMetadata,
) -> (Option<String>, Option<String>, bool) {
  let mut isbn10: Option<String> = None;
  let mut isbn13: Option<String> = None;
  let mut matched_query_isbn = false;

  for identifier in identifiers.unwrap_or_default() {
    let Some(raw) = identifier.identifier else {
      continue;
    };
    let Some(normalized) = normalize_valid_isbn(&raw) else {
      continue;
    };

    let id_type = identifier.identifier_type.unwrap_or_default().to_uppercase();
    if id_type == "ISBN_10" && isbn10.is_none() && normalized.len() == 10 {
      isbn10 = Some(normalized.clone());
    } else if id_type == "ISBN_13" && isbn13.is_none() && normalized.len() == 13 {
      isbn13 = Some(normalized.clone());
    } else if normalized.len() == 10 && isbn10.is_none() {
      isbn10 = Some(normalized.clone());
    } else if normalized.len() == 13 && isbn13.is_none() {
      isbn13 = Some(normalized.clone());
    }

    if metadata
      .isbn13
      .as_deref()
      .map(|isbn| isbn == normalized)
      .unwrap_or(false)
      || metadata
        .isbn10
        .as_deref()
        .map(|isbn| isbn == normalized)
        .unwrap_or(false)
    {
      matched_query_isbn = true;
    }
  }

  (isbn10, isbn13, matched_query_isbn)
}

fn decode_lopdf_string(value: &lopdf::Object) -> Option<String> {
  match value {
    lopdf::Object::String(bytes, _) => sanitize_metadata_value(&decode_pdf_bytes(bytes)),
    lopdf::Object::Name(bytes) => sanitize_metadata_value(&String::from_utf8_lossy(bytes)),
    _ => None,
  }
}

fn assign_isbn(metadata: &mut ParsedMetadata, isbn: Option<String>) {
  if let Some(isbn_value) = isbn {
    if isbn_value.len() == 10 {
      metadata.isbn10 = Some(isbn_value);
    } else if isbn_value.len() == 13 {
      metadata.isbn13 = Some(isbn_value);
    }
  }
}

fn parse_pdf_authors(raw: &str) -> Vec<String> {
  let normalized = raw
    .replace('\n', " ")
    .replace('\r', " ")
    .split_whitespace()
    .collect::<Vec<_>>()
    .join(" ");
  let cleaned = normalized.trim();
  if cleaned.is_empty() {
    return Vec::new();
  }

  if cleaned.contains(';') {
    return cleaned
      .split(';')
      .map(str::trim)
      .filter_map(sanitize_metadata_value)
      .collect();
  }

  let comma_parts: Vec<&str> = cleaned
    .split(',')
    .map(str::trim)
    .filter(|value| !value.is_empty())
    .collect();
  if comma_parts.is_empty() {
    return Vec::new();
  }

  if comma_parts.len() == 2 {
    return sanitize_metadata_value(&format!("{}, {}", comma_parts[0], comma_parts[1]))
      .map(|value| vec![value])
      .unwrap_or_default();
  }

  if comma_parts.len() >= 4 && comma_parts.len() % 2 == 0 {
    let mut out = Vec::new();
    for chunk in comma_parts.chunks(2) {
      if let Some(author) = sanitize_metadata_value(&format!("{}, {}", chunk[0], chunk[1])) {
        out.push(author);
      }
    }
    if !out.is_empty() {
      return out;
    }
  }

  sanitize_metadata_value(cleaned)
    .map(|value| vec![value])
    .unwrap_or_default()
}

fn tag_name_ends_with(node: &roxmltree::Node<'_, '_>, suffix: &str) -> bool {
  let name = node.tag_name().name();
  name.eq_ignore_ascii_case(suffix) || name.ends_with(&format!(":{suffix}"))
}

fn first_text_by_suffix(doc: &XmlDocument<'_>, suffix: &str) -> Option<String> {
  doc
    .descendants()
    .find(|node| tag_name_ends_with(node, suffix))
    .and_then(|node| node.text())
    .and_then(sanitize_metadata_value)
}

fn decode_pdf_bytes(bytes: &[u8]) -> String {
  if bytes.len() >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF {
    let units: Vec<u16> = bytes[2..]
      .chunks_exact(2)
      .map(|chunk| u16::from_be_bytes([chunk[0], chunk[1]]))
      .collect();
    return String::from_utf16_lossy(&units);
  }

  if bytes.len() >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE {
    let units: Vec<u16> = bytes[2..]
      .chunks_exact(2)
      .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
      .collect();
    return String::from_utf16_lossy(&units);
  }

  String::from_utf8_lossy(bytes).to_string()
}

fn sanitize_metadata_value(input: &str) -> Option<String> {
  let normalized = input
    .chars()
    .map(|ch| {
      if ch.is_control() && ch != '\n' && ch != '\t' {
        ' '
      } else {
        ch
      }
    })
    .collect::<String>()
    .split_whitespace()
    .collect::<Vec<_>>()
    .join(" ");

  let trimmed = normalized.trim();
  if trimmed.is_empty() {
    return None;
  }

  let replacement_count = trimmed.matches('\u{FFFD}').count();
  if replacement_count > 0 && replacement_count * 4 >= trimmed.chars().count() {
    return None;
  }

  Some(trimmed.to_string())
}

pub fn env_google_books_api_key() -> Option<String> {
  std::env::var("GOOGLE_BOOKS_API_KEY")
    .ok()
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty())
}

fn normalize_cover_url(url: Option<String>) -> Option<String> {
  let raw = url?.trim().to_string();
  if raw.is_empty() {
    return None;
  }

  let mut normalized = if raw.starts_with("//") {
    format!("https:{raw}")
  } else if raw.starts_with("http://") {
    raw.replacen("http://", "https://", 1)
  } else {
    raw
  };

  if normalized.contains("covers.openlibrary.org")
    && !normalized.contains("default=")
    && !normalized.ends_with(".svg")
  {
    normalized.push_str(if normalized.contains('?') {
      "&default=false"
    } else {
      "?default=false"
    });
  }

  Some(normalized)
}

fn normalize_google_cover_url(url: &str) -> Option<String> {
  let mut normalized = url.trim().to_string();
  if normalized.is_empty() {
    return None;
  }
  normalized = normalized.replace("zoom=1", "zoom=2");
  normalized = normalized
    .replace("&edge=curl", "")
    .replace("?edge=curl&", "?")
    .replace("?edge=curl", "");
  normalize_cover_url(Some(normalized))
}

fn is_google_books_cover_url(url: &str) -> bool {
  let Ok(parsed_url) = url::Url::parse(url.trim()) else {
    return false;
  };
  let Some(host) = parsed_url.host_str() else {
    return false;
  };

  let host = host.to_ascii_lowercase();
  let is_google_books_host = host == "books.google.com"
    || host.ends_with(".books.google.com")
    || host == "books.googleapis.com"
    || host.ends_with(".books.googleapis.com");

  is_google_books_host && parsed_url.path().starts_with("/books/content")
}

fn is_known_google_placeholder_image(bytes: &[u8]) -> bool {
  if bytes.is_empty() {
    return false;
  }
  let mut hasher = Sha256::new();
  hasher.update(bytes);
  let digest = hasher.finalize();
  let mut hex = String::with_capacity(digest.len() * 2);
  for byte in digest {
    let _ = write!(&mut hex, "{byte:02x}");
  }
  is_known_google_placeholder_hash(&hex)
}

fn is_known_google_placeholder_hash(hash_hex: &str) -> bool {
  GOOGLE_BOOKS_PLACEHOLDER_SHA256.iter().any(|known| *known == hash_hex)
}

fn build_cover_search_attempts(title: &str, author: Option<&str>) -> Vec<(String, Option<String>)> {
  let title_candidates = title_query_candidates(title);
  let author_candidates = author_query_candidates(author);
  let mut seen = HashSet::new();
  let mut out = Vec::new();

  for title_candidate in title_candidates {
    for author_candidate in &author_candidates {
      let key = format!(
        "{}|{}",
        normalize_text(&title_candidate),
        author_candidate
          .as_ref()
          .map(|value| normalize_text(value))
          .unwrap_or_default()
      );
      if seen.insert(key) {
        out.push((title_candidate.clone(), author_candidate.clone()));
      }
    }
  }
  out
}

fn title_query_candidates(title: &str) -> Vec<String> {
  let base = sanitize_metadata_value(title).unwrap_or_else(|| title.trim().to_string());
  if base.is_empty() {
    return Vec::new();
  }

  let mut out = Vec::new();
  let mut seen = HashSet::new();
  let mut push_candidate = |value: String| {
    let candidate = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if candidate.is_empty() {
      return;
    }
    let key = normalize_text(&candidate);
    if !key.is_empty() && seen.insert(key) {
      out.push(candidate);
    }
  };

  let mut seeds = vec![base.clone()];
  let mut normalized = base.replace('+', " ");
  normalized = FILENAME_NOISE_PATTERN.replace_all(&normalized, " ").to_string();
  if normalized.split_whitespace().count() >= 3 {
    normalized = FILENAME_TRAILING_COUNTER_PATTERN
      .replace(&normalized, " ")
      .to_string();
  }
  normalized = normalized
    .split_whitespace()
    .collect::<Vec<_>>()
    .join(" ");
  if !normalized.is_empty() && normalize_text(&normalized) != normalize_text(&base) {
    seeds.push(normalized);
  }

  for seed in seeds {
    push_candidate(seed.clone());
    let lower = seed.to_lowercase();
    if lower.starts_with("the ") {
      push_candidate(seed[4..].to_string());
    } else {
      push_candidate(format!("The {seed}"));
    }

    let without_volume = TITLE_VOLUME_PATTERN.replace_all(&seed, " ").to_string();
    if without_volume != seed {
      push_candidate(without_volume.clone());
      let without_volume_lower = without_volume.to_lowercase();
      if without_volume_lower.starts_with("the ") {
        push_candidate(without_volume[4..].to_string());
      } else {
        push_candidate(format!("The {}", without_volume.trim()));
      }
    }
  }

  out
}

fn author_query_candidates(author: Option<&str>) -> Vec<Option<String>> {
  let mut out: Vec<Option<String>> = Vec::new();
  if let Some(author_value) = author {
    if let Some(primary) = first_author_token(author_value) {
      out.push(Some(primary));
    }
  }
  out.push(None);
  out
}

fn author_similarity(query_author: &str, remote_authors: Option<&[String]>) -> f64 {
  let Some(remote_values) = remote_authors else {
    return 0.5;
  };
  if remote_values.is_empty() {
    return 0.5;
  }
  let normalized_query = normalize_text(query_author);
  if normalized_query.is_empty() {
    return 0.5;
  }
  remote_values
    .iter()
    .map(|author| jaro_winkler(&normalized_query, &normalize_text(author)))
    .fold(0.0, f64::max)
}

fn first_author_token(author: &str) -> Option<String> {
  let primary = author
    .split(';')
    .next()
    .unwrap_or_default()
    .split('&')
    .next()
    .unwrap_or_default()
    .split(" and ")
    .next()
    .unwrap_or_default()
    .split('(')
    .next()
    .unwrap_or_default()
    .trim();
  let comma_parts: Vec<&str> = primary.split(',').map(str::trim).filter(|value| !value.is_empty()).collect();
  if comma_parts.len() >= 3 {
    return sanitize_metadata_value(&format!("{}, {}", comma_parts[0], comma_parts[1]));
  }
  if comma_parts.len() == 2 {
    if comma_parts[0].contains(' ') {
      return sanitize_metadata_value(comma_parts[0]);
    }
    if comma_parts[1].contains(' ') {
      return sanitize_metadata_value(&format!("{}, {}", comma_parts[0], comma_parts[1]));
    }
  }
  sanitize_metadata_value(primary)
}

#[cfg(test)]
mod tests {
  use super::{
    confidence_score, extract_isbn, first_author_token, infer_metadata_from_filename,
    is_google_books_cover_url, is_google_books_quota_exceeded, is_known_google_placeholder_hash,
    is_known_google_placeholder_image,
    normalize_google_cover_url, normalize_isbn, normalize_valid_isbn, parse_pdf_authors, title_query_candidates,
    OpenLibraryEnricher,
    ParsedMetadata,
  };
  use reqwest::StatusCode;
  use std::path::Path;

  #[test]
  fn extracts_isbn_when_present() {
    let value = "ISBN 978-1-4028-9462-6";
    assert_eq!(extract_isbn(value).as_deref(), Some("9781402894626"));
  }

  #[test]
  fn normalizes_isbn_string() {
    assert_eq!(normalize_isbn("978-1-4028-9462-6"), "9781402894626");
    assert_eq!(normalize_isbn("1-234-56789-X"), "123456789X");
  }

  #[test]
  fn rejects_invalid_isbn_checksum() {
    assert_eq!(normalize_valid_isbn("1396245095"), None);
    assert_eq!(extract_isbn("ISBN 1396245095"), None);
    assert_eq!(normalize_valid_isbn("1555406432").as_deref(), Some("1555406432"));
  }

  #[test]
  fn confidence_prefers_close_match() {
    let metadata = ParsedMetadata {
      title: Some("The Rust Programming Language".to_string()),
      authors: vec!["Steve Klabnik".to_string()],
      publish_date: Some("2019".to_string()),
      ..Default::default()
    };

    let high = confidence_score(
      &metadata,
      "The Rust Programming Language",
      &["Steve Klabnik".to_string()],
      Some("2019"),
    );
    let low = confidence_score(&metadata, "Unrelated Book", &["Other".to_string()], Some("2001"));
    assert!(high > low);
    assert!(high > 0.88);
  }

  #[test]
  fn normalizes_google_cover_links() {
    let input = "http://books.google.com/image?zoom=1&edge=curl";
    assert_eq!(
      normalize_google_cover_url(input).as_deref(),
      Some("https://books.google.com/image?zoom=2")
    );
  }

  #[test]
  fn detects_google_books_content_cover_urls() {
    assert!(is_google_books_cover_url(
      "https://books.google.com/books/content?id=abc&printsec=frontcover&img=1"
    ));
    assert!(is_google_books_cover_url(
      "https://books.googleapis.com/books/content?id=abc"
    ));
    assert!(is_google_books_cover_url(
      "https://content.books.google.com/books/content?id=abc"
    ));
    assert!(!is_google_books_cover_url(
      "https://covers.openlibrary.org/b/isbn/9780060600631-M.jpg?default=false"
    ));
    assert!(!is_google_books_cover_url(
      "https://attacker.example/books/content?host=books.google.com"
    ));
    assert!(!is_google_books_cover_url(
      "https://books.google.com.attacker.example/books/content?id=abc"
    ));
    assert!(!is_google_books_cover_url(
      "https://books.google.com/other/content?id=abc"
    ));
  }

  #[test]
  fn recognizes_known_google_placeholder_image_hash() {
    assert!(is_known_google_placeholder_hash(
      "12557f8948b8bdc6af436e3a8b3adddd45f7f7d2b67c5832e799cdf4686f72bb"
    ));
    assert!(!is_known_google_placeholder_hash(
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    ));
    assert!(!is_known_google_placeholder_image(b"not-a-real-image"));
  }

  #[test]
  fn resolve_cover_only_preserves_existing_openlibrary_cover_url() {
    let enricher = OpenLibraryEnricher::new();
    let metadata = ParsedMetadata::default();
    let resolved = enricher.resolve_cover_only(
      &metadata,
      Some("https://covers.openlibrary.org/b/isbn/9780060600631-L.jpg".to_string()),
    );
    assert_eq!(
      resolved.as_deref(),
      Some("https://covers.openlibrary.org/b/isbn/9780060600631-L.jpg?default=false")
    );
  }

  #[test]
  fn extracts_first_author_token() {
    assert_eq!(
      first_author_token("Andy Weir (Editor); Another Person").as_deref(),
      Some("Andy Weir")
    );
    assert_eq!(
      first_author_token("Michael Rydelnik, Edwin Blum").as_deref(),
      Some("Michael Rydelnik")
    );
    assert_eq!(
      first_author_token("Taylor, Richard A., Ray Clendenen").as_deref(),
      Some("Taylor, Richard A.")
    );
  }

  #[test]
  fn builds_cover_title_variants() {
    let variants = title_query_candidates("Prophecy of Isaiah");
    assert!(variants.iter().any(|value| value == "Prophecy of Isaiah"));
    assert!(variants.iter().any(|value| value == "The Prophecy of Isaiah"));

    let variants_with_volume = title_query_candidates("Haggai, Malachi Vol. 21A");
    assert!(variants_with_volume.iter().any(|value| value == "Haggai, Malachi"));

    let noisy_variants = title_query_candidates("Genesis Leviticus+1+ The+Expositors+Bible+Commentary 1");
    assert!(
      noisy_variants
        .iter()
        .any(|value| value == "Genesis Leviticus 1 The Expositors Bible Commentary")
    );
    assert!(noisy_variants.iter().any(|value| value.ends_with("Commentary")));
  }

  #[test]
  fn infers_filename_title_author_from_dash_separator() {
    let metadata = infer_metadata_from_filename(Path::new("The Master's Plan for the Churc - John F MacArthur.pdf"));
    assert_eq!(
      metadata.title.as_deref(),
      Some("The Master's Plan for the Churc")
    );
    assert_eq!(metadata.authors, vec!["John F MacArthur".to_string()]);
  }

  #[test]
  fn infers_filename_title_when_author_segment_is_first() {
    let metadata = infer_metadata_from_filename(Path::new("Getz, Gene - A Profile of Christian Maturity.pdf"));
    assert_eq!(
      metadata.title.as_deref(),
      Some("A Profile of Christian Maturity")
    );
    assert_eq!(metadata.authors, vec!["Getz, Gene".to_string()]);
  }

  #[test]
  fn strips_trailing_counter_from_filename_title_guess() {
    let metadata = infer_metadata_from_filename(Path::new("Why-believe-in-God-Jesus-and-the-Bible-1.pdf"));
    assert_eq!(
      metadata.title.as_deref(),
      Some("Why believe in God Jesus and the Bible")
    );
  }

  #[test]
  fn parses_pdf_authors_preserving_last_first_pairs() {
    let semicolon = parse_pdf_authors("Trull, Joe E.; Creech, R. Robert");
    assert_eq!(
      semicolon,
      vec!["Trull, Joe E.".to_string(), "Creech, R. Robert".to_string()]
    );

    let paired = parse_pdf_authors("Taylor, Richard A., Clendenen, Ray");
    assert_eq!(
      paired,
      vec!["Taylor, Richard A.".to_string(), "Clendenen, Ray".to_string()]
    );
  }

  #[test]
  fn detects_google_books_quota_error_statuses() {
    assert!(is_google_books_quota_exceeded(StatusCode::TOO_MANY_REQUESTS, ""));
    assert!(is_google_books_quota_exceeded(
      StatusCode::FORBIDDEN,
      r#"{"error":{"message":"Daily Limit Exceeded"}}"#
    ));
    assert!(!is_google_books_quota_exceeded(
      StatusCode::UNAUTHORIZED,
      r#"{"error":{"message":"Invalid API key"}}"#
    ));
  }
}
