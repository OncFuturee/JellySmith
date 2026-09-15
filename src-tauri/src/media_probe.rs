use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{path::Path, process::Command};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaProbeResult {
    pub path: String,
    pub format: Value,
    pub streams: Vec<Value>,
}

#[tauri::command]
pub fn probe_media(app: tauri::AppHandle, path: String) -> Result<MediaProbeResult, String> {
    if !Path::new(&path).is_file() {
        return Err("媒体文件不存在".into());
    }
    let settings = crate::settings::read_settings(&app)?;
    if !settings.background_probe {
        return Err("media-probe-disabled".into());
    }
    let executable = if settings.ffprobe_path.trim().is_empty() {
        "ffprobe"
    } else {
        settings.ffprobe_path.trim()
    };
    let mut command = Command::new(executable);
    command.args([
        "-v",
        "error",
        "-show_format",
        "-show_streams",
        "-of",
        "json",
        &path,
    ]);
    #[cfg(target_os = "windows")]
    command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW，后台解析时不弹出 CMD 窗口。
    let output = command
        .output()
        .map_err(|error| format!("无法启动 FFprobe：{error}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
    }
    let value: Value = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("FFprobe 输出无效：{error}"))?;
    Ok(MediaProbeResult {
        path,
        format: value.get("format").cloned().unwrap_or(Value::Null),
        streams: value
            .get("streams")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
    })
}
