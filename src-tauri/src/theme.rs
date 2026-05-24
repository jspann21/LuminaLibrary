use std::{
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use tauri::{utils::config::Color, Manager};

const THEME_STATE_FILE: &str = "window-theme.json";
const LIGHT_BACKGROUND: Color = Color(248, 250, 252, 255);
const DARK_BACKGROUND: Color = Color(2, 6, 23, 255);

#[derive(Clone, Copy)]
pub enum ResolvedTheme {
    Light,
    Dark,
}

#[derive(Deserialize, Serialize)]
struct PersistedWindowTheme {
    resolved_theme: String,
}

impl ResolvedTheme {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "light" => Some(Self::Light),
            "dark" => Some(Self::Dark),
            _ => None,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Light => "light",
            Self::Dark => "dark",
        }
    }

    pub fn background_color(self) -> Color {
        match self {
            Self::Light => LIGHT_BACKGROUND,
            Self::Dark => DARK_BACKGROUND,
        }
    }
}

fn theme_state_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(THEME_STATE_FILE)
}

pub fn read_window_theme(app_data_dir: &Path) -> ResolvedTheme {
    let Ok(contents) = fs::read_to_string(theme_state_path(app_data_dir)) else {
        return ResolvedTheme::Light;
    };

    serde_json::from_str::<PersistedWindowTheme>(&contents)
        .ok()
        .and_then(|state| ResolvedTheme::parse(&state.resolved_theme))
        .unwrap_or(ResolvedTheme::Light)
}

fn write_window_theme(app_data_dir: &Path, theme: ResolvedTheme) -> Result<(), String> {
    fs::create_dir_all(app_data_dir).map_err(|err| err.to_string())?;
    let state = PersistedWindowTheme {
        resolved_theme: theme.as_str().to_string(),
    };
    let contents = serde_json::to_vec(&state).map_err(|err| err.to_string())?;
    fs::write(theme_state_path(app_data_dir), contents).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn set_window_theme(app: tauri::AppHandle, resolved_theme: String) -> Result<(), String> {
    let theme = ResolvedTheme::parse(&resolved_theme)
        .ok_or_else(|| format!("invalid resolved theme: {resolved_theme}"))?;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| err.to_string())?
        .join("lumina-library");

    write_window_theme(&app_data_dir, theme)?;

    if let Some(window) = app.get_webview_window("main") {
        window
            .set_background_color(Some(theme.background_color()))
            .map_err(|err| err.to_string())?;
    }

    Ok(())
}
