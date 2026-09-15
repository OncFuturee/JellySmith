use reqwest::blocking::{Client, RequestBuilder, Response};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::thread;
use std::time::Duration;

#[derive(Debug, Deserialize)]
struct ModelList {
    data: Vec<ModelItem>,
}
#[derive(Debug, Deserialize)]
struct ModelItem {
    id: String,
}

fn client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| "ai-client-error".into())
}

fn status_error(status: u16) -> String {
    match status {
        400 => "ai-request-rejected".into(),
        401 => "ai-authentication-failed".into(),
        403 => "ai-access-denied".into(),
        404 => "ai-model-or-endpoint-not-found".into(),
        408 => "ai-request-timeout".into(),
        429 => "ai-rate-limited".into(),
        500..=599 => "ai-service-unavailable".into(),
        _ => format!("ai-http-{status}"),
    }
}

fn send_with_retry(request: impl Fn() -> RequestBuilder) -> Result<Response, String> {
    for attempt in 0..3 {
        match request().send() {
            Ok(response) if response.status().is_success() => return Ok(response),
            Ok(response) => {
                let status = response.status().as_u16();
                let retryable = status == 429 || matches!(status, 500 | 502 | 503 | 504);
                if !retryable || attempt == 2 {
                    return Err(status_error(status));
                }
                let server_delay = response
                    .headers()
                    .get("retry-after")
                    .and_then(|value| value.to_str().ok())
                    .and_then(|value| value.parse::<u64>().ok())
                    .map(|seconds| Duration::from_secs(seconds.min(3)));
                thread::sleep(
                    server_delay.unwrap_or_else(|| Duration::from_millis(300 * (attempt + 1))),
                );
            }
            Err(_) if attempt < 2 => {
                thread::sleep(Duration::from_millis(300 * (attempt + 1)));
            }
            Err(_) => return Err("ai-network-error".into()),
        }
    }
    Err("ai-network-error".into())
}

fn openai_base(provider: &str, configured: &str) -> Result<String, String> {
    match provider {
        "siliconflow" => Ok("https://api.siliconflow.cn/v1".into()),
        "openai-compatible" if !configured.trim().is_empty() => {
            Ok(configured.trim_end_matches('/').into())
        }
        _ => Err("ai-provider-invalid".into()),
    }
}

#[tauri::command]
pub fn list_ai_models(app: tauri::AppHandle, provider: String) -> Result<Vec<String>, String> {
    let settings = crate::settings::read_settings(&app)?;
    let key = crate::settings::api_key(&provider)?;
    if provider == "gemini" {
        let http = client()?;
        let url = format!("https://generativelanguage.googleapis.com/v1beta/models?key={key}");
        send_with_retry(|| http.get(&url))?;
        return Ok(vec!["gemini-3.6-flash".into(), "gemini-3.5-flash".into()]);
    }
    let base = openai_base(&provider, &settings.ai.base_url)?;
    let url = if provider == "siliconflow" {
        format!("{base}/models?type=text&sub_type=chat")
    } else {
        format!("{base}/models")
    };
    let http = client()?;
    let response = send_with_retry(|| http.get(&url).bearer_auth(&key))?;
    let mut models: Vec<String> = response
        .json::<ModelList>()
        .map_err(|_| "ai-response-invalid")?
        .data
        .into_iter()
        .map(|m| m.id)
        .collect();
    models.sort();
    models.dedup();
    Ok(models)
}

fn json_payload(text: &str) -> Result<Value, String> {
    let cleaned = text
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    serde_json::from_str(cleaned).map_err(|_| "ai-response-invalid".into())
}

fn request_structured_json(app: &tauri::AppHandle, prompt: String) -> Result<String, String> {
    let settings = crate::settings::read_settings(app)?;
    let provider = settings.ai.provider.as_str();
    if provider == "disabled" {
        return Err("ai-not-configured".into());
    }
    if settings.ai.model.trim().is_empty() {
        return Err("ai-model-required".into());
    }
    let key = crate::settings::api_key(provider)?;
    let http = client()?;
    let response = if provider == "gemini" {
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
            settings.ai.model, key
        );
        let payload = json!({
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"responseMimeType": "application/json"}
        });
        send_with_retry(|| http.post(&url).json(&payload))
    } else {
        let base = openai_base(provider, &settings.ai.base_url)?;
        let url = format!("{base}/chat/completions");
        let payload = json!({
            "model": settings.ai.model,
            "messages": [
                {
                    "role": "system",
                    "content": "Return valid JSON only. Never request tools, absolute paths, or file access."
                },
                {"role": "user", "content": prompt}
            ],
            "response_format": {"type": "json_object"}
        });
        send_with_retry(|| http.post(&url).bearer_auth(&key).json(&payload))
    }?;
    let value: Value = response.json().map_err(|_| "ai-response-invalid")?;
    let text = if provider == "gemini" {
        value.pointer("/candidates/0/content/parts/0/text")
    } else {
        value.pointer("/choices/0/message/content")
    }
    .and_then(Value::as_str)
    .ok_or("ai-response-invalid")?;
    Ok(text.to_string())
}

fn parse_grouping(
    text: &str,
    known: &HashSet<String>,
) -> Result<Vec<crate::tasks::AiGroupingProposal>, String> {
    let value = json_payload(text)?;
    let groups = value.get("groups").cloned().unwrap_or(value);
    let proposals: Vec<crate::tasks::AiGroupingProposal> =
        serde_json::from_value(groups).map_err(|_| "ai-response-invalid")?;
    let mut assigned = HashSet::new();
    let invalid = proposals.len() > 1000
        || proposals.iter().any(|group| {
            group.title.trim().is_empty()
                || group.file_ids.is_empty()
                || !matches!(group.media_type.as_str(), "movie" | "tv" | "unknown")
                || !(0.0..=1.0).contains(&group.confidence)
                || group
                    .file_ids
                    .iter()
                    .any(|id| !known.contains(id) || !assigned.insert(id.clone()))
        });
    if invalid || assigned != *known {
        return Err("ai-response-invalid".into());
    }
    Ok(proposals)
}

#[tauri::command]
pub fn propose_ai_grouping(
    app: tauri::AppHandle,
    task_id: String,
    language: String,
) -> Result<Vec<crate::tasks::AiGroupingProposal>, String> {
    let task = crate::tasks::load_organizer_task(app.clone(), task_id)?;
    let eligible: Vec<_> = task
        .files
        .iter()
        .map(|file| {
            json!({
                "id": file.id,
                "relativePath": file.relative_path,
                "name": file.name,
                "extension": file.extension,
                "kind": file.kind,
                "parsed": file.parsed
            })
        })
        .collect();
    if eligible.is_empty() {
        return Ok(Vec::new());
    }
    let prompt = format!(
        "Group these media entries so each group represents exactly one movie or TV series. Assign every supplied file ID exactly once and never invent IDs. Subtitle, external audio, image, and NFO sidecars must stay in the same group as their matching video. Infer sidecar relationships from shared filename prefixes, episode tokens, language markers, inner extensions such as .ass.txt, and parent folders. Never create a subtitle-only group when matching videos are present. Use the video identity as the group identity. Do not propose file operations. Respond only as JSON {{\"groups\":[{{\"id\":string,\"title\":string,\"year\":number|null,\"mediaType\":\"movie\"|\"tv\"|\"unknown\",\"fileIds\":[string],\"confidence\":number,\"reason\":string}}]}}. Language: {language}. Files: {}",
        serde_json::to_string(&eligible).map_err(|_| "ai-request-invalid")?
    );
    let text = request_structured_json(&app, prompt)?;
    let proposals = parse_grouping(
        &text,
        &eligible
            .iter()
            .filter_map(|item| item.get("id").and_then(Value::as_str).map(str::to_string))
            .collect(),
    )?;
    Ok(crate::tasks::reconcile_ai_companions(&task, proposals))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiEpisodeMappingProposal {
    pub file_id: String,
    pub season: u16,
    pub episode: u16,
    pub episode_end: Option<u16>,
    #[serde(default)]
    pub title: String,
    pub confidence: f64,
    pub reason: String,
}

fn parse_episode_mappings(
    text: &str,
    known: &HashSet<String>,
) -> Result<Vec<AiEpisodeMappingProposal>, String> {
    let value = json_payload(text)?;
    let mappings = value.get("mappings").cloned().unwrap_or(value);
    let proposals: Vec<AiEpisodeMappingProposal> =
        serde_json::from_value(mappings).map_err(|_| "ai-response-invalid")?;
    let mut assigned = HashSet::new();
    if proposals.len() > known.len()
        || proposals.iter().any(|mapping| {
            !known.contains(&mapping.file_id)
                || !assigned.insert(mapping.file_id.clone())
                || mapping.season > 200
                || mapping.episode == 0
                || mapping.episode > 10_000
                || mapping
                    .episode_end
                    .is_some_and(|end| end < mapping.episode || end > 10_000)
                || !(0.0..=1.0).contains(&mapping.confidence)
                || mapping.title.len() > 300
                || mapping.reason.trim().is_empty()
                || mapping.reason.len() > 1_000
        })
    {
        return Err("ai-response-invalid".into());
    }
    Ok(proposals)
}

#[tauri::command]
pub fn propose_ai_episode_mappings(
    app: tauri::AppHandle,
    task_id: String,
    group_id: String,
    language: String,
) -> Result<Vec<AiEpisodeMappingProposal>, String> {
    let task = crate::tasks::load_organizer_task(app.clone(), task_id)?;
    let group = task
        .groups
        .iter()
        .find(|group| group.id == group_id && group.media_type == "tv" && group.confirmed)
        .ok_or("episode-ai-requires-match")?;
    let files: Vec<_> = task
        .files
        .iter()
        .filter(|file| file.kind == "video" && group.file_ids.contains(&file.id))
        .map(|file| {
            let current = group
                .episode_mappings
                .iter()
                .find(|mapping| mapping.file_id == file.id);
            json!({
                "id": file.id,
                "relativePath": file.relative_path,
                "name": file.name,
                "parsed": file.parsed,
                "current": current
            })
        })
        .collect();
    if files.is_empty() {
        return Ok(Vec::new());
    }
    let identity = group.matched.as_ref().map(|matched| {
        json!({
            "title": matched.display_title,
            "originalTitle": matched.candidate.original_title,
            "year": matched.candidate.year,
            "tmdbId": matched.candidate.id
        })
    });
    let prompt = format!(
        "Propose initial TV episode mappings for human review. Infer season and episode numbers from relative filenames, folder names, release conventions, parsed hints, and the confirmed series identity. Season 0 means specials. Preserve multi-episode ranges with episodeEnd. Use each supplied file ID at most once and never invent IDs. Leave title empty unless it is explicit in the filename. Do not confirm mappings and do not propose file operations. Respond only as JSON {{\"mappings\":[{{\"fileId\":string,\"season\":number,\"episode\":number,\"episodeEnd\":number|null,\"title\":string,\"confidence\":number,\"reason\":string}}]}}. Response reason language: {language}. Series: {}. Files: {}",
        serde_json::to_string(&identity).map_err(|_| "ai-request-invalid")?,
        serde_json::to_string(&files).map_err(|_| "ai-request-invalid")?
    );
    let text = request_structured_json(&app, prompt)?;
    parse_episode_mappings(
        &text,
        &files
            .iter()
            .filter_map(|item| item.get("id").and_then(Value::as_str).map(str::to_string))
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_common_http_failures_to_actionable_errors() {
        assert_eq!(status_error(401), "ai-authentication-failed");
        assert_eq!(status_error(404), "ai-model-or-endpoint-not-found");
        assert_eq!(status_error(429), "ai-rate-limited");
        assert_eq!(status_error(503), "ai-service-unavailable");
        assert_eq!(status_error(418), "ai-http-418");
    }

    #[test]
    fn grouping_schema_rejects_unknown_and_duplicate_files() {
        let known = HashSet::from(["file-1".to_string(), "file-2".to_string()]);
        let valid = r#"{"groups":[{"id":"g1","title":"Dune","year":2021,"mediaType":"movie","fileIds":["file-1","file-2"],"confidence":0.8,"reason":"same folder"}]}"#;
        assert_eq!(parse_grouping(valid, &known).unwrap().len(), 1);
        let unknown = valid.replace("file-1", "missing");
        assert!(parse_grouping(&unknown, &known).is_err());
        let duplicate = r#"{"groups":[{"id":"g1","title":"A","mediaType":"movie","fileIds":["file-1"],"confidence":0.8,"reason":"x"},{"id":"g2","title":"B","mediaType":"movie","fileIds":["file-1"],"confidence":0.7,"reason":"y"}]}"#;
        assert!(parse_grouping(duplicate, &known).is_err());
    }

    #[test]
    fn episode_mapping_schema_enforces_known_unique_files_and_ranges() {
        let known = HashSet::from(["file-1".to_string(), "file-2".to_string()]);
        let valid = r#"{"mappings":[{"fileId":"file-1","season":1,"episode":2,"episodeEnd":3,"title":"","confidence":0.9,"reason":"S01E02-E03"}]}"#;
        assert_eq!(parse_episode_mappings(valid, &known).unwrap().len(), 1);
        assert!(parse_episode_mappings(&valid.replace("file-1", "missing"), &known).is_err());
        let duplicate = r#"{"mappings":[{"fileId":"file-1","season":1,"episode":1,"title":"","confidence":0.8,"reason":"x"},{"fileId":"file-1","season":1,"episode":2,"title":"","confidence":0.7,"reason":"y"}]}"#;
        assert!(parse_episode_mappings(duplicate, &known).is_err());
        assert!(parse_episode_mappings(
            &valid.replace("\"episodeEnd\":3", "\"episodeEnd\":1"),
            &known
        )
        .is_err());
    }
}
