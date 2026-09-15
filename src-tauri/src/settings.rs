use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

static CREDENTIAL_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct PanelLayout {
    pub left_width: u16,
    pub right_width: u16,
    pub bottom_height: u16,
}

impl Default for PanelLayout {
    fn default() -> Self {
        Self {
            left_width: 230,
            right_width: 300,
            bottom_height: 350,
        }
    }
}

impl PanelLayout {
    pub fn clamp(mut self) -> Self {
        self.left_width = self.left_width.clamp(160, 420);
        self.right_width = self.right_width.clamp(220, 520);
        self.bottom_height = self.bottom_height.clamp(140, 520);
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AiSettings {
    pub provider: String,
    pub model: String,
    pub base_url: String,
}

impl Default for AiSettings {
    fn default() -> Self {
        Self {
            provider: "disabled".into(),
            model: "gemini-3.6-flash".into(),
            base_url: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub language: String,
    pub theme: String,
    pub ffprobe_path: String,
    pub default_movie_root: String,
    pub default_show_root: String,
    pub background_probe: bool,
    pub default_allow_overwrite: bool,
    pub backup_before_overwrite: bool,
    pub layout: PanelLayout,
    pub ai: AiSettings,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            language: String::new(),
            theme: "dark".into(),
            ffprobe_path: "ffprobe".into(),
            default_movie_root: String::new(),
            default_show_root: String::new(),
            background_probe: true,
            default_allow_overwrite: false,
            backup_before_overwrite: true,
            layout: PanelLayout::default(),
            ai: AiSettings::default(),
        }
    }
}

fn settings_path(_app: &tauri::AppHandle) -> Result<PathBuf, String> {
    crate::portable::file("settings.json").map_err(|error| error.to_string())
}

fn write_local_file(path: &Path, body: &str) -> Result<(), String> {
    fs::write(path, body).map_err(|error| error.to_string())
}

pub fn read_settings(app: &tauri::AppHandle) -> Result<AppSettings, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let body = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut settings: AppSettings =
        serde_json::from_str(&body).map_err(|_| "settings-invalid".to_string())?;
    if settings.layout
        == (PanelLayout {
            left_width: 218,
            right_width: 350,
            bottom_height: 310,
        })
    {
        settings.layout = PanelLayout::default();
    }
    settings.layout = settings.layout.clamp();
    Ok(settings)
}

#[tauri::command]
pub fn load_settings(app: tauri::AppHandle) -> Result<AppSettings, String> {
    read_settings(&app)
}

#[tauri::command]
pub fn save_settings(
    app: tauri::AppHandle,
    mut settings: AppSettings,
) -> Result<AppSettings, String> {
    settings.layout = settings.layout.clamp();
    if !matches!(settings.language.as_str(), "" | "zh-CN" | "en-US") {
        return Err("settings-language-invalid".into());
    }
    if !matches!(settings.theme.as_str(), "dark" | "light") {
        return Err("settings-theme-invalid".into());
    }
    if !matches!(
        settings.ai.provider.as_str(),
        "disabled" | "gemini" | "siliconflow" | "openai-compatible"
    ) {
        return Err("settings-provider-invalid".into());
    }
    let body = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    write_local_file(&settings_path(&app)?, &body)?;
    Ok(settings)
}

fn validate_provider(provider: &str) -> Result<(), String> {
    if !matches!(
        provider,
        "gemini" | "siliconflow" | "openai-compatible" | "tmdb"
    ) {
        return Err("settings-provider-invalid".into());
    }
    Ok(())
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct PortableCredentials {
    #[serde(default)]
    keys: BTreeMap<String, String>,
}

fn credentials_path() -> Result<PathBuf, String> {
    crate::portable::file("credentials.json").map_err(|_| "credential-unavailable".into())
}

fn read_credentials() -> Result<PortableCredentials, String> {
    let path = credentials_path()?;
    if !path.exists() {
        return Ok(PortableCredentials::default());
    }
    let body = fs::read_to_string(path).map_err(|_| "credential-unavailable")?;
    serde_json::from_str(&body).map_err(|_| "credential-unavailable".into())
}

pub fn api_key(provider: &str) -> Result<String, String> {
    validate_provider(provider)?;
    let _guard = CREDENTIAL_LOCK
        .lock()
        .map_err(|_| "credential-unavailable")?;
    read_credentials()?
        .keys
        .get(provider)
        .filter(|value| !value.is_empty())
        .cloned()
        .ok_or_else(|| "api-key-missing".into())
}

#[tauri::command]
pub fn has_api_key(provider: String) -> Result<bool, String> {
    validate_provider(&provider)?;
    let _guard = CREDENTIAL_LOCK
        .lock()
        .map_err(|_| "credential-unavailable")?;
    Ok(read_credentials()?
        .keys
        .get(&provider)
        .is_some_and(|value| !value.is_empty()))
}

#[tauri::command]
pub fn save_api_key(provider: String, api_key: String) -> Result<(), String> {
    validate_provider(&provider)?;
    let _guard = CREDENTIAL_LOCK
        .lock()
        .map_err(|_| "credential-unavailable")?;
    let mut credentials = read_credentials()?;
    if api_key.trim().is_empty() {
        credentials.keys.remove(&provider);
    } else {
        credentials
            .keys
            .insert(provider, api_key.trim().to_string());
    }
    let body = serde_json::to_string_pretty(&credentials).map_err(|_| "credential-write-failed")?;
    write_local_file(&credentials_path()?, &body).map_err(|_| "credential-write-failed".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn defaults_are_safe() {
        let value = AppSettings::default();
        assert!(value.background_probe);
        assert_eq!(value.theme, "dark");
        assert!(!value.default_allow_overwrite);
        assert!(value.backup_before_overwrite);
    }
    #[test]
    fn layout_is_clamped() {
        let value = PanelLayout {
            left_width: 1,
            right_width: 999,
            bottom_height: 2,
        }
        .clamp();
        assert_eq!(
            value,
            PanelLayout {
                left_width: 160,
                right_width: 520,
                bottom_height: 140
            }
        );
    }
    #[test]
    fn old_json_gets_defaults() {
        let value: AppSettings = serde_json::from_str(r#"{"language":"zh-CN"}"#).unwrap();
        assert_eq!(value.ffprobe_path, "ffprobe");
        assert!(value.default_movie_root.is_empty());
        assert!(value.default_show_root.is_empty());
        assert_eq!(value.theme, "dark");
        assert_eq!(value.layout, PanelLayout::default());
    }

    #[test]
    fn portable_credentials_round_trip_as_local_json() {
        let mut value = PortableCredentials::default();
        value.keys.insert("tmdb".into(), "token".into());
        let json = serde_json::to_string(&value).unwrap();
        let restored: PortableCredentials = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.keys.get("tmdb").map(String::as_str), Some("token"));
    }
}
