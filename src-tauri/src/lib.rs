use std::fs;
use tauri::Manager;

mod library;
mod theme;

use library::{
  commands::{
    add_library_folder, apply_curated_metadata, apply_manual_book_edit, attempt_match, batch_attempt_match,
    cache_book_covers,
    clear_google_books_api_key, clear_library_thing_integration, create_manual_book, delete_book,
    delete_tags, export_unresolved_csv, get_app_settings, get_book_detail, get_discovered_files,
    get_folder_removal_preview, get_hidden_books, get_library_books, get_library_folders, get_library_tags,
    hide_books, import_enrichment_csv, import_library_thing_export, mark_file_missing, merge_tags, open_library_thing_url, open_local_file, open_local_file_folder,
    reconcile_local_files,
    preview_match, preview_rescan_metadata, refresh_missing_covers, remove_library_folder, rescan_file, rescan_missing_metadata, restore_books,
    search_cover_candidates, set_book_tags, set_google_books_api_key, set_library_thing_catalog_label, set_library_thing_enabled, set_scan_on_startup, start_scan,
    test_google_books_api_key,
  },
  service::LibraryService,
  types::AppState,
};
use theme::set_window_theme;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .setup(|app| {
      app.handle().plugin(
        tauri_plugin_log::Builder::default()
          .level(log::LevelFilter::Info)
          .build(),
      )?;

      let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| err.to_string())?
        .join("lumina-library");
      fs::create_dir_all(&app_data_dir).map_err(|err| err.to_string())?;

      let mut window_config = app
        .config()
        .app
        .windows
        .first()
        .cloned()
        .ok_or_else(|| "missing main window config".to_string())?;
      window_config.background_color = Some(theme::read_window_theme(&app_data_dir).background_color());
      tauri::WebviewWindowBuilder::from_config(app, &window_config)
        .map_err(|err| err.to_string())?
        .build()
        .map_err(|err| err.to_string())?;

      let service = LibraryService::new(app_data_dir, app.handle().clone())
        .map_err(|err| err.to_string())?;
      service.start_existing_folder_watchers().map_err(|err| err.to_string())?;

      app.manage(AppState { service });
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      add_library_folder,
      remove_library_folder,
      get_folder_removal_preview,
      get_library_folders,
      get_app_settings,
      set_scan_on_startup,
      set_library_thing_enabled,
      set_library_thing_catalog_label,
      clear_library_thing_integration,
      set_google_books_api_key,
      clear_google_books_api_key,
      test_google_books_api_key,
      start_scan,
      rescan_missing_metadata,
      refresh_missing_covers,
      cache_book_covers,
      get_library_books,
      get_hidden_books,
      get_book_detail,
      get_library_tags,
      merge_tags,
      delete_tags,
      get_discovered_files,
      attempt_match,
      batch_attempt_match,
      preview_match,
      apply_manual_book_edit,
      create_manual_book,
      set_book_tags,
      hide_books,
      restore_books,
      delete_book,
      mark_file_missing,
      reconcile_local_files,
      export_unresolved_csv,
      import_enrichment_csv,
      import_library_thing_export,
      rescan_file,
      preview_rescan_metadata,
      apply_curated_metadata,
      open_local_file,
      open_local_file_folder,
      open_library_thing_url,
      search_cover_candidates,
      set_window_theme,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
