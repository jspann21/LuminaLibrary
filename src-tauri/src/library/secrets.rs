use std::sync::OnceLock;

use anyhow::{Context, Result};
use keyring_core::Entry;

const SERVICE_NAME: &str = "lumina-library-desktop";
const GOOGLE_BOOKS_API_KEY_ACCOUNT: &str = "google-books-api-key";
const BRAVE_SEARCH_API_KEY_ACCOUNT: &str = "brave-search-api-key";
static SECRET_STORE_INITIALIZED: OnceLock<()> = OnceLock::new();

#[derive(Clone, Default)]
pub struct SecretStore;

impl SecretStore {
  pub fn new() -> Self {
    Self
  }

  pub fn get_google_books_api_key(&self) -> Result<Option<String>> {
    let entry = self.google_books_entry()?;
    match entry.get_password() {
      Ok(value) => {
        let trimmed = value.trim();
        if trimmed.is_empty() {
          Ok(None)
        } else {
          Ok(Some(trimmed.to_string()))
        }
      }
      Err(keyring_core::Error::NoEntry) => Ok(None),
      Err(err) => Err(err).context("failed to read google books api key from secure storage"),
    }
  }

  pub fn has_google_books_api_key(&self) -> Result<bool> {
    Ok(self.get_google_books_api_key()?.is_some())
  }

  pub fn set_google_books_api_key(&self, api_key: &str) -> Result<()> {
    let entry = self.google_books_entry()?;
    entry
      .set_password(api_key)
      .context("failed to store google books api key in secure storage")
  }

  pub fn clear_google_books_api_key(&self) -> Result<()> {
    let entry = self.google_books_entry()?;
    match entry.delete_credential() {
      Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
      Err(err) => Err(err).context("failed to delete google books api key from secure storage"),
    }
  }

  pub fn get_brave_search_api_key(&self) -> Result<Option<String>> {
    let entry = self.brave_search_entry()?;
    match entry.get_password() {
      Ok(value) => {
        let trimmed = value.trim();
        if trimmed.is_empty() {
          Ok(None)
        } else {
          Ok(Some(trimmed.to_string()))
        }
      }
      Err(keyring_core::Error::NoEntry) => Ok(None),
      Err(err) => Err(err).context("failed to read brave search api key from secure storage"),
    }
  }

  pub fn has_brave_search_api_key(&self) -> Result<bool> {
    Ok(self.get_brave_search_api_key()?.is_some())
  }

  pub fn set_brave_search_api_key(&self, api_key: &str) -> Result<()> {
    let entry = self.brave_search_entry()?;
    entry
      .set_password(api_key)
      .context("failed to store brave search api key in secure storage")
  }

  pub fn clear_brave_search_api_key(&self) -> Result<()> {
    let entry = self.brave_search_entry()?;
    match entry.delete_credential() {
      Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
      Err(err) => Err(err).context("failed to delete brave search api key from secure storage"),
    }
  }

  fn google_books_entry(&self) -> Result<Entry> {
    ensure_secret_store()?;
    Entry::new(SERVICE_NAME, GOOGLE_BOOKS_API_KEY_ACCOUNT)
      .context("failed to initialize credential entry for google books api key")
  }

  fn brave_search_entry(&self) -> Result<Entry> {
    ensure_secret_store()?;
    Entry::new(SERVICE_NAME, BRAVE_SEARCH_API_KEY_ACCOUNT)
      .context("failed to initialize credential entry for brave search api key")
  }
}

fn ensure_secret_store() -> Result<()> {
  if SECRET_STORE_INITIALIZED.get().is_some() {
    return Ok(());
  }

  install_default_secret_store()?;
  let _ = SECRET_STORE_INITIALIZED.set(());
  Ok(())
}

#[cfg(target_os = "windows")]
fn install_default_secret_store() -> Result<()> {
  let store = windows_native_keyring_store::Store::new()
    .context("failed to initialize Windows credential store")?;
  keyring_core::set_default_store(store);
  Ok(())
}

#[cfg(target_os = "macos")]
fn install_default_secret_store() -> Result<()> {
  let store = apple_native_keyring_store::keychain::Store::new()
    .context("failed to initialize macOS Keychain store")?;
  keyring_core::set_default_store(store);
  Ok(())
}

#[cfg(any(target_os = "linux", target_os = "freebsd"))]
fn install_default_secret_store() -> Result<()> {
  let store = dbus_secret_service_keyring_store::Store::new()
    .context("failed to initialize Secret Service credential store")?;
  keyring_core::set_default_store(store);
  Ok(())
}

#[cfg(not(any(
  target_os = "windows",
  target_os = "macos",
  target_os = "linux",
  target_os = "freebsd"
)))]
fn install_default_secret_store() -> Result<()> {
  Err(anyhow::anyhow!(
    "secure credential storage is not supported on this platform"
  ))
}
