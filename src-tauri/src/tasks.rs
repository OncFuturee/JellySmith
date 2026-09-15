use crate::{
    app_log,
    audit::{LogLine, RunResult},
};
use regex::Regex;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    cmp::Ordering as CmpOrdering,
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, OnceLock,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::Emitter;

const VIDEO_EXTENSIONS: &[&str] = &["mkv", "mp4", "avi", "mov", "m4v", "wmv", "ts", "webm"];
// Keep external subtitles in the same scan/plan/execute transaction as their video.
// `idx` + `sub` is a VobSub pair; the remaining formats cover the common text and
// bitmap sidecars accepted by media servers such as Jellyfin.
const SUBTITLE_EXTENSIONS: &[&str] = &[
    "srt", "ass", "ssa", "sub", "idx", "vtt", "smi", "sami", "sup", "ttml", "dfxp",
];
const SUBTITLE_LANGUAGE_CODES: &[&str] = &[
    "ar", "ara", "bg", "bul", "cs", "ces", "cze", "da", "dan", "de", "deu", "ger", "el", "ell",
    "gre", "en", "eng", "es", "spa", "fi", "fin", "fr", "fra", "fre", "he", "heb", "hi", "hin",
    "hu", "hun", "id", "ind", "it", "ita", "ja", "jpn", "ko", "kor", "ms", "msa", "may", "nl",
    "nld", "dut", "no", "nor", "pl", "pol", "pt", "por", "ro", "ron", "rum", "ru", "rus", "sk",
    "slk", "slo", "sv", "swe", "th", "tha", "tr", "tur", "uk", "ukr", "vi", "vie", "zh", "zho",
    "chi", "chs", "cht",
];
const SUBTITLE_FLAGS: &[&str] = &["default", "forced", "foreign", "sdh", "cc", "hi"];
const SUBTITLE_LANGUAGE_ALIASES: &[&str] = &["sc", "tc", "gb", "big5"];
const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "webp"];
const AUDIO_EXTENSIONS: &[&str] = &["mka", "aac", "ac3", "eac3", "dts", "flac", "mp3"];
static NEXT_ID: AtomicU64 = AtomicU64::new(1);
static CANCELLED_SCANS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
fn cancelled_scans() -> &'static Mutex<HashSet<String>> {
    CANCELLED_SCANS.get_or_init(|| Mutex::new(HashSet::new()))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskRequest {
    pub name: String,
    pub mode: String,
    pub source_root: String,
    pub movie_root: String,
    pub show_root: String,
    pub operation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSummary {
    pub id: String,
    pub name: String,
    pub mode: String,
    pub status: String,
    pub stage: String,
    pub updated_at: u64,
    pub file_count: usize,
    pub group_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ParsedMedia {
    pub title: String,
    pub year: Option<u16>,
    pub season: Option<u16>,
    pub episodes: Vec<u16>,
    pub resolution: Option<String>,
    pub edition: Option<String>,
    pub language_suffix: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedFile {
    pub id: String,
    pub relative_path: String,
    pub name: String,
    pub extension: String,
    pub kind: String,
    pub size: u64,
    pub modified_at: u64,
    pub group_id: Option<String>,
    pub parsed: ParsedMedia,
    pub warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmdbCandidate {
    pub id: u64,
    pub media_type: String,
    pub title: String,
    pub original_title: String,
    pub year: Option<u16>,
    pub overview: String,
    pub poster_path: Option<String>,
    pub vote_average: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmedMatch {
    pub candidate: TmdbCandidate,
    pub display_title: String,
    pub source: String,
    #[serde(default)]
    pub language: Option<String>,
    pub confirmed_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpisodeMapping {
    pub file_id: String,
    pub season: u16,
    pub episode: u16,
    pub episode_end: Option<u16>,
    pub title: String,
    pub confirmed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaGroup {
    pub id: String,
    pub title_guess: String,
    pub year: Option<u16>,
    pub media_type: String,
    pub confidence: f64,
    pub source: String,
    pub confirmed: bool,
    pub file_ids: Vec<String>,
    pub matched: Option<ConfirmedMatch>,
    pub episode_mappings: Vec<EpisodeMapping>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileOperation {
    pub id: String,
    pub group_id: String,
    pub source: String,
    pub target: String,
    pub operation: String,
    pub selected: bool,
    pub size: u64,
    pub modified_at: u64,
    pub status: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizationPlan {
    pub id: String,
    pub task_id: String,
    pub task_revision: u64,
    pub created_at: u64,
    pub status: String,
    pub operations: Vec<FileOperation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizerTask {
    pub id: String,
    pub name: String,
    pub mode: String,
    pub source_root: String,
    pub movie_root: String,
    pub show_root: String,
    pub operation: String,
    pub episode_naming_format: String,
    pub status: String,
    pub stage: String,
    pub revision: u64,
    pub created_at: u64,
    pub updated_at: u64,
    pub files: Vec<ScannedFile>,
    pub groups: Vec<MediaGroup>,
    pub plan: Option<OrganizationPlan>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub task_id: String,
    pub scanned: usize,
    pub current_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiGroupingProposal {
    pub id: String,
    pub title: String,
    pub year: Option<u16>,
    pub media_type: String,
    pub file_ids: Vec<String>,
    pub confidence: f64,
    pub reason: String,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub(crate) fn unix_now() -> u64 {
    now()
}

fn new_id(prefix: &str) -> String {
    format!(
        "{prefix}-{}-{}",
        now(),
        NEXT_ID.fetch_add(1, Ordering::Relaxed)
    )
}

fn scanned_file_id(task_id: &str, relative_path: &str) -> String {
    let identity = format!("{task_id}\0{relative_path}");
    format!("file-{}", &blake3::hash(identity.as_bytes()).to_hex()[..20])
}

fn database_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let _ = app;
    crate::portable::file("jellysmith.db").map_err(|_| "app-data-unavailable".into())
}

pub(crate) fn open_database(app: &tauri::AppHandle) -> Result<Connection, String> {
    let connection = Connection::open(database_path(app)?).map_err(|_| "database-open-failed")?;
    connection
        .busy_timeout(Duration::from_secs(8))
        .map_err(|_| "database-init-failed")?;
    connection
        .pragma_update(None, "journal_mode", "WAL")
        .map_err(|_| "database-init-failed")?;
    connection
        .pragma_update(None, "temp_store", "MEMORY")
        .map_err(|_| "database-init-failed")?;
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(|_| "database-init-failed")?;
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS organizer_tasks(
            id TEXT PRIMARY KEY,name TEXT NOT NULL,mode TEXT NOT NULL,source_root TEXT NOT NULL,
            movie_root TEXT NOT NULL,show_root TEXT NOT NULL,operation TEXT NOT NULL,status TEXT NOT NULL,
            stage TEXT NOT NULL,revision INTEGER NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,archived INTEGER NOT NULL DEFAULT 0,
            episode_naming_format TEXT NOT NULL DEFAULT 'series-year-title'
        );
        CREATE TABLE IF NOT EXISTS scanned_files(
            id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES organizer_tasks(id) ON DELETE CASCADE,
            relative_path TEXT NOT NULL,name TEXT NOT NULL,extension TEXT NOT NULL,kind TEXT NOT NULL,
            size INTEGER NOT NULL,modified_at INTEGER NOT NULL,group_id TEXT,parsed_json TEXT NOT NULL,warning TEXT
        );
        CREATE TABLE IF NOT EXISTS media_groups(
            id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES organizer_tasks(id) ON DELETE CASCADE,
            title_guess TEXT NOT NULL,year INTEGER,media_type TEXT NOT NULL,confidence REAL NOT NULL,
            source TEXT NOT NULL,confirmed INTEGER NOT NULL DEFAULT 0,match_json TEXT
        );
        CREATE TABLE IF NOT EXISTS episode_mappings(
            task_id TEXT NOT NULL,group_id TEXT NOT NULL,file_id TEXT NOT NULL,season INTEGER NOT NULL,
            episode INTEGER NOT NULL,episode_end INTEGER,title TEXT NOT NULL,confirmed INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(task_id,file_id)
        );
        CREATE TABLE IF NOT EXISTS organization_plans(
            id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES organizer_tasks(id) ON DELETE CASCADE,
            task_revision INTEGER NOT NULL,created_at INTEGER NOT NULL,status TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS file_operations(
            id TEXT PRIMARY KEY,plan_id TEXT NOT NULL REFERENCES organization_plans(id) ON DELETE CASCADE,
            group_id TEXT NOT NULL,source TEXT NOT NULL,target TEXT NOT NULL,operation TEXT NOT NULL,
            selected INTEGER NOT NULL,size INTEGER NOT NULL,modified_at INTEGER NOT NULL,status TEXT NOT NULL,reason TEXT
        );
        CREATE TABLE IF NOT EXISTS execution_records(
            id TEXT PRIMARY KEY,task_id TEXT NOT NULL,plan_id TEXT NOT NULL,status TEXT NOT NULL,started_at INTEGER NOT NULL,finished_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS operation_logs(
            id INTEGER PRIMARY KEY AUTOINCREMENT,execution_id TEXT NOT NULL,operation_id TEXT NOT NULL,
            time INTEGER NOT NULL,level TEXT NOT NULL,code TEXT NOT NULL,message TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tmdb_cache(
            cache_key TEXT PRIMARY KEY,body TEXT NOT NULL,expires_at INTEGER NOT NULL
        );
        UPDATE execution_records SET status='interrupted',finished_at=strftime('%s','now')*1000 WHERE status='running';
        UPDATE file_operations SET status='failed',reason='execution-interrupted' WHERE status='executing';
        UPDATE organizer_tasks SET status='failed' WHERE id IN (SELECT task_id FROM execution_records WHERE status='interrupted');
        UPDATE organizer_tasks SET stage='plan' WHERE stage='execute';",
    ).map_err(|_| "database-init-failed")?;
    // Existing installations created the task table before naming templates were persisted.
    // SQLite has no `ADD COLUMN IF NOT EXISTS`, so a duplicate-column error is harmless here.
    let _ = connection.execute(
        "ALTER TABLE organizer_tasks ADD COLUMN episode_naming_format TEXT NOT NULL DEFAULT 'series-year-title'",
        [],
    );
    connection
        .pragma_update(None, "user_version", 2)
        .map_err(|_| "database-init-failed")?;
    Ok(connection)
}

fn validate_root(value: &str, code: &str) -> Result<String, String> {
    if value.trim().is_empty() {
        return Err(code.into());
    }
    let path = Path::new(value)
        .canonicalize()
        .map_err(|_| code.to_string())?;
    if !path.is_dir() {
        return Err(code.into());
    }
    Ok(path.to_string_lossy().into_owned())
}

fn ensure_roots_do_not_overlap(source: &Path, targets: [&Path; 2]) -> Result<(), String> {
    for target in targets {
        if source == target || source.starts_with(target) || target.starts_with(source) {
            return Err("roots-overlap".into());
        }
    }
    Ok(())
}

fn validate_request(mut request: CreateTaskRequest) -> Result<CreateTaskRequest, String> {
    if !matches!(request.mode.as_str(), "single" | "batch") {
        return Err("task-mode-invalid".into());
    }
    if !matches!(request.operation.as_str(), "move" | "copy") {
        return Err("task-operation-invalid".into());
    }
    request.source_root = validate_root(&request.source_root, "source-unavailable")?;
    request.movie_root = validate_root(&request.movie_root, "movie-root-unavailable")?;
    request.show_root = validate_root(&request.show_root, "show-root-unavailable")?;
    let source = Path::new(&request.source_root);
    ensure_roots_do_not_overlap(
        source,
        [
            Path::new(&request.movie_root),
            Path::new(&request.show_root),
        ],
    )?;
    if request.name.trim().is_empty() {
        request.name = source
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("Media task")
            .to_string();
    }
    Ok(request)
}

#[tauri::command]
pub fn create_organizer_task(
    app: tauri::AppHandle,
    request: CreateTaskRequest,
) -> Result<OrganizerTask, String> {
    let request = validate_request(request)?;
    let connection = open_database(&app)?;
    let id = new_id("task");
    let timestamp = now();
    connection.execute(
        "INSERT INTO organizer_tasks(id,name,mode,source_root,movie_root,show_root,operation,status,stage,revision,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,'draft','scan',1,?8,?8)",
        params![id, request.name.trim(), request.mode, request.source_root, request.movie_root, request.show_root, request.operation, timestamp],
    ).map_err(|_| "task-create-failed")?;
    load_task_from(&connection, &id)
}

#[tauri::command]
pub fn list_organizer_tasks(app: tauri::AppHandle) -> Result<Vec<TaskSummary>, String> {
    let connection = open_database(&app)?;
    let mut statement = connection
        .prepare(
            "SELECT t.id,t.name,t.mode,t.status,t.stage,t.updated_at,
        (SELECT COUNT(*) FROM scanned_files f WHERE f.task_id=t.id),
        (SELECT COUNT(*) FROM media_groups g WHERE g.task_id=t.id)
        FROM organizer_tasks t WHERE archived=0 ORDER BY updated_at DESC",
        )
        .map_err(|_| "task-list-failed")?;
    let rows = statement
        .query_map([], |row| {
            Ok(TaskSummary {
                id: row.get(0)?,
                name: row.get(1)?,
                mode: row.get(2)?,
                status: row.get(3)?,
                stage: row.get(4)?,
                updated_at: row.get::<_, i64>(5)? as u64,
                file_count: row.get::<_, i64>(6)? as usize,
                group_count: row.get::<_, i64>(7)? as usize,
            })
        })
        .map_err(|_| "task-list-failed")?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|_| "task-list-failed".into())
}

#[tauri::command]
pub fn load_organizer_task(
    app: tauri::AppHandle,
    task_id: String,
) -> Result<OrganizerTask, String> {
    load_task_from(&open_database(&app)?, &task_id)
}

#[tauri::command]
pub fn archive_organizer_task(app: tauri::AppHandle, task_id: String) -> Result<(), String> {
    let connection = open_database(&app)?;
    let changed = connection
        .execute(
            "UPDATE organizer_tasks SET archived=1,updated_at=?2 WHERE id=?1",
            params![task_id, now()],
        )
        .map_err(|_| "task-update-failed")?;
    if changed == 0 {
        return Err("task-not-found".into());
    }
    Ok(())
}

#[tauri::command]
pub fn update_organizer_task_source(
    app: tauri::AppHandle,
    task_id: String,
    source_root: String,
) -> Result<OrganizerTask, String> {
    let source_root = validate_root(&source_root, "source-unavailable")?;
    let mut connection = open_database(&app)?;
    let (current_source, movie_root, show_root) = connection
        .query_row(
            "SELECT source_root,movie_root,show_root FROM organizer_tasks WHERE id=?1 AND archived=0",
            [&task_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|_| "task-load-failed")?
        .ok_or("task-not-found")?;
    ensure_roots_do_not_overlap(
        Path::new(&source_root),
        [Path::new(&movie_root), Path::new(&show_root)],
    )?;
    if Path::new(&current_source) == Path::new(&source_root) {
        return load_task_from(&connection, &task_id);
    }
    let transaction = connection
        .transaction()
        .map_err(|_| "database-write-failed")?;
    transaction
        .execute("DELETE FROM episode_mappings WHERE task_id=?1", [&task_id])
        .map_err(|_| "database-write-failed")?;
    transaction
        .execute("DELETE FROM scanned_files WHERE task_id=?1", [&task_id])
        .map_err(|_| "database-write-failed")?;
    transaction
        .execute("DELETE FROM media_groups WHERE task_id=?1", [&task_id])
        .map_err(|_| "database-write-failed")?;
    transaction
        .execute(
            "DELETE FROM organization_plans WHERE task_id=?1",
            [&task_id],
        )
        .map_err(|_| "database-write-failed")?;
    transaction
        .execute(
            "UPDATE organizer_tasks SET source_root=?2,status='draft',stage='scan',revision=revision+1,updated_at=?3 WHERE id=?1",
            params![task_id, source_root, now()],
        )
        .map_err(|_| "task-update-failed")?;
    transaction.commit().map_err(|_| "database-write-failed")?;
    load_task_from(&connection, &task_id)
}

#[tauri::command]
pub fn update_organizer_task_config(
    app: tauri::AppHandle,
    task_id: String,
    request: CreateTaskRequest,
) -> Result<OrganizerTask, String> {
    let request = validate_request(request)?;
    let mut connection = open_database(&app)?;
    let current = connection
        .query_row(
            "SELECT name,mode,source_root,movie_root,show_root,operation FROM organizer_tasks WHERE id=?1 AND archived=0",
            [&task_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                ))
            },
        )
        .optional()
        .map_err(|_| "task-load-failed")?
        .ok_or("task-not-found")?;
    let name_changed = current.0 != request.name.trim();
    let reset_scan = current.1 != request.mode || current.2 != request.source_root;
    let invalidate_plan = reset_scan
        || current.3 != request.movie_root
        || current.4 != request.show_root
        || current.5 != request.operation;
    if !name_changed && !invalidate_plan {
        return load_task_from(&connection, &task_id);
    }
    let transaction = connection
        .transaction()
        .map_err(|_| "database-write-failed")?;
    if reset_scan {
        transaction
            .execute("DELETE FROM episode_mappings WHERE task_id=?1", [&task_id])
            .map_err(|_| "database-write-failed")?;
        transaction
            .execute("DELETE FROM scanned_files WHERE task_id=?1", [&task_id])
            .map_err(|_| "database-write-failed")?;
        transaction
            .execute("DELETE FROM media_groups WHERE task_id=?1", [&task_id])
            .map_err(|_| "database-write-failed")?;
    }
    if invalidate_plan {
        transaction
            .execute(
                "DELETE FROM organization_plans WHERE task_id=?1",
                [&task_id],
            )
            .map_err(|_| "database-write-failed")?;
    }
    transaction
        .execute(
            "UPDATE organizer_tasks SET name=?2,mode=?3,source_root=?4,movie_root=?5,show_root=?6,operation=?7,revision=revision+?8,updated_at=?9 WHERE id=?1",
            params![task_id, request.name.trim(), request.mode, request.source_root, request.movie_root, request.show_root, request.operation, i64::from(invalidate_plan), now()],
        )
        .map_err(|_| "task-update-failed")?;
    if reset_scan {
        transaction
            .execute(
                "UPDATE organizer_tasks SET status='draft',stage='scan' WHERE id=?1",
                [&task_id],
            )
            .map_err(|_| "task-update-failed")?;
    } else if invalidate_plan {
        transaction
            .execute(
                "UPDATE organizer_tasks SET status='active',stage=CASE WHEN stage='execute' THEN 'plan' ELSE stage END WHERE id=?1",
                [&task_id],
            )
            .map_err(|_| "task-update-failed")?;
    }
    transaction.commit().map_err(|_| "database-write-failed")?;
    load_task_from(&connection, &task_id)
}

fn row_file(row: &rusqlite::Row<'_>) -> rusqlite::Result<ScannedFile> {
    let parsed: String = row.get(8)?;
    Ok(ScannedFile {
        id: row.get(0)?,
        relative_path: row.get(1)?,
        name: row.get(2)?,
        extension: row.get(3)?,
        kind: row.get(4)?,
        size: row.get::<_, i64>(5)? as u64,
        modified_at: row.get::<_, i64>(6)? as u64,
        group_id: row.get(7)?,
        parsed: serde_json::from_str(&parsed).unwrap_or_default(),
        warning: row.get(9)?,
    })
}

fn load_task_from(connection: &Connection, task_id: &str) -> Result<OrganizerTask, String> {
    let base = connection.query_row(
        "SELECT id,name,mode,source_root,movie_root,show_root,operation,episode_naming_format,status,stage,revision,created_at,updated_at FROM organizer_tasks WHERE id=?1 AND archived=0",
        [task_id],
        |row| Ok((row.get::<_, String>(0)?,row.get::<_, String>(1)?,row.get::<_, String>(2)?,row.get::<_, String>(3)?,row.get::<_, String>(4)?,row.get::<_, String>(5)?,row.get::<_, String>(6)?,row.get::<_, String>(7)?,row.get::<_, String>(8)?,row.get::<_, String>(9)?,row.get::<_, i64>(10)? as u64,row.get::<_, i64>(11)? as u64,row.get::<_, i64>(12)? as u64)),
    ).optional().map_err(|_| "task-load-failed")?.ok_or("task-not-found")?;
    let mut file_statement = connection.prepare("SELECT id,relative_path,name,extension,kind,size,modified_at,group_id,parsed_json,warning FROM scanned_files WHERE task_id=?1 ORDER BY relative_path").map_err(|_| "task-load-failed")?;
    let files = file_statement
        .query_map([task_id], row_file)
        .map_err(|_| "task-load-failed")?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "task-load-failed")?;
    let mut group_statement = connection.prepare("SELECT id,title_guess,year,media_type,confidence,source,confirmed,match_json FROM media_groups WHERE task_id=?1 ORDER BY title_guess").map_err(|_| "task-load-failed")?;
    let group_rows = group_statement
        .query_map([task_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<i64>>(2)?.map(|v| v as u16),
                row.get::<_, String>(3)?,
                row.get::<_, f64>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, i64>(6)? != 0,
                row.get::<_, Option<String>>(7)?,
            ))
        })
        .map_err(|_| "task-load-failed")?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "task-load-failed")?;
    let mut mapping_statement = connection.prepare("SELECT file_id,season,episode,episode_end,title,confirmed FROM episode_mappings WHERE task_id=?1 AND group_id=?2 ORDER BY season,episode").map_err(|_| "task-load-failed")?;
    let mut groups = Vec::new();
    for row in group_rows {
        let mappings = mapping_statement
            .query_map(params![task_id, row.0], |item| {
                Ok(EpisodeMapping {
                    file_id: item.get(0)?,
                    season: item.get::<_, i64>(1)? as u16,
                    episode: item.get::<_, i64>(2)? as u16,
                    episode_end: item.get::<_, Option<i64>>(3)?.map(|v| v as u16),
                    title: item.get(4)?,
                    confirmed: item.get::<_, i64>(5)? != 0,
                })
            })
            .map_err(|_| "task-load-failed")?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| "task-load-failed")?;
        groups.push(MediaGroup {
            id: row.0.clone(),
            title_guess: row.1,
            year: row.2,
            media_type: row.3,
            confidence: row.4,
            source: row.5,
            confirmed: row.6,
            file_ids: files
                .iter()
                .filter(|file| file.group_id.as_deref() == Some(row.0.as_str()))
                .map(|file| file.id.clone())
                .collect(),
            matched: row.7.and_then(|value| serde_json::from_str(&value).ok()),
            episode_mappings: mappings,
        });
    }
    let plan_id: Option<String> = connection
        .query_row(
            "SELECT id FROM organization_plans WHERE task_id=?1 ORDER BY created_at DESC LIMIT 1",
            [task_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| "task-load-failed")?;
    let plan = plan_id
        .map(|id| load_plan_from(connection, &id))
        .transpose()?;
    Ok(OrganizerTask {
        id: base.0,
        name: base.1,
        mode: base.2,
        source_root: base.3,
        movie_root: base.4,
        show_root: base.5,
        operation: base.6,
        episode_naming_format: base.7,
        status: base.8,
        stage: base.9,
        revision: base.10,
        created_at: base.11,
        updated_at: base.12,
        files,
        groups,
        plan,
    })
}

fn invalidate_plan(connection: &Connection, task_id: &str, stage: &str) -> Result<(), String> {
    connection
        .execute("DELETE FROM organization_plans WHERE task_id=?1", [task_id])
        .map_err(|_| "task-update-failed")?;
    connection.execute("UPDATE organizer_tasks SET revision=revision+1,stage=?2,status='active',updated_at=?3 WHERE id=?1",params![task_id,stage,now()]).map_err(|_|"task-update-failed")?;
    Ok(())
}

fn invalidate_after_match(connection: &Connection, task_id: &str) -> Result<(), String> {
    let unconfirmed: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM media_groups WHERE task_id=?1 AND confirmed=0",
            [task_id],
            |row| row.get(0),
        )
        .map_err(|_| "task-update-failed")?;
    invalidate_plan(
        connection,
        task_id,
        if unconfirmed == 0 {
            "episodes"
        } else {
            "match"
        },
    )
}

fn modified(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

struct NamePatterns {
    episode: Regex,
    year: Regex,
    resolution: Regex,
    edition: Regex,
    noise: Regex,
}
fn name_patterns() -> &'static NamePatterns {
    static PATTERNS: OnceLock<NamePatterns> = OnceLock::new();
    PATTERNS.get_or_init(||NamePatterns{
    episode:Regex::new(r"(?i)(?:^|[ ._\-])(?:S(\d{1,2})[ ._\-]*E(\d{1,3})(?:[ ._\-]*E?(\d{1,3}))?|(\d{1,2})x(\d{1,3}))(?:[ ._\-]|$)").expect("episode regex"),
    year:Regex::new(r"(?:^|[ ._\-(])((?:19|20)\d{2})(?:[ ._\-)]|$)").expect("year regex"),
    resolution:Regex::new(r"(?i)(2160p|1080p|720p|480p)").expect("resolution regex"),
    edition:Regex::new(r"(?i)(director'?s[ ._-]*cut|extended|remux|web[ ._-]*dl|bluray)").expect("edition regex"),
    noise:Regex::new(r"(?i)(?:^|[ ._\-])(2160p|1080p|720p|480p|uhd|hdr10\+?|dolby[ ._-]*vision|bluray|b[dr]rip|web[ ._-]?(?:dl|rip)|hdtv|remux|x26[45]|h[ ._-]?26[45]|hevc|av1|aac|dts|truehd|atmos)(?:[ ._\-]|$)").expect("noise regex")
})
}

fn is_subtitle_language(value: &str) -> bool {
    let normalized = value.to_ascii_lowercase();
    let base = normalized.split('-').next().unwrap_or(&normalized);
    SUBTITLE_LANGUAGE_CODES.contains(&base) || SUBTITLE_LANGUAGE_ALIASES.contains(&base)
}

fn subtitle_metadata_suffix(name: &str) -> Option<String> {
    let tokens: Vec<_> = name.split('.').collect();
    let mut start = tokens.len();
    let mut found_language = false;
    let mut found_flag = false;
    for token in tokens.iter().rev() {
        let normalized = token.to_ascii_lowercase();
        if SUBTITLE_FLAGS.contains(&normalized.as_str()) {
            found_flag = true;
            start -= 1;
        } else if !found_language && is_subtitle_language(token) {
            found_language = true;
            start -= 1;
        } else {
            break;
        }
    }
    (start < tokens.len() && (found_language || found_flag)).then(|| tokens[start..].join("."))
}

fn parse_media_name(name: &str) -> ParsedMedia {
    let patterns = name_patterns();
    let episode_capture = patterns.episode.captures(name);
    let year_capture = patterns.year.captures(name);
    let cut = [
        episode_capture
            .as_ref()
            .and_then(|captures| captures.get(0))
            .map(|value| value.start()),
        year_capture
            .as_ref()
            .and_then(|captures| captures.get(0))
            .map(|value| value.start()),
        patterns.noise.find(name).map(|value| value.start()),
    ]
    .into_iter()
    .flatten()
    .min()
    .unwrap_or(name.len());
    let title = safe_component(&name[..cut].replace(['.', '_'], " ").replace(" - ", " "));
    let mut episodes = Vec::new();
    let mut season = None;
    if let Some(captures) = episode_capture {
        season = captures
            .get(1)
            .or_else(|| captures.get(4))
            .and_then(|value| value.as_str().parse().ok());
        if let Some(value) = captures
            .get(2)
            .or_else(|| captures.get(5))
            .and_then(|value| value.as_str().parse().ok())
        {
            episodes.push(value);
        }
        if let Some(value) = captures
            .get(3)
            .and_then(|value| value.as_str().parse().ok())
        {
            if !episodes.contains(&value) {
                episodes.push(value);
            }
        }
    }
    ParsedMedia {
        title,
        year: year_capture
            .and_then(|captures| captures.get(1))
            .and_then(|value| value.as_str().parse().ok()),
        season,
        episodes,
        resolution: patterns
            .resolution
            .captures(name)
            .and_then(|captures| captures.get(1))
            .map(|value| value.as_str().to_ascii_lowercase()),
        edition: patterns
            .edition
            .captures(name)
            .and_then(|captures| captures.get(1))
            .map(|value| value.as_str().replace(['.', '_'], " ")),
        language_suffix: subtitle_metadata_suffix(name),
    }
}

fn safe_component(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if "<>:\"/\\|?*".contains(character) {
                ' '
            } else {
                character
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_matches('.')
        .to_string()
}

fn subtitle_format(path: &Path) -> Option<String> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    if SUBTITLE_EXTENSIONS.contains(&extension.as_str()) {
        return Some(extension);
    }
    if extension != "txt" {
        return None;
    }
    let inner_extension = Path::new(path.file_stem()?)
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase);
    if inner_extension
        .as_deref()
        .is_some_and(|value| SUBTITLE_EXTENSIONS.contains(&value))
    {
        return inner_extension;
    }
    let mut sample = Vec::new();
    fs::File::open(path)
        .ok()?
        .take(16 * 1024)
        .read_to_end(&mut sample)
        .ok()?;
    let sample = String::from_utf8_lossy(&sample);
    let normalized = sample.trim_start_matches('\u{feff}').trim_start();
    if normalized.starts_with("WEBVTT") {
        Some("vtt".into())
    } else if normalized.contains("[Script Info]")
        || normalized.lines().any(|line| line.starts_with("Dialogue:"))
    {
        Some("ass".into())
    } else if normalized.lines().any(|line| {
        line.contains(" --> ") && line.chars().filter(|character| *character == ':').count() >= 2
    }) {
        Some("srt".into())
    } else {
        None
    }
}

fn parsed_stem(path: &Path, effective_extension: &str) -> String {
    let physical_extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    if physical_extension.eq_ignore_ascii_case(effective_extension) {
        return stem.to_string();
    }
    let suffix = format!(".{effective_extension}");
    if stem.to_ascii_lowercase().ends_with(&suffix) {
        stem[..stem.len() - suffix.len()].to_string()
    } else {
        stem.to_string()
    }
}

#[cfg(test)]
fn classify(path: &Path, parsed: &ParsedMedia) -> (String, Option<String>) {
    let detected_subtitle = subtitle_format(path).is_some();
    classify_detected(path, parsed, detected_subtitle)
}

fn classify_detected(
    path: &Path,
    parsed: &ParsedMedia,
    detected_subtitle: bool,
) -> (String, Option<String>) {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if VIDEO_EXTENSIONS.contains(&extension.as_str()) {
        let extras = [
            "trailer",
            "sample",
            "featurette",
            "behindthescenes",
            "interview",
            "deleted",
            "extra",
        ];
        return (
            if extras.iter().any(|value| stem.contains(value)) {
                "extra"
            } else {
                "video"
            }
            .into(),
            if parsed.title.is_empty() {
                Some("unrecognized-name".into())
            } else {
                None
            },
        );
    }
    if detected_subtitle {
        return ("subtitle".into(), None);
    }
    if AUDIO_EXTENSIONS.contains(&extension.as_str()) {
        return ("audio".into(), None);
    }
    if IMAGE_EXTENSIONS.contains(&extension.as_str()) {
        return ("image".into(), None);
    }
    if extension == "nfo" {
        return ("nfo".into(), None);
    }
    ("unknown".into(), Some("unsupported-file".into()))
}

fn scan_directory(
    app: &tauri::AppHandle,
    task_id: &str,
    root: &Path,
    current: &Path,
    files: &mut Vec<ScannedFile>,
) -> Result<(), String> {
    for entry in fs::read_dir(current).map_err(|_| "source-read-failed")? {
        if cancelled_scans()
            .lock()
            .map_err(|_| "scan-job-failed")?
            .contains(task_id)
        {
            return Err("scan-cancelled".into());
        }
        let entry = entry.map_err(|_| "source-read-failed")?;
        let file_type = entry.file_type().map_err(|_| "source-read-failed")?;
        let path = entry.path();
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            scan_directory(app, task_id, root, &path, files)?;
            continue;
        }
        if !file_type.is_file() {
            continue;
        }
        let relative = path
            .strip_prefix(root)
            .map_err(|_| "path-outside-source")?
            .to_string_lossy()
            .replace('\\', "/");
        let metadata = entry.metadata().map_err(|_| "source-read-failed")?;
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_string();
        let physical_extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let detected_subtitle_format = subtitle_format(&path);
        let extension = detected_subtitle_format
            .as_deref()
            .unwrap_or(&physical_extension)
            .to_string();
        let parsed = parse_media_name(&parsed_stem(&path, &extension));
        let (kind, warning) = classify_detected(&path, &parsed, detected_subtitle_format.is_some());
        let id = scanned_file_id(task_id, &relative);
        files.push(ScannedFile {
            id,
            relative_path: relative.clone(),
            name,
            extension,
            kind,
            size: metadata.len(),
            modified_at: modified(&metadata),
            group_id: None,
            parsed,
            warning,
        });
        if files.len().is_multiple_of(100) {
            let _ = app.emit(
                "organizer-progress",
                ScanProgress {
                    task_id: task_id.into(),
                    scanned: files.len(),
                    current_path: relative,
                },
            );
        }
    }
    Ok(())
}

fn scan_task_sync(app: tauri::AppHandle, task_id: String) -> Result<OrganizerTask, String> {
    cancelled_scans()
        .lock()
        .map_err(|_| "scan-job-failed")?
        .remove(&task_id);
    let mut connection = open_database(&app)?;
    let task = load_task_from(&connection, &task_id)?;
    let root = PathBuf::from(validate_root(&task.source_root, "source-unavailable")?);
    let mut files = Vec::new();
    let result = scan_directory(&app, &task_id, &root, &root, &mut files);
    cancelled_scans()
        .lock()
        .map_err(|_| "scan-job-failed")?
        .remove(&task_id);
    result?;
    let transaction = connection
        .transaction()
        .map_err(|error| scan_write_error(&app, "begin transaction", error))?;
    transaction
        .execute("DELETE FROM scanned_files WHERE task_id=?1", [&task_id])
        .map_err(|error| scan_write_error(&app, "clear scanned files", error))?;
    transaction
        .execute("DELETE FROM media_groups WHERE task_id=?1", [&task_id])
        .map_err(|error| scan_write_error(&app, "clear media groups", error))?;
    transaction
        .execute("DELETE FROM episode_mappings WHERE task_id=?1", [&task_id])
        .map_err(|error| scan_write_error(&app, "clear episode mappings", error))?;
    transaction
        .execute(
            "DELETE FROM organization_plans WHERE task_id=?1",
            [&task_id],
        )
        .map_err(|error| scan_write_error(&app, "clear organization plans", error))?;
    for file in &files {
        let parsed = serde_json::to_string(&file.parsed)
            .map_err(|error| scan_write_error(&app, "serialize scan result", error))?;
        transaction.execute("INSERT INTO scanned_files(id,task_id,relative_path,name,extension,kind,size,modified_at,group_id,parsed_json,warning) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,NULL,?9,?10)",params![file.id,task_id,file.relative_path,file.name,file.extension,file.kind,file.size as i64,file.modified_at as i64,parsed,file.warning]).map_err(|error| scan_write_error(&app, "insert scanned file", error))?;
    }
    transaction.execute("UPDATE organizer_tasks SET status='active',stage='scan',revision=revision+1,updated_at=?2 WHERE id=?1",params![task_id,now()]).map_err(|error| scan_write_error(&app, "update task after scan", error))?;
    transaction
        .commit()
        .map_err(|error| scan_write_error(&app, "commit scan results", error))?;
    let _ = app.emit(
        "organizer-progress",
        ScanProgress {
            task_id: task_id.clone(),
            scanned: files.len(),
            current_path: String::new(),
        },
    );
    load_task_from(&connection, &task_id)
}

fn scan_write_error(
    app: &tauri::AppHandle,
    operation: &str,
    error: impl std::fmt::Display,
) -> String {
    let _ = app_log::record(
        app,
        "ERROR",
        "scan.database",
        &format!("{operation}: {error}"),
    );
    "database-write-failed".into()
}

#[tauri::command]
pub async fn scan_organizer_task(
    app: tauri::AppHandle,
    task_id: String,
) -> Result<OrganizerTask, String> {
    tauri::async_runtime::spawn_blocking(move || scan_task_sync(app, task_id))
        .await
        .map_err(|_| "scan-job-failed")?
}

#[tauri::command]
pub fn cancel_organizer_scan(task_id: String) -> Result<(), String> {
    cancelled_scans()
        .lock()
        .map_err(|_| "scan-job-failed")?
        .insert(task_id);
    Ok(())
}

#[tauri::command]
pub fn select_directory() -> Option<String> {
    rfd::FileDialog::new()
        .pick_folder()
        .map(|path| path.to_string_lossy().into_owned())
}

fn group_key(task: &OrganizerTask, file: &ScannedFile) -> String {
    if task.mode == "single" {
        return "single".into();
    }
    let relative = Path::new(&file.relative_path);
    let components: Vec<_> = relative.components().collect();
    if components.len() > 1 {
        return components[0]
            .as_os_str()
            .to_string_lossy()
            .to_ascii_lowercase();
    }
    format!(
        "{}-{}",
        file.parsed.title.to_ascii_lowercase(),
        file.parsed
            .year
            .map(|value| value.to_string())
            .unwrap_or_default()
    )
}

fn companion_group(
    file: &ScannedFile,
    videos: &[(ScannedFile, String)],
    single_group: Option<&str>,
) -> Option<String> {
    if let Some(group) = single_group {
        return Some(group.to_string());
    }
    let file_path = Path::new(&file.relative_path);
    let file_stem = file_path
        .file_stem()?
        .to_string_lossy()
        .to_ascii_lowercase();
    let mut ranked = Vec::new();
    for (video, group_id) in videos {
        let video_path = Path::new(&video.relative_path);
        let video_stem = video_path
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_ascii_lowercase();
        let mut score = 0;
        if file_path.parent() == video_path.parent() {
            score += 10
        }
        if file_stem.starts_with(&video_stem) || video_stem.starts_with(&file_stem) {
            score += 100
        }
        if !file.parsed.title.is_empty()
            && file.parsed.title.eq_ignore_ascii_case(&video.parsed.title)
        {
            score += 60
        }
        if file.parsed.year.is_some() && file.parsed.year == video.parsed.year {
            score += 10
        }
        if file.parsed.season.is_some()
            && file.parsed.season == video.parsed.season
            && file.parsed.episodes.first() == video.parsed.episodes.first()
        {
            score += 90
        }
        if score > 10 {
            ranked.push((score, group_id));
        }
    }
    ranked.sort_by_key(|item| std::cmp::Reverse(item.0));
    if let Some(best) = ranked.first() {
        return if ranked
            .get(1)
            .is_some_and(|next| next.0 == best.0 && next.1 != best.1)
        {
            None
        } else {
            Some(best.1.clone())
        };
    }
    let same_parent: HashSet<_> = videos
        .iter()
        .filter(|(video, _)| Path::new(&video.relative_path).parent() == file_path.parent())
        .map(|(_, group)| group.clone())
        .collect();
    if same_parent.len() == 1 {
        same_parent.into_iter().next()
    } else {
        None
    }
}

#[tauri::command]
pub fn group_organizer_task(
    app: tauri::AppHandle,
    task_id: String,
) -> Result<OrganizerTask, String> {
    let mut connection = open_database(&app)?;
    let task = load_task_from(&connection, &task_id)?;
    if task.files.is_empty() {
        return Err("scan-required".into());
    }
    let mut buckets: HashMap<String, Vec<&ScannedFile>> = HashMap::new();
    for file in task.files.iter().filter(|file| file.kind == "video") {
        buckets
            .entry(group_key(&task, file))
            .or_default()
            .push(file);
    }
    if buckets.is_empty() {
        return Err("no-media-files".into());
    }
    let transaction = connection
        .transaction()
        .map_err(|_| "database-write-failed")?;
    transaction
        .execute("DELETE FROM media_groups WHERE task_id=?1", [&task_id])
        .map_err(|_| "database-write-failed")?;
    transaction
        .execute("DELETE FROM episode_mappings WHERE task_id=?1", [&task_id])
        .map_err(|_| "database-write-failed")?;
    transaction
        .execute(
            "UPDATE scanned_files SET group_id=NULL WHERE task_id=?1",
            [&task_id],
        )
        .map_err(|_| "database-write-failed")?;
    let mut grouped_videos: Vec<(ScannedFile, String)> = Vec::new();
    for (_, bucket) in buckets {
        let group_id = new_id("group");
        let sample = bucket[0];
        let media_type = if bucket.iter().any(|file| file.parsed.season.is_some()) {
            "tv"
        } else {
            "movie"
        };
        let title = if sample.parsed.title.is_empty() {
            Path::new(&sample.relative_path)
                .parent()
                .and_then(|value| value.file_name())
                .and_then(|value| value.to_str())
                .unwrap_or("Untitled")
                .to_string()
        } else {
            sample.parsed.title.clone()
        };
        let year = bucket.iter().find_map(|file| file.parsed.year);
        let confidence = if task.mode == "single" {
            0.9
        } else if sample.parsed.year.is_some() || sample.parsed.season.is_some() {
            0.82
        } else {
            0.55
        };
        transaction.execute("INSERT INTO media_groups(id,task_id,title_guess,year,media_type,confidence,source,confirmed) VALUES(?1,?2,?3,?4,?5,?6,'local',0)",params![group_id,task_id,title,year,media_type,confidence]).map_err(|_|"database-write-failed")?;
        for file in bucket {
            transaction
                .execute(
                    "UPDATE scanned_files SET group_id=?2 WHERE id=?1",
                    params![file.id, group_id],
                )
                .map_err(|_| "database-write-failed")?;
            grouped_videos.push((file.clone(), group_id.clone()));
        }
    }
    let only_group = grouped_videos
        .first()
        .map(|(_, group)| group.as_str())
        .filter(|first| grouped_videos.iter().all(|(_, group)| group == first));
    for file in task
        .files
        .iter()
        .filter(|file| file.kind != "video" && file.kind != "unknown")
    {
        if let Some(group_id) = companion_group(file, &grouped_videos, only_group) {
            transaction
                .execute(
                    "UPDATE scanned_files SET group_id=?2 WHERE id=?1",
                    params![file.id, group_id],
                )
                .map_err(|_| "database-write-failed")?;
        }
    }
    transaction
        .execute(
            "DELETE FROM organization_plans WHERE task_id=?1",
            [&task_id],
        )
        .map_err(|_| "database-write-failed")?;
    transaction.execute("UPDATE organizer_tasks SET stage='match',revision=revision+1,updated_at=?2 WHERE id=?1",params![task_id,now()]).map_err(|_|"database-write-failed")?;
    transaction.commit().map_err(|_| "database-write-failed")?;
    load_task_from(&connection, &task_id)
}

#[tauri::command]
pub fn confirm_scan_selection(
    app: tauri::AppHandle,
    task_id: String,
    file_ids: Vec<String>,
) -> Result<OrganizerTask, String> {
    if file_ids.is_empty() {
        return Err("files-required".into());
    }
    let mut connection = open_database(&app)?;
    let task = load_task_from(&connection, &task_id)?;
    let known: HashSet<_> = task.files.iter().map(|file| file.id.as_str()).collect();
    let selected: HashSet<_> = file_ids.iter().map(String::as_str).collect();
    if selected.iter().any(|id| !known.contains(id)) {
        return Err("file-not-found".into());
    }
    if !task
        .files
        .iter()
        .any(|file| file.kind == "video" && selected.contains(file.id.as_str()))
    {
        return Err("no-media-files".into());
    }

    let transaction = connection
        .transaction()
        .map_err(|_| "database-write-failed")?;
    transaction
        .execute("DELETE FROM episode_mappings WHERE task_id=?1", [&task_id])
        .map_err(|_| "database-write-failed")?;
    transaction
        .execute("DELETE FROM media_groups WHERE task_id=?1", [&task_id])
        .map_err(|_| "database-write-failed")?;
    transaction
        .execute(
            "DELETE FROM organization_plans WHERE task_id=?1",
            [&task_id],
        )
        .map_err(|_| "database-write-failed")?;
    for file in &task.files {
        if !selected.contains(file.id.as_str()) {
            transaction
                .execute(
                    "DELETE FROM scanned_files WHERE task_id=?1 AND id=?2",
                    params![task_id, file.id],
                )
                .map_err(|_| "database-write-failed")?;
        }
    }
    transaction
        .execute(
            "UPDATE organizer_tasks SET stage='scan',revision=revision+1,updated_at=?2 WHERE id=?1",
            params![task_id, now()],
        )
        .map_err(|_| "database-write-failed")?;
    transaction.commit().map_err(|_| "database-write-failed")?;
    load_task_from(&connection, &task_id)
}

#[tauri::command]
pub fn update_media_group(
    app: tauri::AppHandle,
    task_id: String,
    group: MediaGroup,
) -> Result<OrganizerTask, String> {
    if !matches!(group.media_type.as_str(), "movie" | "tv" | "unknown") {
        return Err("media-type-invalid".into());
    }
    let mut connection = open_database(&app)?;
    let transaction = connection
        .transaction()
        .map_err(|_| "database-write-failed")?;
    let changed=transaction.execute("UPDATE media_groups SET title_guess=?3,year=?4,media_type=?5,confidence=?6,source='manual',confirmed=0,match_json=NULL WHERE id=?1 AND task_id=?2",params![group.id,task_id,safe_component(&group.title_guess),group.year,group.media_type,group.confidence]).map_err(|_|"database-write-failed")?;
    if changed == 0 {
        return Err("group-not-found".into());
    }
    transaction
        .execute(
            "DELETE FROM episode_mappings WHERE task_id=?1 AND group_id=?2",
            params![task_id, group.id],
        )
        .map_err(|_| "database-write-failed")?;
    transaction
        .execute(
            "UPDATE scanned_files SET group_id=NULL WHERE task_id=?1 AND group_id=?2",
            params![task_id, group.id],
        )
        .map_err(|_| "database-write-failed")?;
    for file_id in &group.file_ids {
        transaction
            .execute(
                "UPDATE scanned_files SET group_id=?3 WHERE task_id=?1 AND id=?2",
                params![task_id, file_id, group.id],
            )
            .map_err(|_| "database-write-failed")?;
    }
    transaction
        .execute(
            "DELETE FROM organization_plans WHERE task_id=?1",
            [&task_id],
        )
        .map_err(|_| "database-write-failed")?;
    transaction.execute("UPDATE organizer_tasks SET revision=revision+1,stage='match',updated_at=?2 WHERE id=?1",params![task_id,now()]).map_err(|_|"database-write-failed")?;
    transaction.commit().map_err(|_| "database-write-failed")?;
    load_task_from(&connection, &task_id)
}

#[tauri::command]
pub fn delete_media_group(
    app: tauri::AppHandle,
    task_id: String,
    group_id: String,
) -> Result<OrganizerTask, String> {
    let mut connection = open_database(&app)?;
    let transaction = connection
        .transaction()
        .map_err(|_| "database-write-failed")?;
    transaction
        .execute(
            "DELETE FROM episode_mappings WHERE task_id=?1 AND group_id=?2",
            params![task_id, group_id],
        )
        .map_err(|_| "database-write-failed")?;
    transaction
        .execute(
            "UPDATE scanned_files SET group_id=NULL WHERE task_id=?1 AND group_id=?2",
            params![task_id, group_id],
        )
        .map_err(|_| "database-write-failed")?;
    let deleted = transaction
        .execute(
            "DELETE FROM media_groups WHERE task_id=?1 AND id=?2",
            params![task_id, group_id],
        )
        .map_err(|_| "database-write-failed")?;
    if deleted == 0 {
        return Err("group-not-found".into());
    }
    transaction
        .execute(
            "DELETE FROM organization_plans WHERE task_id=?1",
            [&task_id],
        )
        .map_err(|_| "database-write-failed")?;
    transaction
        .execute(
            "UPDATE organizer_tasks SET revision=revision+1,stage='group',updated_at=?2 WHERE id=?1",
            params![task_id, now()],
        )
        .map_err(|_| "database-write-failed")?;
    transaction.commit().map_err(|_| "database-write-failed")?;
    load_task_from(&connection, &task_id)
}

#[tauri::command]
pub fn create_media_group(
    app: tauri::AppHandle,
    task_id: String,
    title: String,
    media_type: String,
    file_ids: Vec<String>,
) -> Result<OrganizerTask, String> {
    let mut connection = open_database(&app)?;
    let id = new_id("group");
    let transaction = connection
        .transaction()
        .map_err(|_| "database-write-failed")?;
    transaction.execute("INSERT INTO media_groups(id,task_id,title_guess,media_type,confidence,source,confirmed) VALUES(?1,?2,?3,?4,1.0,'manual',0)",params![id,task_id,safe_component(&title),media_type]).map_err(|_|"database-write-failed")?;
    for file_id in file_ids {
        transaction
            .execute(
                "UPDATE scanned_files SET group_id=?3 WHERE task_id=?1 AND id=?2",
                params![task_id, file_id, id],
            )
            .map_err(|_| "database-write-failed")?;
    }
    transaction.commit().map_err(|_| "database-write-failed")?;
    invalidate_plan(&connection, &task_id, "match")?;
    load_task_from(&connection, &task_id)
}

#[tauri::command]
pub fn move_files_to_group(
    app: tauri::AppHandle,
    task_id: String,
    file_ids: Vec<String>,
    group_id: String,
) -> Result<OrganizerTask, String> {
    if file_ids.is_empty() {
        return Err("files-required".into());
    }
    let mut connection = open_database(&app)?;
    let exists: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM media_groups WHERE task_id=?1 AND id=?2",
            params![task_id, group_id],
            |row| row.get(0),
        )
        .map_err(|_| "group-not-found")?;
    if exists == 0 {
        return Err("group-not-found".into());
    }
    let transaction = connection
        .transaction()
        .map_err(|_| "database-write-failed")?;
    let mut affected = HashSet::from([group_id.clone()]);
    for file_id in file_ids {
        let previous: Option<String> = transaction
            .query_row(
                "SELECT group_id FROM scanned_files WHERE task_id=?1 AND id=?2",
                params![task_id, file_id],
                |row| row.get(0),
            )
            .map_err(|_| "file-not-found")?;
        if let Some(previous) = previous {
            affected.insert(previous);
        }
        transaction
            .execute(
                "UPDATE scanned_files SET group_id=?3 WHERE task_id=?1 AND id=?2",
                params![task_id, file_id, group_id],
            )
            .map_err(|_| "database-write-failed")?;
    }
    for id in &affected {
        transaction.execute("UPDATE media_groups SET confirmed=0,match_json=NULL,source='manual' WHERE task_id=?1 AND id=?2",params![task_id,id]).map_err(|_|"database-write-failed")?;
        transaction
            .execute(
                "DELETE FROM episode_mappings WHERE task_id=?1 AND group_id=?2",
                params![task_id, id],
            )
            .map_err(|_| "database-write-failed")?;
    }
    transaction.execute("DELETE FROM media_groups WHERE task_id=?1 AND id NOT IN (SELECT DISTINCT group_id FROM scanned_files WHERE task_id=?1 AND group_id IS NOT NULL)",[&task_id]).map_err(|_|"database-write-failed")?;
    transaction
        .execute(
            "DELETE FROM organization_plans WHERE task_id=?1",
            [&task_id],
        )
        .map_err(|_| "database-write-failed")?;
    transaction.execute("UPDATE organizer_tasks SET revision=revision+1,stage='match',updated_at=?2 WHERE id=?1",params![task_id,now()]).map_err(|_|"database-write-failed")?;
    transaction.commit().map_err(|_| "database-write-failed")?;
    load_task_from(&connection, &task_id)
}

#[tauri::command]
pub fn apply_ai_grouping(
    app: tauri::AppHandle,
    task_id: String,
    proposals: Vec<AiGroupingProposal>,
) -> Result<OrganizerTask, String> {
    let mut connection = open_database(&app)?;
    let task = load_task_from(&connection, &task_id)?;
    let proposals = reconcile_ai_companions(&task, proposals);
    let known: HashSet<_> = task.files.iter().map(|file| file.id.as_str()).collect();
    let mut assigned = HashSet::new();
    for proposal in &proposals {
        if proposal.title.trim().is_empty()
            || !matches!(proposal.media_type.as_str(), "movie" | "tv" | "unknown")
            || proposal.file_ids.is_empty()
            || proposal
                .file_ids
                .iter()
                .any(|id| !known.contains(id.as_str()) || !assigned.insert(id.clone()))
        {
            return Err("ai-grouping-invalid".into());
        }
    }
    let transaction = connection
        .transaction()
        .map_err(|_| "database-write-failed")?;
    for file in task.files.iter().filter(|file| file.kind == "unknown") {
        if let Some(format) = inferred_subtitle_format(&task, file) {
            transaction
                .execute(
                    "UPDATE scanned_files SET kind='subtitle',extension=?3,warning=NULL WHERE task_id=?1 AND id=?2",
                    params![task_id, file.id, format],
                )
                .map_err(|_| "database-write-failed")?;
        }
    }
    for proposal in proposals {
        let group_id = new_id("group");
        transaction.execute("INSERT INTO media_groups(id,task_id,title_guess,year,media_type,confidence,source,confirmed) VALUES(?1,?2,?3,?4,?5,?6,'ai',0)",params![group_id,task_id,safe_component(&proposal.title),proposal.year,proposal.media_type,proposal.confidence.clamp(0.0,1.0)]).map_err(|_|"database-write-failed")?;
        for file_id in proposal.file_ids {
            transaction
                .execute(
                    "UPDATE scanned_files SET group_id=?3 WHERE task_id=?1 AND id=?2",
                    params![task_id, file_id, group_id],
                )
                .map_err(|_| "database-write-failed")?;
        }
    }
    transaction.execute("DELETE FROM media_groups WHERE task_id=?1 AND id NOT IN (SELECT DISTINCT group_id FROM scanned_files WHERE task_id=?1 AND group_id IS NOT NULL)",[&task_id]).map_err(|_|"database-write-failed")?;
    transaction.commit().map_err(|_| "database-write-failed")?;
    invalidate_plan(&connection, &task_id, "match")?;
    load_task_from(&connection, &task_id)
}

pub(crate) fn reconcile_ai_companions(
    task: &OrganizerTask,
    mut proposals: Vec<AiGroupingProposal>,
) -> Vec<AiGroupingProposal> {
    let proposal_index_by_file: HashMap<_, _> = proposals
        .iter()
        .enumerate()
        .flat_map(|(index, proposal)| {
            proposal
                .file_ids
                .iter()
                .map(move |file_id| (file_id.as_str(), index))
        })
        .collect();
    let grouped_videos: Vec<_> = task
        .files
        .iter()
        .filter(|file| file.kind == "video")
        .filter_map(|file| {
            proposal_index_by_file
                .get(file.id.as_str())
                .map(|index| (file.clone(), index.to_string()))
        })
        .collect();
    if grouped_videos.is_empty() {
        return proposals;
    }
    let eligible_companions: Vec<_> = task
        .files
        .iter()
        .filter(|file| {
            matches!(
                file.kind.as_str(),
                "subtitle" | "audio" | "image" | "nfo" | "extra"
            ) || (file.kind == "unknown" && inferred_subtitle_format(task, file).is_some())
        })
        .filter(|file| {
            proposal_index_by_file.contains_key(file.id.as_str())
                || file.group_id.is_none()
                || file.group_id.as_deref().is_some_and(|group_id| {
                    task.groups
                        .iter()
                        .find(|group| group.id == group_id)
                        .is_some_and(|group| group.confidence < 0.75)
                })
        })
        .filter_map(|file| {
            companion_group(file, &grouped_videos, None)
                .and_then(|index| index.parse::<usize>().ok())
                .map(|index| (file.id.clone(), index))
        })
        .collect();
    for (file_id, target_index) in eligible_companions {
        for proposal in &mut proposals {
            proposal.file_ids.retain(|id| id != &file_id);
        }
        if let Some(target) = proposals.get_mut(target_index) {
            if !target.file_ids.contains(&file_id) {
                target.file_ids.push(file_id);
            }
        }
    }
    proposals.retain(|proposal| !proposal.file_ids.is_empty());
    proposals
}

fn inferred_subtitle_format(task: &OrganizerTask, file: &ScannedFile) -> Option<String> {
    if file.kind == "subtitle" {
        return Some(file.extension.clone());
    }
    subtitle_format(&Path::new(&task.source_root).join(&file.relative_path))
        .or_else(|| subtitle_format(Path::new(&file.name)))
}

fn natural_path_cmp(left: &str, right: &str) -> CmpOrdering {
    let left = left.to_lowercase();
    let right = right.to_lowercase();
    let left = left.as_bytes();
    let right = right.as_bytes();
    let (mut left_index, mut right_index) = (0, 0);
    while left_index < left.len() && right_index < right.len() {
        if left[left_index].is_ascii_digit() && right[right_index].is_ascii_digit() {
            let mut left_end = left_index;
            let mut right_end = right_index;
            while left_end < left.len() && left[left_end].is_ascii_digit() {
                left_end += 1;
            }
            while right_end < right.len() && right[right_end].is_ascii_digit() {
                right_end += 1;
            }
            let left_number = &left[left_index..left_end];
            let right_number = &right[right_index..right_end];
            let left_significant = left_number
                .iter()
                .position(|byte| *byte != b'0')
                .map(|index| &left_number[index..])
                .unwrap_or(&left_number[left_number.len().saturating_sub(1)..]);
            let right_significant = right_number
                .iter()
                .position(|byte| *byte != b'0')
                .map(|index| &right_number[index..])
                .unwrap_or(&right_number[right_number.len().saturating_sub(1)..]);
            let comparison = left_significant
                .len()
                .cmp(&right_significant.len())
                .then_with(|| left_significant.cmp(right_significant));
            if comparison != CmpOrdering::Equal {
                return comparison;
            }
            left_index = left_end;
            right_index = right_end;
            continue;
        }
        let comparison = left[left_index].cmp(&right[right_index]);
        if comparison != CmpOrdering::Equal {
            return comparison;
        }
        left_index += 1;
        right_index += 1;
    }
    left.len().cmp(&right.len())
}

fn initialize_episode_mappings(
    connection: &Connection,
    task_id: &str,
    group_id: &str,
    media_type: &str,
) -> Result<(), String> {
    connection
        .execute(
            "DELETE FROM episode_mappings WHERE task_id=?1 AND group_id=?2",
            params![task_id, group_id],
        )
        .map_err(|_| "database-write-failed")?;
    if media_type != "tv" {
        return Ok(());
    }
    let task = load_task_from(connection, task_id)?;
    let group = task
        .groups
        .iter()
        .find(|group| group.id == group_id)
        .ok_or("group-not-found")?;
    let mut videos: Vec<_> = task
        .files
        .iter()
        .filter(|file| group.file_ids.contains(&file.id) && file.kind == "video")
        .collect();
    videos.sort_by(|left, right| natural_path_cmp(&left.relative_path, &right.relative_path));
    let default_season = videos
        .iter()
        .find_map(|file| file.parsed.season)
        .unwrap_or(1);
    let mut occupied: HashMap<u16, HashSet<u16>> = HashMap::new();
    for file in &videos {
        if let Some(episode) = file
            .parsed
            .episodes
            .first()
            .copied()
            .filter(|value| *value > 0)
        {
            occupied
                .entry(file.parsed.season.unwrap_or(default_season))
                .or_default()
                .insert(episode);
        }
    }
    for file in videos {
        let season = file.parsed.season.unwrap_or(default_season);
        let episode = if let Some(value) = file
            .parsed
            .episodes
            .first()
            .copied()
            .filter(|value| *value > 0)
        {
            value
        } else {
            let used = occupied.entry(season).or_default();
            let mut value = 1;
            while used.contains(&value) {
                value += 1;
            }
            used.insert(value);
            value
        };
        let episode_end = file
            .parsed
            .episodes
            .get(1)
            .copied()
            .filter(|value| *value >= episode);
        connection.execute("INSERT INTO episode_mappings(task_id,group_id,file_id,season,episode,episode_end,title,confirmed) VALUES(?1,?2,?3,?4,?5,?6,'',0)",params![task_id,group_id,file.id,season,episode,episode_end]).map_err(|_|"database-write-failed")?;
    }
    Ok(())
}

#[tauri::command]
pub fn confirm_tmdb_match(
    app: tauri::AppHandle,
    task_id: String,
    group_id: String,
    candidate: TmdbCandidate,
    title_mode: String,
    language: String,
    manual_title: Option<String>,
) -> Result<OrganizerTask, String> {
    let connection = open_database(&app)?;
    let display_title = match title_mode.as_str() {
        "original" => candidate.original_title.clone(),
        "manual" => manual_title
            .filter(|value| !value.trim().is_empty())
            .ok_or("manual-title-required")?,
        _ => candidate.title.clone(),
    };
    let matched = ConfirmedMatch {
        candidate: candidate.clone(),
        display_title: safe_component(&display_title),
        source: "tmdb".into(),
        language: (!language.trim().is_empty() && language.len() <= 20).then_some(language),
        confirmed_at: now(),
    };
    let changed=connection.execute("UPDATE media_groups SET title_guess=?3,year=?4,media_type=?5,confirmed=1,match_json=?6 WHERE task_id=?1 AND id=?2",params![task_id,group_id,matched.display_title,candidate.year,candidate.media_type,serde_json::to_string(&matched).map_err(|_|"database-write-failed")?]).map_err(|_|"database-write-failed")?;
    if changed == 0 {
        return Err("group-not-found".into());
    }
    initialize_episode_mappings(&connection, &task_id, &group_id, &candidate.media_type)?;
    invalidate_after_match(&connection, &task_id)?;
    load_task_from(&connection, &task_id)
}

#[tauri::command]
pub fn confirm_manual_match(
    app: tauri::AppHandle,
    task_id: String,
    group_id: String,
    title: String,
    year: Option<u16>,
    media_type: String,
) -> Result<OrganizerTask, String> {
    if !matches!(media_type.as_str(), "movie" | "tv") {
        return Err("media-type-invalid".into());
    }
    let candidate = TmdbCandidate {
        id: 0,
        media_type: media_type.clone(),
        title: title.clone(),
        original_title: title.clone(),
        year,
        overview: String::new(),
        poster_path: None,
        vote_average: 0.0,
    };
    let connection = open_database(&app)?;
    let matched = ConfirmedMatch {
        candidate: candidate.clone(),
        display_title: safe_component(&title),
        source: "manual".into(),
        language: None,
        confirmed_at: now(),
    };
    let changed=connection.execute("UPDATE media_groups SET title_guess=?3,year=?4,media_type=?5,confirmed=1,match_json=?6 WHERE task_id=?1 AND id=?2",params![task_id,group_id,matched.display_title,year,candidate.media_type,serde_json::to_string(&matched).map_err(|_|"database-write-failed")?]).map_err(|_|"database-write-failed")?;
    if changed == 0 {
        return Err("group-not-found".into());
    }
    initialize_episode_mappings(&connection, &task_id, &group_id, &media_type)?;
    invalidate_after_match(&connection, &task_id)?;
    load_task_from(&connection, &task_id)
}

#[tauri::command]
pub fn update_episode_mappings(
    app: tauri::AppHandle,
    task_id: String,
    group_id: String,
    mappings: Vec<EpisodeMapping>,
) -> Result<OrganizerTask, String> {
    let mut connection = open_database(&app)?;
    let task = load_task_from(&connection, &task_id)?;
    let group = task
        .groups
        .iter()
        .find(|group| group.id == group_id && group.media_type == "tv" && group.confirmed)
        .ok_or("group-not-found")?;
    let video_ids: HashSet<_> = task
        .files
        .iter()
        .filter(|file| file.kind == "video" && group.file_ids.contains(&file.id))
        .map(|file| file.id.clone())
        .collect();
    let mut seen = HashSet::new();
    if mappings.iter().any(|mapping| {
        !video_ids.contains(&mapping.file_id)
            || !seen.insert(mapping.file_id.clone())
            || mapping.episode == 0
            || mapping.episode_end.is_some_and(|end| end < mapping.episode)
    }) {
        return Err("episode-mapping-invalid".into());
    }
    let transaction = connection
        .transaction()
        .map_err(|_| "database-write-failed")?;
    transaction
        .execute(
            "DELETE FROM episode_mappings WHERE task_id=?1 AND group_id=?2",
            params![task_id, group_id],
        )
        .map_err(|_| "database-write-failed")?;
    for mapping in mappings {
        transaction.execute("INSERT INTO episode_mappings(task_id,group_id,file_id,season,episode,episode_end,title,confirmed) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",params![task_id,group_id,mapping.file_id,mapping.season,mapping.episode,mapping.episode_end,safe_component(&mapping.title),mapping.confirmed as i64]).map_err(|_|"database-write-failed")?;
    }
    transaction.commit().map_err(|_| "database-write-failed")?;
    invalidate_plan(&connection, &task_id, "episodes")?;
    load_task_from(&connection, &task_id)
}

fn valid_episode_naming_format(value: &str) -> bool {
    matches!(
        value,
        "series-year-title" | "series-title" | "episode-title" | "series-compact"
    )
}

#[tauri::command]
pub fn update_episode_naming_format(
    app: tauri::AppHandle,
    task_id: String,
    naming_format: String,
) -> Result<OrganizerTask, String> {
    if !valid_episode_naming_format(&naming_format) {
        return Err("episode-naming-format-invalid".into());
    }
    let mut connection = open_database(&app)?;
    let current = connection
        .query_row(
            "SELECT episode_naming_format FROM organizer_tasks WHERE id=?1 AND archived=0",
            [&task_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|_| "task-load-failed")?
        .ok_or("task-not-found")?;
    if current == naming_format {
        return load_task_from(&connection, &task_id);
    }
    let transaction = connection
        .transaction()
        .map_err(|_| "database-write-failed")?;
    transaction
        .execute(
            "UPDATE organizer_tasks SET episode_naming_format=?2 WHERE id=?1",
            params![task_id, naming_format],
        )
        .map_err(|_| "task-update-failed")?;
    transaction
        .execute(
            "DELETE FROM organization_plans WHERE task_id=?1",
            [&task_id],
        )
        .map_err(|_| "task-update-failed")?;
    transaction.execute("UPDATE organizer_tasks SET revision=revision+1,stage='episodes',status='active',updated_at=?2 WHERE id=?1",params![task_id,now()]).map_err(|_|"task-update-failed")?;
    transaction.commit().map_err(|_| "database-write-failed")?;
    load_task_from(&connection, &task_id)
}

fn version_label(file: &ScannedFile, index: usize) -> String {
    let mut parts = Vec::new();
    if let Some(edition) = &file.parsed.edition {
        parts.push(edition.clone())
    }
    if let Some(resolution) = &file.parsed.resolution {
        parts.push(resolution.clone())
    }
    if parts.is_empty() {
        format!("Version {}", index + 1)
    } else {
        safe_component(&parts.join(" "))
    }
}

fn target_for_video(
    task: &OrganizerTask,
    group: &MediaGroup,
    file: &ScannedFile,
    index: usize,
) -> Result<PathBuf, String> {
    let matched = group
        .matched
        .as_ref()
        .filter(|_| group.confirmed)
        .ok_or("match-confirmation-required")?;
    let year = group
        .year
        .map(|value| format!(" ({value})"))
        .unwrap_or_default();
    let provider = if matched.candidate.id > 0 {
        format!(" [tmdbid-{}]", matched.candidate.id)
    } else {
        String::new()
    };
    let title = safe_component(&matched.display_title);
    let folder = format!("{title}{year}{provider}");
    if group.media_type == "movie" {
        let video_count = group
            .file_ids
            .iter()
            .filter(|id| {
                task.files
                    .iter()
                    .any(|item| &item.id == *id && item.kind == "video")
            })
            .count();
        let version = if video_count > 1 {
            format!(" - {}", version_label(file, index))
        } else {
            String::new()
        };
        return Ok(PathBuf::from(&task.movie_root)
            .join(&folder)
            .join(format!("{folder}{version}.{}", file.extension)));
    }
    if group.media_type == "tv" {
        let mapping = group
            .episode_mappings
            .iter()
            .find(|mapping| mapping.file_id == file.id && mapping.confirmed)
            .ok_or("episode-confirmation-required")?;
        let episode = if let Some(end) = mapping.episode_end {
            format!("S{:02}E{:02}-E{:02}", mapping.season, mapping.episode, end)
        } else {
            format!("S{:02}E{:02}", mapping.season, mapping.episode)
        };
        let episode_title = if mapping.title.is_empty() {
            String::new()
        } else {
            format!(" - {}", safe_component(&mapping.title))
        };
        let same_episode_count = group
            .episode_mappings
            .iter()
            .filter(|other| {
                other.confirmed
                    && other.season == mapping.season
                    && other.episode == mapping.episode
            })
            .count();
        let version = if same_episode_count > 1 {
            format!(" - {}", version_label(file, index))
        } else {
            String::new()
        };
        let filename = match task.episode_naming_format.as_str() {
            "series-title" => format!(
                "{title} {episode}{episode_title}{version}.{}",
                file.extension
            ),
            "episode-title" => format!("{episode}{episode_title}{version}.{}", file.extension),
            "series-compact" => format!("{title} {episode}{version}.{}", file.extension),
            _ => format!(
                "{title}{year} {episode}{episode_title}{version}.{}",
                file.extension
            ),
        };
        return Ok(PathBuf::from(&task.show_root)
            .join(&folder)
            .join(format!("Season {:02}", mapping.season))
            .join(filename));
    }
    Err("media-type-required".into())
}

fn companion_target(
    _task: &OrganizerTask,
    group: &MediaGroup,
    file: &ScannedFile,
    video_targets: &[(ScannedFile, PathBuf)],
) -> Option<PathBuf> {
    let source_path = Path::new(&file.relative_path);
    let source_stem = parsed_stem(source_path, &file.extension);
    let source_stem = source_stem.as_str();
    let generic_art = matches!(
        source_stem.to_ascii_lowercase().as_str(),
        "poster" | "folder" | "cover" | "movie" | "backdrop" | "fanart" | "logo" | "banner"
    );
    let generic_nfo = file.kind == "nfo"
        && matches!(
            source_stem.to_ascii_lowercase().as_str(),
            "movie" | "tvshow"
        );
    if generic_art || generic_nfo {
        let (_, target) = video_targets.first()?;
        let title_folder = if group.media_type == "tv" {
            target.parent()?.parent()?
        } else {
            target.parent()?
        };
        return Some(title_folder.join(&file.name));
    }
    if file.kind == "extra" {
        let (_, target) = video_targets.first()?;
        let title_folder = if group.media_type == "tv" {
            target.parent()?.parent()?
        } else {
            target.parent()?
        };
        return Some(title_folder.join("extras").join(&file.name));
    }
    let same_folder: Vec<_> = video_targets
        .iter()
        .filter(|(video, _)| source_path.parent() == Path::new(&video.relative_path).parent())
        .collect();
    let (video, target) = same_folder
        .iter()
        .copied()
        .find(|(video, _)| {
            let video_stem = Path::new(&video.relative_path)
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("");
            source_stem.starts_with(video_stem)
                || (file.parsed.season.is_some()
                    && file.parsed.season == video.parsed.season
                    && file.parsed.episodes.first() == video.parsed.episodes.first())
                || (!file.parsed.title.is_empty()
                    && file.parsed.title.eq_ignore_ascii_case(&video.parsed.title))
        })
        .or_else(|| {
            if same_folder.len() == 1 {
                same_folder.first().copied()
            } else {
                None
            }
        })?;
    let video_stem = Path::new(&video.relative_path).file_stem()?.to_str()?;
    let suffix = source_stem
        .strip_prefix(video_stem)
        .map(str::to_string)
        .or_else(|| {
            file.parsed
                .language_suffix
                .as_ref()
                .map(|value| format!(".{value}"))
        })
        .unwrap_or_default();
    let suffix = if file.kind == "subtitle" {
        normalize_subtitle_suffix(&suffix)
    } else {
        suffix
    };
    let target_stem = target.file_stem()?.to_str()?;
    Some(
        target
            .parent()?
            .join(format!("{target_stem}{suffix}.{}", file.extension)),
    )
}

fn normalize_subtitle_suffix(suffix: &str) -> String {
    let normalized = suffix
        .trim_start_matches('.')
        .split('.')
        .filter(|value| !value.is_empty())
        .map(|value| match value.to_ascii_lowercase().as_str() {
            "sc" | "gb" | "chs" => "zh-Hans".to_string(),
            "tc" | "big5" | "cht" => "zh-Hant".to_string(),
            _ => value.to_string(),
        })
        .collect::<Vec<_>>()
        .join(".");
    if normalized.is_empty() {
        String::new()
    } else {
        format!(".{normalized}")
    }
}

#[tauri::command]
pub fn generate_organization_plan(
    app: tauri::AppHandle,
    task_id: String,
) -> Result<OrganizerTask, String> {
    let mut connection = open_database(&app)?;
    let task = load_task_from(&connection, &task_id)?;
    if task.groups.is_empty() {
        return Err("grouping-required".into());
    }
    if task.groups.iter().any(|group| !group.confirmed) {
        return Err("match-confirmation-required".into());
    }
    let plan_id = new_id("plan");
    let mut operations = Vec::new();
    let mut seen = HashSet::new();
    for group in &task.groups {
        let videos: Vec<_> = task
            .files
            .iter()
            .filter(|file| {
                file.group_id.as_deref() == Some(group.id.as_str()) && file.kind == "video"
            })
            .cloned()
            .collect();
        let mut video_targets = Vec::new();
        for (index, file) in videos.iter().enumerate() {
            video_targets.push((file.clone(), target_for_video(&task, group, file, index)?));
        }
        for file in task
            .files
            .iter()
            .filter(|file| file.group_id.as_deref() == Some(group.id.as_str()))
        {
            let source = Path::new(&task.source_root).join(&file.relative_path);
            let target = if file.kind == "video" {
                video_targets
                    .iter()
                    .find(|(video, _)| video.id == file.id)
                    .map(|(_, target)| target.clone())
            } else if file.kind == "unknown" {
                None
            } else {
                companion_target(&task, group, file, &video_targets)
            };
            let Some(target) = target else {
                operations.push(FileOperation {
                    id: new_id("op"),
                    group_id: group.id.clone(),
                    source: source.to_string_lossy().into_owned(),
                    target: String::new(),
                    operation: task.operation.clone(),
                    selected: false,
                    size: file.size,
                    modified_at: file.modified_at,
                    status: "skipped".into(),
                    reason: file
                        .warning
                        .clone()
                        .or_else(|| Some("companion-unmatched".into())),
                });
                continue;
            };
            let root = if group.media_type == "tv" {
                Path::new(&task.show_root)
            } else {
                Path::new(&task.movie_root)
            };
            let path_error = secure_target(&target, root).err();
            let duplicate = !seen.insert(target.clone());
            let reason = path_error.or_else(|| {
                if target.exists() {
                    Some("target-exists".into())
                } else if duplicate {
                    Some("duplicate-target".into())
                } else {
                    None
                }
            });
            let conflict = reason.is_some();
            operations.push(FileOperation {
                id: new_id("op"),
                group_id: group.id.clone(),
                source: source.to_string_lossy().into_owned(),
                target: target.to_string_lossy().into_owned(),
                operation: task.operation.clone(),
                selected: !conflict,
                size: file.size,
                modified_at: file.modified_at,
                status: if conflict { "conflict" } else { "planned" }.into(),
                reason,
            });
        }
    }
    for file in task.files.iter().filter(|file| file.group_id.is_none()) {
        operations.push(FileOperation {
            id: new_id("op"),
            group_id: String::new(),
            source: Path::new(&task.source_root)
                .join(&file.relative_path)
                .to_string_lossy()
                .into_owned(),
            target: String::new(),
            operation: task.operation.clone(),
            selected: false,
            size: file.size,
            modified_at: file.modified_at,
            status: "skipped".into(),
            reason: Some("unassigned-file".into()),
        });
    }
    let transaction = connection
        .transaction()
        .map_err(|_| "database-write-failed")?;
    transaction
        .execute(
            "DELETE FROM organization_plans WHERE task_id=?1",
            [&task_id],
        )
        .map_err(|_| "database-write-failed")?;
    transaction.execute("INSERT INTO organization_plans(id,task_id,task_revision,created_at,status) VALUES(?1,?2,?3,?4,'ready')",params![plan_id,task_id,task.revision,now()]).map_err(|_|"database-write-failed")?;
    for item in operations {
        transaction.execute("INSERT INTO file_operations(id,plan_id,group_id,source,target,operation,selected,size,modified_at,status,reason) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",params![item.id,plan_id,item.group_id,item.source,item.target,item.operation,item.selected as i64,item.size as i64,item.modified_at as i64,item.status,item.reason]).map_err(|_|"database-write-failed")?;
    }
    transaction
        .execute(
            "UPDATE organizer_tasks SET stage='plan',updated_at=?2 WHERE id=?1",
            params![task_id, now()],
        )
        .map_err(|_| "database-write-failed")?;
    transaction.commit().map_err(|_| "database-write-failed")?;
    load_task_from(&connection, &task_id)
}

pub(crate) fn load_plan_from(
    connection: &Connection,
    plan_id: &str,
) -> Result<OrganizationPlan, String> {
    let base = connection
        .query_row(
            "SELECT id,task_id,task_revision,created_at,status FROM organization_plans WHERE id=?1",
            [plan_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)? as u64,
                    row.get::<_, i64>(3)? as u64,
                    row.get::<_, String>(4)?,
                ))
            },
        )
        .map_err(|_| "plan-not-found")?;
    let mut statement=connection.prepare("SELECT id,group_id,source,target,operation,selected,size,modified_at,status,reason FROM file_operations WHERE plan_id=?1 ORDER BY group_id,source").map_err(|_|"plan-load-failed")?;
    let operations = statement
        .query_map([plan_id], |row| {
            Ok(FileOperation {
                id: row.get(0)?,
                group_id: row.get(1)?,
                source: row.get(2)?,
                target: row.get(3)?,
                operation: row.get(4)?,
                selected: row.get::<_, i64>(5)? != 0,
                size: row.get::<_, i64>(6)? as u64,
                modified_at: row.get::<_, i64>(7)? as u64,
                status: row.get(8)?,
                reason: row.get(9)?,
            })
        })
        .map_err(|_| "plan-load-failed")?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "plan-load-failed")?;
    Ok(OrganizationPlan {
        id: base.0,
        task_id: base.1,
        task_revision: base.2,
        created_at: base.3,
        status: base.4,
        operations,
    })
}

#[tauri::command]
pub fn update_plan_operation(
    app: tauri::AppHandle,
    task_id: String,
    operation_id: String,
    selected: bool,
    target: Option<String>,
) -> Result<OrganizerTask, String> {
    let connection = open_database(&app)?;
    let task = load_task_from(&connection, &task_id)?;
    let plan = task.plan.as_ref().ok_or("plan-not-found")?;
    let item = plan
        .operations
        .iter()
        .find(|item| item.id == operation_id)
        .ok_or("operation-not-found")?;
    let next_target = target.unwrap_or_else(|| item.target.clone());
    let root = if task
        .groups
        .iter()
        .find(|group| group.id == item.group_id)
        .is_some_and(|group| group.media_type == "tv")
    {
        &task.show_root
    } else {
        &task.movie_root
    };
    secure_target(Path::new(&next_target), Path::new(root))?;
    if Path::new(&next_target).exists() {
        return Err("target-exists".into());
    }
    let duplicate: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM file_operations WHERE plan_id=?1 AND id<>?2 AND target=?3",
            params![plan.id, operation_id, next_target],
            |row| row.get(0),
        )
        .map_err(|_| "database-read-failed")?;
    if duplicate > 0 {
        return Err("duplicate-target".into());
    }
    connection.execute("UPDATE file_operations SET selected=?2,target=?3,status='planned',reason=NULL WHERE id=?1",params![operation_id,selected as i64,next_target]).map_err(|_|"database-write-failed")?;
    load_task_from(&connection, &task_id)
}

fn lexically_within(path: &Path, root: &Path) -> bool {
    if !path.is_absolute() || !root.is_absolute() {
        return false;
    }
    if path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return false;
    }
    path.starts_with(root)
}
fn secure_target(path: &Path, root: &Path) -> Result<(), String> {
    if !lexically_within(path, root) {
        return Err("target-outside-root".into());
    }
    let canonical_root = root.canonicalize().map_err(|_| "target-root-unavailable")?;
    let mut ancestor = path.parent().ok_or("target-invalid")?;
    while !ancestor.exists() {
        ancestor = ancestor.parent().ok_or("target-invalid")?
    }
    let canonical_ancestor = ancestor.canonicalize().map_err(|_| "target-invalid")?;
    if !canonical_ancestor.starts_with(canonical_root) {
        return Err("target-outside-root".into());
    }
    Ok(())
}
fn hash_file(path: &Path) -> Result<blake3::Hash, String> {
    let mut file = fs::File::open(path).map_err(|_| "source-read-failed")?;
    let mut hasher = blake3::Hasher::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(|_| "source-read-failed")?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(hasher.finalize())
}
fn transfer_file(source: &Path, target: &Path, operation: &str) -> Result<(), String> {
    if target.exists() {
        return Err("target-exists".into());
    }
    fs::create_dir_all(target.parent().ok_or("target-invalid")?)
        .map_err(|_| "target-create-failed")?;
    if operation == "move" && fs::rename(source, target).is_ok() {
        return Ok(());
    }
    let temporary = target.with_extension(format!(
        "{}.jellysmith.tmp",
        target
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("file")
    ));
    if temporary.exists() {
        fs::remove_file(&temporary).map_err(|_| "temporary-cleanup-failed")?
    }
    fs::copy(source, &temporary).map_err(|_| "copy-failed")?;
    if hash_file(source)? != hash_file(&temporary)? {
        let _ = fs::remove_file(&temporary);
        return Err("copy-verification-failed".into());
    }
    fs::rename(&temporary, target).map_err(|_| "target-commit-failed")?;
    if operation == "move" && fs::remove_file(source).is_err() {
        let _ = fs::remove_file(target);
        return Err("source-delete-failed".into());
    }
    Ok(())
}
fn record_log(
    connection: &Connection,
    execution_id: &str,
    operation_id: &str,
    level: &str,
    code: &str,
    message: &str,
) {
    let _=connection.execute("INSERT INTO operation_logs(execution_id,operation_id,time,level,code,message) VALUES(?1,?2,?3,?4,?5,?6)",params![execution_id,operation_id,now(),level,code,message]);
}

fn execute_plan_sync(app: tauri::AppHandle, task_id: String) -> Result<RunResult, String> {
    let connection = open_database(&app)?;
    let task = load_task_from(&connection, &task_id)?;
    let plan = task.plan.clone().ok_or("plan-not-found")?;
    if plan.task_revision != task.revision {
        return Err("plan-expired".into());
    }
    let groups: HashSet<_> = plan
        .operations
        .iter()
        .filter(|item| item.selected && item.status == "planned")
        .map(|item| item.group_id.clone())
        .collect();
    if groups.is_empty() {
        return Err("operations-required".into());
    }
    let execution_id = new_id("execution");
    let started = now();
    connection.execute("INSERT INTO execution_records(id,task_id,plan_id,status,started_at) VALUES(?1,?2,?3,'running',?4)",params![execution_id,task_id,plan.id,started]).map_err(|_|"database-write-failed")?;
    let mut logs = Vec::new();
    let mut failed = false;
    for group_id in groups {
        let items: Vec<_> = plan
            .operations
            .iter()
            .filter(|item| item.group_id == group_id && item.selected && item.status == "planned")
            .cloned()
            .collect();
        let root = if task
            .groups
            .iter()
            .find(|group| group.id == group_id)
            .is_some_and(|group| group.media_type == "tv")
        {
            Path::new(&task.show_root)
        } else {
            Path::new(&task.movie_root)
        };
        let mut completed: Vec<FileOperation> = Vec::new();
        let mut group_error = None;
        for item in &items {
            let source = Path::new(&item.source);
            let target = Path::new(&item.target);
            let metadata = match fs::metadata(source) {
                Ok(value) => value,
                Err(_) => {
                    group_error = Some((item.id.clone(), "source-changed".to_string()));
                    break;
                }
            };
            if metadata.len() != item.size || modified(&metadata) != item.modified_at {
                group_error = Some((item.id.clone(), "source-changed".into()));
                break;
            }
            if let Err(code) = secure_target(target, root) {
                group_error = Some((item.id.clone(), code));
                break;
            }
            connection
                .execute(
                    "UPDATE file_operations SET status='executing',reason=NULL WHERE id=?1",
                    [&item.id],
                )
                .map_err(|_| "database-write-failed")?;
            record_log(
                &connection,
                &execution_id,
                &item.id,
                "INFO",
                "executing",
                &format!("{} -> {}", item.source, item.target),
            );
            match transfer_file(source, target, &item.operation) {
                Ok(()) => {
                    completed.push(item.clone());
                    connection
                        .execute(
                            "UPDATE file_operations SET status='completed' WHERE id=?1",
                            [&item.id],
                        )
                        .map_err(|_| "database-write-failed")?;
                    record_log(
                        &connection,
                        &execution_id,
                        &item.id,
                        "INFO",
                        "completed",
                        &format!("{} -> {}", item.source, item.target),
                    );
                    logs.push(LogLine {
                        time: now(),
                        level: "INFO".into(),
                        message: format!("completed:{} -> {}", item.source, item.target),
                    });
                }
                Err(code) => {
                    group_error = Some((item.id.clone(), code));
                    break;
                }
            }
        }
        if let Some((operation_id, code)) = group_error {
            failed = true;
            connection
                .execute(
                    "UPDATE file_operations SET status='failed',reason=?2 WHERE id=?1",
                    params![operation_id, code],
                )
                .map_err(|_| "database-write-failed")?;
            record_log(
                &connection,
                &execution_id,
                &operation_id,
                "ERROR",
                &code,
                &code,
            );
            for item in completed.iter().rev() {
                let rolled_back = if item.operation == "copy" {
                    fs::remove_file(&item.target).is_ok()
                } else {
                    transfer_file(Path::new(&item.target), Path::new(&item.source), "move").is_ok()
                };
                if rolled_back {
                    connection
                        .execute(
                            "UPDATE file_operations SET status='rolled-back' WHERE id=?1",
                            [&item.id],
                        )
                        .ok();
                    record_log(
                        &connection,
                        &execution_id,
                        &item.id,
                        "WARN",
                        "rolled-back",
                        "group transaction rolled back",
                    );
                }
            }
            break;
        }
    }
    let finished = now();
    let status = if failed { "failed" } else { "completed" };
    connection
        .execute(
            "UPDATE execution_records SET status=?2,finished_at=?3 WHERE id=?1",
            params![execution_id, status, finished],
        )
        .map_err(|_| "database-write-failed")?;
    connection
        .execute(
            "UPDATE organization_plans SET status=?2 WHERE id=?1",
            params![plan.id, status],
        )
        .map_err(|_| "database-write-failed")?;
    connection
        .execute(
            "UPDATE organizer_tasks SET status=?2,stage='plan',updated_at=?3 WHERE id=?1",
            params![task_id, status, finished],
        )
        .map_err(|_| "database-write-failed")?;
    let mut states = BTreeMap::new();
    states.insert("file-transaction".into(), status.into());
    let final_plan = load_plan_from(&connection, &plan.id)?;
    let mut outputs = BTreeMap::new();
    outputs.insert(
        "plan".into(),
        serde_json::to_value(&final_plan).unwrap_or_default(),
    );
    let result = RunResult {
        id: execution_id,
        workflow_id: task.id.clone(),
        workflow_name: task.name.clone(),
        workflow_version: "organizer-v1".into(),
        status: status.into(),
        started_at: started,
        finished_at: finished,
        node_states: states,
        logs,
        outputs,
    };
    let runs = crate::portable::directory("runs").map_err(|_| "run-store-failed")?;
    fs::write(
        runs.join(format!("{}.json", result.id)),
        serde_json::to_vec_pretty(&result).map_err(|_| "run-store-failed")?,
    )
    .map_err(|_| "run-store-failed")?;
    if failed {
        Err("execution-failed".into())
    } else {
        Ok(result)
    }
}

#[tauri::command]
pub async fn execute_organization_plan(
    app: tauri::AppHandle,
    task_id: String,
) -> Result<RunResult, String> {
    tauri::async_runtime::spawn_blocking(move || execute_plan_sync(app, task_id))
        .await
        .map_err(|_| "execution-job-failed")?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn episode_files_use_natural_numeric_order() {
        let mut names = vec!["Episode 10.mkv", "Episode 2.mkv", "Episode 1.mkv"];
        names.sort_by(|left, right| natural_path_cmp(left, right));
        assert_eq!(
            names,
            vec!["Episode 1.mkv", "Episode 2.mkv", "Episode 10.mkv"]
        );
    }

    #[test]
    fn missing_scan_root_returns_source_unavailable() {
        let directory = tempfile::tempdir().unwrap();
        let missing = directory.path().join("removed-source");
        assert_eq!(
            validate_root(missing.to_string_lossy().as_ref(), "source-unavailable").unwrap_err(),
            "source-unavailable"
        );
    }

    #[test]
    fn replacement_source_cannot_overlap_a_library_root() {
        let directory = tempfile::tempdir().unwrap();
        let library = directory.path().join("shows");
        let nested_source = library.join("incoming");
        assert_eq!(
            ensure_roots_do_not_overlap(
                &nested_source,
                [library.as_path(), directory.path().join("movies").as_path()],
            )
            .unwrap_err(),
            "roots-overlap"
        );
    }

    #[test]
    fn parses_multi_episode() {
        let value = parse_media_name("Show.Name.S01E02E03.1080p");
        assert_eq!(value.title, "Show Name");
        assert_eq!(value.season, Some(1));
        assert_eq!(value.episodes, vec![2, 3]);
        assert_eq!(value.resolution.as_deref(), Some("1080p"));
    }
    #[test]
    fn scanned_file_ids_are_scoped_to_the_task() {
        let first = scanned_file_id("task-a", "Season 01/01.mkv");
        let second = scanned_file_id("task-b", "Season 01/01.mkv");
        assert_ne!(first, second);
        assert_eq!(first, scanned_file_id("task-a", "Season 01/01.mkv"));
    }
    #[test]
    fn parses_special() {
        let value = parse_media_name("Show.S00E01.Special");
        assert_eq!(value.season, Some(0));
        assert_eq!(value.episodes, vec![1]);
    }
    #[test]
    fn sanitizes_jellyfin_names() {
        assert_eq!(safe_component("Movie: Bad/Name?"), "Movie Bad Name");
    }
    #[test]
    fn rejects_parent_traversal() {
        let root = if cfg!(windows) {
            Path::new("C:\\media")
        } else {
            Path::new("/media")
        };
        let escaped = root.join("..").join("secret");
        assert!(!lexically_within(&escaped, root));
    }
    #[test]
    fn verified_copy_preserves_source() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source.mkv");
        let target = dir.path().join("Movies").join("target.mkv");
        fs::write(&source, b"media").unwrap();
        transfer_file(&source, &target, "copy").unwrap();
        assert_eq!(fs::read(&source).unwrap(), b"media");
        assert_eq!(fs::read(&target).unwrap(), b"media");
    }
    #[test]
    fn transfer_never_overwrites() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source.mkv");
        let target = dir.path().join("target.mkv");
        fs::write(&source, b"source").unwrap();
        fs::write(&target, b"target").unwrap();
        assert_eq!(
            transfer_file(&source, &target, "move").unwrap_err(),
            "target-exists"
        );
        assert_eq!(fs::read(&source).unwrap(), b"source");
    }
    #[test]
    fn strips_release_noise_without_a_year() {
        let value = parse_media_name("Dune.Part.Two.2160p.UHD.BluRay.x265");
        assert_eq!(value.title, "Dune Part Two");
        assert_eq!(value.resolution.as_deref(), Some("2160p"));
    }
    #[test]
    fn classifies_external_audio() {
        let parsed = parse_media_name("Show.S01E01.eng");
        assert_eq!(
            classify(Path::new("Show.S01E01.eng.mka"), &parsed).0,
            "audio"
        );
    }
    #[test]
    fn target_security_accepts_only_real_root() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("library");
        fs::create_dir(&root).unwrap();
        assert!(secure_target(&root.join("Movie").join("Movie.mkv"), &root).is_ok());
        assert!(secure_target(&dir.path().join("outside.mkv"), &root).is_err());
    }
    #[test]
    fn jellyfin_movie_path_contains_provider_id() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source");
        let movies = dir.path().join("movies");
        let shows = dir.path().join("shows");
        for path in [&source, &movies, &shows] {
            fs::create_dir(path).unwrap();
        }
        let file = ScannedFile {
            id: "f1".into(),
            relative_path: "Dune.2021.mkv".into(),
            name: "Dune.2021.mkv".into(),
            extension: "mkv".into(),
            kind: "video".into(),
            size: 1,
            modified_at: 1,
            group_id: Some("g1".into()),
            parsed: parse_media_name("Dune.2021.1080p"),
            warning: None,
        };
        let candidate = TmdbCandidate {
            id: 438631,
            media_type: "movie".into(),
            title: "Dune".into(),
            original_title: "Dune".into(),
            year: Some(2021),
            overview: String::new(),
            poster_path: None,
            vote_average: 8.0,
        };
        let group = MediaGroup {
            id: "g1".into(),
            title_guess: "Dune".into(),
            year: Some(2021),
            media_type: "movie".into(),
            confidence: 1.0,
            source: "manual".into(),
            confirmed: true,
            file_ids: vec!["f1".into()],
            matched: Some(ConfirmedMatch {
                candidate,
                display_title: "Dune".into(),
                source: "tmdb".into(),
                language: Some("en-US".into()),
                confirmed_at: 1,
            }),
            episode_mappings: vec![],
        };
        let task = OrganizerTask {
            id: "t1".into(),
            name: "test".into(),
            mode: "single".into(),
            source_root: source.to_string_lossy().into(),
            movie_root: movies.to_string_lossy().into(),
            show_root: shows.to_string_lossy().into(),
            operation: "move".into(),
            episode_naming_format: "series-year-title".into(),
            status: "active".into(),
            stage: "plan".into(),
            revision: 1,
            created_at: 1,
            updated_at: 1,
            files: vec![file.clone()],
            groups: vec![group.clone()],
            plan: None,
        };
        let target = target_for_video(&task, &group, &file, 0).unwrap();
        assert!(target
            .to_string_lossy()
            .contains("Dune (2021) [tmdbid-438631]"));
    }
    #[test]
    fn companion_subtitle_keeps_language_flags() {
        let video = ScannedFile {
            id: "v".into(),
            relative_path: "Show/Show.S01E01.1080p.mkv".into(),
            name: "Show.S01E01.1080p.mkv".into(),
            extension: "mkv".into(),
            kind: "video".into(),
            size: 1,
            modified_at: 1,
            group_id: Some("g".into()),
            parsed: parse_media_name("Show.S01E01.1080p"),
            warning: None,
        };
        let subtitle = ScannedFile {
            id: "s".into(),
            relative_path: "Show/Show.S01E01.zh.forced.srt".into(),
            name: "Show.S01E01.zh.forced.srt".into(),
            extension: "srt".into(),
            kind: "subtitle".into(),
            size: 1,
            modified_at: 1,
            group_id: Some("g".into()),
            parsed: parse_media_name("Show.S01E01.zh.forced"),
            warning: None,
        };
        let group = MediaGroup {
            id: "g".into(),
            title_guess: "Show".into(),
            year: Some(2020),
            media_type: "tv".into(),
            confidence: 1.0,
            source: "manual".into(),
            confirmed: true,
            file_ids: vec!["v".into(), "s".into()],
            matched: None,
            episode_mappings: vec![],
        };
        let target = PathBuf::from("library/Show (2020)/Season 01/Show (2020) S01E01.mkv");
        let result = companion_target(
            &sample_task_for_test(),
            &group,
            &subtitle,
            &[(video, target)],
        )
        .unwrap();
        assert!(result
            .to_string_lossy()
            .ends_with("Show (2020) S01E01.zh.forced.srt"));
    }

    #[test]
    fn subtitle_language_and_accessibility_flags_are_preserved() {
        let parsed = parse_media_name("Show.S01E01.default.zh-Hans.sdh");
        assert_eq!(
            parsed.language_suffix.as_deref(),
            Some("default.zh-Hans.sdh")
        );

        let parsed = parse_media_name("Film.2024.foreign.fr.cc");
        assert_eq!(parsed.language_suffix.as_deref(), Some("foreign.fr.cc"));

        let parsed = parse_media_name("Film.2024.default");
        assert_eq!(parsed.language_suffix.as_deref(), Some("default"));
    }

    #[test]
    fn common_external_subtitle_formats_are_scanned_as_subtitles() {
        for extension in SUBTITLE_EXTENSIONS {
            let path = PathBuf::from(format!("Show.S01E01.en.{extension}"));
            let parsed = parse_media_name("Show.S01E01.en");
            assert_eq!(classify(&path, &parsed).0, "subtitle", "{extension}");
        }
    }

    #[test]
    fn txt_wrapped_and_text_content_subtitles_are_detected() {
        let directory = tempfile::tempdir().unwrap();
        let wrapped = directory.path().join("Show.S01E01.sc.ass.txt");
        fs::write(
            &wrapped,
            "[Script Info]\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,字幕",
        )
        .unwrap();
        assert_eq!(subtitle_format(&wrapped).as_deref(), Some("ass"));
        assert_eq!(
            classify(&wrapped, &parse_media_name("Show.S01E01.sc")).0,
            "subtitle"
        );

        let plain = directory.path().join("Show.S01E02.txt");
        fs::write(&plain, "1\n00:00:01,000 --> 00:00:02,000\nSubtitle").unwrap();
        assert_eq!(subtitle_format(&plain).as_deref(), Some("srt"));
    }

    #[test]
    fn txt_wrapped_subtitle_gets_a_jellyfin_name_and_real_extension() {
        let video = ScannedFile {
            id: "v".into(),
            relative_path: "Show.S01E01.1080p.mkv".into(),
            name: "Show.S01E01.1080p.mkv".into(),
            extension: "mkv".into(),
            kind: "video".into(),
            size: 1,
            modified_at: 1,
            group_id: Some("g".into()),
            parsed: parse_media_name("Show.S01E01.1080p"),
            warning: None,
        };
        let subtitle = ScannedFile {
            id: "s".into(),
            relative_path: "Show.S01E01.1080p.sc.ass.txt".into(),
            name: "Show.S01E01.1080p.sc.ass.txt".into(),
            extension: "ass".into(),
            kind: "subtitle".into(),
            size: 1,
            modified_at: 1,
            group_id: Some("g".into()),
            parsed: parse_media_name("Show.S01E01.1080p.sc"),
            warning: None,
        };
        let group = MediaGroup {
            id: "g".into(),
            title_guess: "Show".into(),
            year: Some(2020),
            media_type: "tv".into(),
            confidence: 1.0,
            source: "ai".into(),
            confirmed: true,
            file_ids: vec!["v".into(), "s".into()],
            matched: None,
            episode_mappings: vec![],
        };
        let target = companion_target(
            &sample_task_for_test(),
            &group,
            &subtitle,
            &[(
                video,
                PathBuf::from("shows/Show (2020)/Season 01/Show (2020) S01E01.mkv"),
            )],
        )
        .unwrap();
        assert!(target
            .to_string_lossy()
            .ends_with("Show (2020) S01E01.zh-Hans.ass"));
    }

    #[test]
    fn ai_grouping_rejoins_subtitle_only_groups_to_matching_videos() {
        let video_stem = "[Group] Show [01][1080p][HEVC][AAC]";
        let video = ScannedFile {
            id: "video".into(),
            relative_path: format!("{video_stem}.mkv"),
            name: format!("{video_stem}.mkv"),
            extension: "mkv".into(),
            kind: "video".into(),
            size: 1,
            modified_at: 1,
            group_id: None,
            parsed: parse_media_name(video_stem),
            warning: None,
        };
        let subtitle = ScannedFile {
            id: "subtitle".into(),
            relative_path: format!("{video_stem}.tc.ass.txt"),
            name: format!("{video_stem}.tc.ass.txt"),
            extension: "txt".into(),
            kind: "unknown".into(),
            size: 1,
            modified_at: 1,
            group_id: None,
            parsed: parse_media_name(&format!("{video_stem}.tc.ass")),
            warning: Some("unsupported-file".into()),
        };
        let mut task = sample_task_for_test();
        task.mode = "batch".into();
        task.files = vec![video, subtitle];
        let proposals = reconcile_ai_companions(
            &task,
            vec![
                AiGroupingProposal {
                    id: "videos".into(),
                    title: "Show".into(),
                    year: None,
                    media_type: "tv".into(),
                    file_ids: vec!["video".into()],
                    confidence: 0.9,
                    reason: "video group".into(),
                },
                AiGroupingProposal {
                    id: "subtitles".into(),
                    title: "Show subtitles".into(),
                    year: None,
                    media_type: "unknown".into(),
                    file_ids: vec!["subtitle".into()],
                    confidence: 0.8,
                    reason: "subtitle group".into(),
                },
            ],
        );
        assert_eq!(proposals.len(), 1);
        assert!(proposals[0].file_ids.contains(&"video".into()));
        assert!(proposals[0].file_ids.contains(&"subtitle".into()));
    }

    #[test]
    fn vobsub_pair_follows_the_video_target() {
        let video = ScannedFile {
            id: "v".into(),
            relative_path: "Show/Show.S01E01.mkv".into(),
            name: "Show.S01E01.mkv".into(),
            extension: "mkv".into(),
            kind: "video".into(),
            size: 1,
            modified_at: 1,
            group_id: Some("g".into()),
            parsed: parse_media_name("Show.S01E01"),
            warning: None,
        };
        let group = MediaGroup {
            id: "g".into(),
            title_guess: "Show".into(),
            year: Some(2020),
            media_type: "tv".into(),
            confidence: 1.0,
            source: "manual".into(),
            confirmed: true,
            file_ids: vec!["v".into(), "idx".into(), "sub".into()],
            matched: None,
            episode_mappings: vec![],
        };
        let video_target = PathBuf::from("library/Show (2020)/Season 01/Show (2020) S01E01.mkv");

        for extension in ["idx", "sub"] {
            let subtitle = ScannedFile {
                id: extension.into(),
                relative_path: format!("Show/Show.S01E01.en.{extension}"),
                name: format!("Show.S01E01.en.{extension}"),
                extension: extension.into(),
                kind: "subtitle".into(),
                size: 1,
                modified_at: 1,
                group_id: Some("g".into()),
                parsed: parse_media_name("Show.S01E01.en"),
                warning: None,
            };
            let target = companion_target(
                &sample_task_for_test(),
                &group,
                &subtitle,
                &[(video.clone(), video_target.clone())],
            )
            .unwrap();
            assert!(target
                .to_string_lossy()
                .ends_with(&format!("Show (2020) S01E01.en.{extension}")));
        }
    }

    #[test]
    fn flat_batch_companions_match_the_correct_title() {
        let video = |id: &str, name: &str| ScannedFile {
            id: id.into(),
            relative_path: name.into(),
            name: name.into(),
            extension: "mkv".into(),
            kind: "video".into(),
            size: 1,
            modified_at: 1,
            group_id: None,
            parsed: parse_media_name(Path::new(name).file_stem().unwrap().to_str().unwrap()),
            warning: None,
        };
        let videos = vec![
            (video("v1", "Dune.2021.mkv"), "g1".into()),
            (video("v2", "Matrix.1999.mkv"), "g2".into()),
        ];
        let subtitle = ScannedFile {
            id: "s".into(),
            relative_path: "Dune.2021.zh.srt".into(),
            name: "Dune.2021.zh.srt".into(),
            extension: "srt".into(),
            kind: "subtitle".into(),
            size: 1,
            modified_at: 1,
            group_id: None,
            parsed: parse_media_name("Dune.2021.zh"),
            warning: None,
        };
        assert_eq!(
            companion_group(&subtitle, &videos, None).as_deref(),
            Some("g1")
        );
        let poster = ScannedFile {
            parsed: parse_media_name("poster"),
            relative_path: "poster.jpg".into(),
            name: "poster.jpg".into(),
            extension: "jpg".into(),
            kind: "image".into(),
            ..subtitle
        };
        assert!(companion_group(&poster, &videos, None).is_none());
    }

    #[test]
    fn episode_naming_formats_generate_supported_jellyfin_names() {
        let file = ScannedFile {
            id: "episode-1".into(),
            relative_path: "Show.S01E02.mkv".into(),
            name: "Show.S01E02.mkv".into(),
            extension: "mkv".into(),
            kind: "video".into(),
            size: 1,
            modified_at: 1,
            group_id: Some("show-1".into()),
            parsed: parse_media_name("Show.S01E02"),
            warning: None,
        };
        let group = MediaGroup {
            id: "show-1".into(),
            title_guess: "Example Show".into(),
            year: Some(2024),
            media_type: "tv".into(),
            confidence: 1.0,
            source: "manual".into(),
            confirmed: true,
            file_ids: vec![file.id.clone()],
            matched: Some(ConfirmedMatch {
                candidate: TmdbCandidate {
                    id: 123,
                    media_type: "tv".into(),
                    title: "Example Show".into(),
                    original_title: "Example Show".into(),
                    year: Some(2024),
                    overview: String::new(),
                    poster_path: None,
                    vote_average: 8.0,
                },
                display_title: "Example Show".into(),
                source: "tmdb".into(),
                language: Some("en-US".into()),
                confirmed_at: 1,
            }),
            episode_mappings: vec![EpisodeMapping {
                file_id: file.id.clone(),
                season: 1,
                episode: 2,
                episode_end: None,
                title: "Arrival".into(),
                confirmed: true,
            }],
        };
        let cases = [
            (
                "series-year-title",
                "Example Show (2024) S01E02 - Arrival.mkv",
            ),
            ("series-title", "Example Show S01E02 - Arrival.mkv"),
            ("episode-title", "S01E02 - Arrival.mkv"),
            ("series-compact", "Example Show S01E02.mkv"),
        ];
        for (format, expected) in cases {
            let mut task = sample_task_for_test();
            task.episode_naming_format = format.into();
            task.files = vec![file.clone()];
            let target = target_for_video(&task, &group, &file, 0).expect("target path");
            assert_eq!(
                target.file_name().and_then(|name| name.to_str()),
                Some(expected)
            );
        }
    }

    fn sample_task_for_test() -> OrganizerTask {
        OrganizerTask {
            id: "t".into(),
            name: "test".into(),
            mode: "single".into(),
            source_root: "source".into(),
            movie_root: "movies".into(),
            show_root: "shows".into(),
            operation: "move".into(),
            episode_naming_format: "series-year-title".into(),
            status: "active".into(),
            stage: "group".into(),
            revision: 1,
            created_at: 1,
            updated_at: 1,
            files: vec![],
            groups: vec![],
            plan: None,
        }
    }
}
