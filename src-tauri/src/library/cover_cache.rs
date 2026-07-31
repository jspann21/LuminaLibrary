use std::{
    collections::HashSet,
    fs::{self, OpenOptions},
    io::{BufWriter, Cursor, Read, Write},
    path::{Path, PathBuf},
    time::Duration,
};

use anyhow::{ensure, Context};
use image::{codecs::jpeg::JpegEncoder, ImageEncoder, ImageReader, Limits};
use reqwest::{blocking::Client as HttpClient, Url};
use sha2::{Digest, Sha256};
use uuid::Uuid;

const MAX_COVER_BYTES: u64 = 8 * 1024 * 1024;
const MAX_COVER_DECODE_BYTES: u64 = 64 * 1024 * 1024;
const COVER_THUMB_MAX_WIDTH: u32 = 384;
const COVER_THUMB_MAX_HEIGHT: u32 = 576;
const STALE_TEMP_FILE_AGE: Duration = Duration::from_secs(60 * 60);

#[derive(Clone)]
pub struct CoverCache {
    cache_dir: PathBuf,
    http: HttpClient,
}

impl CoverCache {
    pub fn new(cache_dir: PathBuf) -> anyhow::Result<Self> {
        fs::create_dir_all(&cache_dir)?;
        let http = HttpClient::builder()
            .timeout(Duration::from_secs(12))
            .user_agent("LuminaLibrary/0.1 cover-cache")
            .build()?;
        Ok(Self { cache_dir, http })
    }

    pub fn cache_cover(&self, book_id: &str, cover_url: &str) -> anyhow::Result<Option<String>> {
        if !is_cacheable_remote_cover_url(cover_url) {
            return Ok(None);
        }

        fs::create_dir_all(&self.cache_dir)?;
        let cache_path = self.cache_path(book_id, cover_url);
        if is_existing_file(&cache_path) {
            return Ok(Some(cache_path.to_string_lossy().to_string()));
        }

        let response = self
            .http
            .get(cover_url)
            .send()
            .with_context(|| format!("failed to download cover image from {cover_url}"))?
            .error_for_status()
            .with_context(|| format!("cover image request failed for {cover_url}"))?;

        if let Some(content_length) = response.content_length() {
            ensure!(
                content_length <= MAX_COVER_BYTES,
                "cover image is too large"
            );
        }
        if let Some(content_type) = response.headers().get(reqwest::header::CONTENT_TYPE) {
            let content_type = content_type
                .to_str()
                .unwrap_or_default()
                .to_ascii_lowercase();
            ensure!(
                content_type.is_empty() || content_type.starts_with("image/"),
                "cover URL did not return an image"
            );
        }

        let initial_capacity = response.content_length().unwrap_or(0) as usize;
        let mut bytes = Vec::with_capacity(initial_capacity);
        response
            .take(MAX_COVER_BYTES + 1)
            .read_to_end(&mut bytes)?;
        ensure!(
            bytes.len() as u64 <= MAX_COVER_BYTES,
            "cover image is too large"
        );

        let mut reader = ImageReader::new(Cursor::new(&bytes))
            .with_guessed_format()
            .context("failed to detect cover image format")?;
        let mut limits = Limits::default();
        limits.max_alloc = Some(MAX_COVER_DECODE_BYTES);
        reader.limits(limits);
        let image = reader.decode().context("failed to decode cover image")?;
        let thumb = image
            .thumbnail(COVER_THUMB_MAX_WIDTH, COVER_THUMB_MAX_HEIGHT)
            .to_rgb8();

        let tmp_path = cache_path.with_extension(format!("{}.tmp", Uuid::new_v4()));
        let write_result = (|| -> anyhow::Result<()> {
            let file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&tmp_path)?;
            let mut writer = BufWriter::new(file);
            {
                let encoder = JpegEncoder::new_with_quality(&mut writer, 82);
                encoder.write_image(
                    thumb.as_raw(),
                    thumb.width(),
                    thumb.height(),
                    image::ExtendedColorType::Rgb8,
                )?;
            }
            writer.flush()?;
            writer.get_ref().sync_all()?;
            Ok(())
        })();
        if let Err(err) = write_result {
            let _ = fs::remove_file(&tmp_path);
            return Err(err);
        }
        if let Err(err) = fs::rename(&tmp_path, &cache_path) {
            let _ = fs::remove_file(&tmp_path);
            if is_existing_file(&cache_path) {
                return Ok(Some(cache_path.to_string_lossy().to_string()));
            }
            return Err(err.into());
        }

        Ok(Some(cache_path.to_string_lossy().to_string()))
    }

    pub fn cached_file_exists(path: &str) -> bool {
        is_existing_file(Path::new(path))
    }

    pub fn prune_unreferenced(&self, referenced_paths: &HashSet<PathBuf>) -> anyhow::Result<usize> {
        let mut removed = 0;
        for entry in fs::read_dir(&self.cache_dir)? {
            let entry = entry?;
            let path = entry.path();
            let extension = path.extension().and_then(|extension| extension.to_str());
            let should_remove = match extension {
                Some("jpg") => !referenced_paths.contains(&path),
                Some("tmp") => is_stale_temp_file(&path),
                _ => false,
            };
            if !should_remove {
                continue;
            }
            fs::remove_file(&path)?;
            removed += 1;
        }
        Ok(removed)
    }

    fn cache_path(&self, book_id: &str, cover_url: &str) -> PathBuf {
        let mut hasher = Sha256::new();
        hasher.update(cover_url.as_bytes());
        let digest = hasher.finalize();
        let hash = hex_prefix(&digest, 16);
        self.cache_dir
            .join(format!("{}-{hash}.jpg", sanitize_file_stem(book_id)))
    }
}

fn is_cacheable_remote_cover_url(value: &str) -> bool {
    let Ok(parsed) = Url::parse(value.trim()) else {
        return false;
    };
    parsed.scheme() == "https"
}

fn is_existing_file(path: &Path) -> bool {
    fs::metadata(path)
        .map(|metadata| metadata.is_file())
        .unwrap_or(false)
}

fn is_stale_temp_file(path: &Path) -> bool {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|modified| modified.elapsed().ok())
        .is_some_and(|age| age >= STALE_TEMP_FILE_AGE)
}

fn sanitize_file_stem(value: &str) -> String {
    let stem: String = value
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '-' || *ch == '_')
        .take(80)
        .collect();
    if stem.is_empty() {
        "cover".to_string()
    } else {
        stem
    }
}

fn hex_prefix(bytes: &[u8], chars: usize) -> String {
    let mut output = String::with_capacity(chars);
    for byte in bytes {
        output.push_str(&format!("{byte:02x}"));
        if output.len() >= chars {
            output.truncate(chars);
            return output;
        }
    }
    output
}
