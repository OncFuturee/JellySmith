use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, HashSet},
    fs,
    path::PathBuf,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunResult {
    pub id: String,
    pub workflow_id: String,
    pub workflow_name: String,
    pub workflow_version: String,
    pub status: String,
    pub started_at: u64,
    pub finished_at: u64,
    pub node_states: BTreeMap<String, String>,
    pub logs: Vec<LogLine>,
    pub outputs: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogLine {
    pub time: u64,
    pub level: String,
    pub message: String,
}

fn runs_dir(_app: &tauri::AppHandle) -> Result<PathBuf, String> {
    crate::portable::directory("runs").map_err(|_| "run-store-failed".into())
}

#[tauri::command]
pub fn list_runs(app: tauri::AppHandle) -> Result<Vec<RunResult>, String> {
    let mut runs = Vec::new();
    for entry in fs::read_dir(runs_dir(&app)?).map_err(|_| "run-store-failed")? {
        let path = entry.map_err(|_| "run-store-failed")?.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        if let Ok(run) = serde_json::from_str::<RunResult>(
            &fs::read_to_string(path).map_err(|_| "run-store-failed")?,
        ) {
            runs.push(run)
        }
    }
    let known: HashSet<_> = runs.iter().map(|run| run.id.clone()).collect();
    let connection = crate::tasks::open_database(&app)?;
    let mut statement=connection.prepare("SELECT e.id,e.task_id,t.name,e.plan_id,e.status,e.started_at,e.finished_at FROM execution_records e LEFT JOIN organizer_tasks t ON t.id=e.task_id ORDER BY e.started_at DESC").map_err(|_|"run-store-failed")?;
    let records = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)? as u64,
                row.get::<_, Option<i64>>(6)?.map(|value| value as u64),
            ))
        })
        .map_err(|_| "run-store-failed")?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "run-store-failed")?;
    for (id, task_id, name, plan_id, status, started, finished) in records {
        if known.contains(&id) {
            continue;
        }
        let mut log_statement = connection
            .prepare(
                "SELECT time,level,message FROM operation_logs WHERE execution_id=?1 ORDER BY id",
            )
            .map_err(|_| "run-store-failed")?;
        let logs = log_statement
            .query_map([&id], |row| {
                Ok(LogLine {
                    time: row.get::<_, i64>(0)? as u64,
                    level: row.get(1)?,
                    message: row.get(2)?,
                })
            })
            .map_err(|_| "run-store-failed")?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| "run-store-failed")?;
        let mut outputs = BTreeMap::new();
        if let Ok(plan) = crate::tasks::load_plan_from(&connection, &plan_id) {
            outputs.insert(
                "plan".into(),
                serde_json::to_value(plan).unwrap_or(Value::Null),
            );
        }
        let mut node_states = BTreeMap::new();
        node_states.insert("file-transaction".into(), status.clone());
        runs.push(RunResult {
            id,
            workflow_id: task_id,
            workflow_name: name.unwrap_or_else(|| "Archived media task".into()),
            workflow_version: "organizer-v1".into(),
            status,
            started_at: started,
            finished_at: finished.unwrap_or(started),
            node_states,
            logs,
            outputs,
        });
    }
    runs.sort_by_key(|run| std::cmp::Reverse(run.started_at));
    Ok(runs)
}

#[tauri::command]
pub fn delete_run(app: tauri::AppHandle, run_id: String) -> Result<(), String> {
    if run_id.is_empty()
        || !run_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("run-id-invalid".into());
    }

    let path = runs_dir(&app)?.join(format!("{run_id}.json"));
    let file_exists = path.is_file();
    let mut connection = crate::tasks::open_database(&app)?;
    let transaction = connection.transaction().map_err(|_| "run-delete-failed")?;
    transaction
        .execute(
            "DELETE FROM operation_logs WHERE execution_id=?1",
            [&run_id],
        )
        .map_err(|_| "run-delete-failed")?;
    let deleted = transaction
        .execute("DELETE FROM execution_records WHERE id=?1", [&run_id])
        .map_err(|_| "run-delete-failed")?;
    transaction.commit().map_err(|_| "run-delete-failed")?;

    if file_exists {
        fs::remove_file(path).map_err(|_| "run-delete-failed")?;
    }
    if deleted == 0 && !file_exists {
        return Err("run-not-found".into());
    }
    Ok(())
}
