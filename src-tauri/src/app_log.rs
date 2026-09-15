use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
const LOG_FILE_NAME: &str = "jellysmith.log.jsonl";
const MAX_LOG_BYTES: u64 = 2 * 1024 * 1024;
static LOG_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationLogEntry {
    pub time: u64,
    pub level: String,
    pub target: String,
    pub message: String,
}

fn log_path(_app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    crate::portable::directory("logs")
        .map(|directory| directory.join(LOG_FILE_NAME))
        .map_err(|error| error.to_string())
}

fn normalized(value: &str, limit: usize) -> String {
    value
        .chars()
        .filter(|character| *character != '\0')
        .take(limit)
        .collect()
}

pub fn record(
    app: &tauri::AppHandle,
    level: &str,
    target: &str,
    message: &str,
) -> Result<(), String> {
    let _guard = LOG_LOCK.lock().map_err(|error| error.to_string())?;
    let path = log_path(app)?;
    if fs::metadata(&path)
        .map(|metadata| metadata.len() > MAX_LOG_BYTES)
        .unwrap_or(false)
    {
        fs::write(&path, []).map_err(|error| error.to_string())?;
    }
    let entry = ApplicationLogEntry {
        time: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
        level: normalized(&level.to_uppercase(), 16),
        target: normalized(target, 80),
        message: normalized(message, 8_000),
    };
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    serde_json::to_writer(&mut file, &entry).map_err(|error| error.to_string())?;
    writeln!(file).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn write_application_log(
    app: tauri::AppHandle,
    level: String,
    target: String,
    message: String,
) -> Result<(), String> {
    record(&app, &level, &target, &message)
}

#[tauri::command]
pub fn list_application_logs(app: tauri::AppHandle) -> Result<Vec<ApplicationLogEntry>, String> {
    let _guard = LOG_LOCK.lock().map_err(|error| error.to_string())?;
    let path = log_path(&app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let mut entries: Vec<_> = content
        .lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect();
    entries.reverse();
    entries.truncate(2_000);
    Ok(entries)
}

#[tauri::command]
pub fn clear_application_logs(app: tauri::AppHandle) -> Result<(), String> {
    let _guard = LOG_LOCK.lock().map_err(|error| error.to_string())?;
    fs::write(log_path(&app)?, []).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::normalized;

    #[test]
    fn normalizes_untrusted_log_text() {
        assert_eq!(normalized("bad\0text", 5), "badte");
    }
}
