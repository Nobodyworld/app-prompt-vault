#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use nw_secrets::{decrypt_from_base64, encrypt_to_base64};
use once_cell::sync::Lazy;
use regex::Regex;
use rusqlite::{
    params, Connection, Error as SqlError, ErrorCode, OpenFlags, OptionalExtension, Transaction,
};
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::Read;
use std::ops::Deref;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use thiserror::Error;
use uuid::Uuid;

const MIGRATION_001: &str = include_str!("../../src/db/migrations/001_init.sql");
const MIGRATION_002_CATEGORY: &str = include_str!("../../src/db/migrations/002_add_category.sql");
const MIGRATION_002_INDEXES: &str = include_str!("../../src/db/migrations/002_indexes.sql");
const MIGRATION_003_FORMAT: &str =
    include_str!("../../src/db/migrations/003_add_format_support.sql");
const MIGRATION_004_SOFT_DELETE: &str =
    include_str!("../../src/db/migrations/004_add_soft_delete.sql");

static SLUG_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^[a-z0-9]+(?:-[a-z0-9]+)*$").expect("invalid slug regex"));
static SEMANTIC_VERSION_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
        .expect("invalid semantic version regex")
});

struct AppState {
    connection: Mutex<Connection>,
    database_path: PathBuf,
}

#[derive(Debug, Error)]
enum AppError {
    #[error("{0}")]
    Validation(String),
    #[error("database error: {0}")]
    Database(String),
    #[error("internal error: {0}")]
    Internal(String),
}

impl From<rusqlite::Error> for AppError {
    fn from(error: rusqlite::Error) -> Self {
        AppError::Database(error.to_string())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ListPromptsResponse {
    prompts: Vec<PromptSummary>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CreatePromptResponse {
    prompt: PromptSummary,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PromptSummary {
    id: String,
    slug: String,
    title: String,
    description: Option<String>,
    category: Option<String>,
    is_favorite: bool,
    rating: Option<i32>,
    tags: Vec<String>,
    created_at: String,
    updated_at: String,
    latest_version: Option<PromptVersionSummary>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PromptVersionSummary {
    id: String,
    semantic_version: String,
    changelog: Option<String>,
    created_at: String,
    updated_at: String,
    body: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecoveryVersion {
    #[serde(skip_serializing_if = "Option::is_none")]
    source_id: Option<String>,
    semantic_version: String,
    body: String,
    body_hash: String,
    changelog: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecoveryPrompt {
    #[serde(skip_serializing_if = "Option::is_none")]
    source_id: Option<String>,
    slug: String,
    title: String,
    description: Option<String>,
    category: Option<String>,
    is_favorite: bool,
    rating: Option<i32>,
    tags: Vec<String>,
    created_at: String,
    updated_at: String,
    versions: Vec<RecoveryVersion>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecoveryDocument {
    format: String,
    source_version: String,
    exported_at: String,
    history_coverage: String,
    prompts: Vec<RecoveryPrompt>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RestorePlanEntry {
    source_slug: String,
    kind: String,
    current_prompt_id: Option<String>,
    missing_version_identities: Vec<String>,
    skipped_version_identities: Vec<String>,
    copy_slug: Option<String>,
    copy_title: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RestorePlan {
    plan_version: String,
    plan_id: String,
    source_version: String,
    document_fingerprint: String,
    current_library_fingerprint: String,
    entries: Vec<RestorePlanEntry>,
    warnings: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExecuteRestorePayload {
    document: RecoveryDocument,
    plan: RestorePlan,
    policy: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RestoreResult {
    source_format: String,
    policy: String,
    new_prompts: usize,
    copied_prompts: usize,
    merged_versions: usize,
    skipped_prompts: usize,
    skipped_versions: usize,
    invalid_records: usize,
    warnings: Vec<String>,
    integrity_result: String,
    foreign_key_violation_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageStatus {
    runtime: String,
    storage: String,
    database_path: Option<String>,
    database_exists: bool,
    database_size: Option<u64>,
    sqlite_user_version: i32,
    prompt_count: i64,
    version_count: i64,
    tag_count: i64,
    relationship_count: i64,
    wal_exists: bool,
    wal_size: Option<u64>,
    shm_exists: bool,
    shm_size: Option<u64>,
    integrity_status: String,
    native_sqlite_available: bool,
    legacy_recovery_available: bool,
    plaintext_warning: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LegacySourceStatus {
    state: String,
    file_name: Option<String>,
    file_size: Option<u64>,
    sha256: Option<String>,
    sqlite_user_version: Option<i32>,
    recognized_schema: Option<String>,
    prompt_count: Option<i64>,
    version_count: Option<i64>,
    tag_count: Option<i64>,
    relationship_count: Option<i64>,
    integrity_status: String,
    warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LegacyRecoveryPreview {
    status: LegacySourceStatus,
    source_hash: String,
    document: RecoveryDocument,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExecuteLegacyRestorePayload {
    source_hash: String,
    plan: RestorePlan,
    policy: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreatePromptPayload {
    slug: String,
    title: String,
    description: Option<String>,
    category: Option<String>,
    is_favorite: Option<bool>,
    rating: Option<i32>,
    body: String,
    semantic_version: String,
    changelog: Option<String>,
    tags: Vec<String>,
}

#[tauri::command]
fn nw_secrets_encrypt(plaintext: String) -> Result<String, String> {
    encrypt_to_base64(&plaintext).map_err(|e| e.to_string())
}

#[tauri::command]
fn nw_secrets_decrypt(ciphertext_b64: String) -> Result<String, String> {
    decrypt_from_base64(&ciphertext_b64).map_err(|e| e.to_string())
}

#[tauri::command]
async fn list_prompts(state: State<'_, AppState>) -> Result<ListPromptsResponse, String> {
    list_prompts_inner(state).map_err(|error| error.to_string())
}

#[tauri::command]
async fn create_prompt(
    state: State<'_, AppState>,
    payload: CreatePromptPayload,
) -> Result<CreatePromptResponse, String> {
    create_prompt_inner(state, payload).map_err(|error| error.to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddVersionPayload {
    prompt_id: String,
    body: String,
    semantic_version: String,
    changelog: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AddVersionResponse {
    version: PromptVersionSummary,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ListPromptVersionsResponse {
    versions: Vec<PromptVersionSummary>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListPromptVersionsPayload {
    prompt_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeletePromptPayload {
    prompt_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdatePromptPayload {
    id: String,
    title: Option<String>,
    description: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    category: Option<Option<String>>,
    is_favorite: Option<bool>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    rating: Option<Option<i32>>,
    tags: Option<Vec<String>>,
}

fn deserialize_optional_field<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdatePromptResponse {
    prompt: PromptSummary,
}

#[tauri::command]
async fn add_prompt_version(
    state: State<'_, AppState>,
    payload: AddVersionPayload,
) -> Result<AddVersionResponse, String> {
    add_prompt_version_inner(state, payload).map_err(|error| error.to_string())
}

#[tauri::command]
async fn update_prompt(
    state: State<'_, AppState>,
    payload: UpdatePromptPayload,
) -> Result<UpdatePromptResponse, String> {
    update_prompt_inner(state, payload).map_err(|error| error.to_string())
}

#[tauri::command]
async fn list_prompt_versions(
    state: State<'_, AppState>,
    payload: ListPromptVersionsPayload,
) -> Result<ListPromptVersionsResponse, String> {
    list_prompt_versions_inner(state, payload).map_err(|error| error.to_string())
}

#[tauri::command]
async fn delete_prompt(
    state: State<'_, AppState>,
    payload: DeletePromptPayload,
) -> Result<(), String> {
    delete_prompt_inner(state, payload).map_err(|error| error.to_string())
}

#[tauri::command]
async fn get_storage_status(
    state: State<'_, AppState>,
    integrity_requested: Option<bool>,
) -> Result<StorageStatus, String> {
    get_storage_status_inner(state, integrity_requested.unwrap_or(false))
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn inspect_legacy_database(app: AppHandle) -> Result<LegacySourceStatus, String> {
    let base_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?;
    Ok(inspect_legacy_path(&resolve_legacy_database_path(
        &base_dir,
    )))
}

#[tauri::command]
async fn preview_legacy_recovery(app: AppHandle) -> Result<LegacyRecoveryPreview, String> {
    let base_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?;
    read_legacy_recovery_document(&resolve_legacy_database_path(&base_dir))
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn execute_legacy_restore(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: ExecuteLegacyRestorePayload,
) -> Result<RestoreResult, String> {
    let base_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?;
    let source_path = resolve_legacy_database_path(&base_dir);
    let preview = read_legacy_recovery_document(&source_path).map_err(|error| error.to_string())?;
    if preview.source_hash != payload.source_hash {
        return Err("The legacy source changed after preview. Create a new preview.".into());
    }
    let result = execute_backup_restore_inner(
        state,
        ExecuteRestorePayload {
            document: preview.document,
            plan: payload.plan,
            policy: payload.policy,
        },
    )
    .map_err(|error| error.to_string())?;
    let hash_after = sha256_file(&source_path).map_err(|error| error.to_string())?;
    if hash_after != payload.source_hash {
        return Err("The legacy source changed during recovery.".into());
    }
    Ok(result)
}

#[tauri::command]
async fn execute_backup_restore(
    state: State<'_, AppState>,
    payload: ExecuteRestorePayload,
) -> Result<RestoreResult, String> {
    execute_backup_restore_inner(state, payload).map_err(|error| error.to_string())
}

// Helper that persists telemetry payload into the provided directory, with rotation by max_bytes.
fn persist_telemetry_to_dir(
    dir: &std::path::Path,
    payload: &serde_json::Value,
    max_bytes: u64,
) -> Result<(), String> {
    if let Err(e) = std::fs::create_dir_all(dir) {
        eprintln!(
            "[telemetry][error] failed to create telemetry dir {}: {}",
            dir.display(),
            e
        );
    }

    // Build today's filename
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let base_name = format!("telemetry-{}.log", today);
    let file_path = dir.join(&base_name);

    // Rotate if file exists and size >= max_bytes
    if let Ok(meta) = std::fs::metadata(&file_path) {
        if meta.len() >= max_bytes {
            // find next available index
            let mut idx = 1u32;
            loop {
                let rotated = dir.join(format!("telemetry-{}.{}.log", today, idx));
                if !rotated.exists() {
                    if let Err(e) = std::fs::rename(&file_path, &rotated) {
                        eprintln!("[telemetry][error] failed to rotate file: {}", e);
                    }
                    break;
                }
                idx += 1;
                if idx > 1000 {
                    // give up after many attempts
                    break;
                }
            }
        }
    }

    // Open (create/append) the (possibly new) file
    match std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file_path)
    {
        Ok(mut file) => {
            if let Ok(line) = serde_json::to_string(payload) {
                use std::io::Write;
                if let Err(e) = writeln!(file, "{}", line) {
                    eprintln!("[telemetry][error] failed to write telemetry: {}", e);
                }
                // Also print a compact version to stdout for log collectors
                println!("[telemetry] {}", line);

                // Additionally update a simple metrics counter JSON (event counts) to integrate with observability.
                let metrics_path = dir.join("telemetry-metrics.json");
                let mut metrics: serde_json::Map<String, serde_json::Value> =
                    match std::fs::read_to_string(&metrics_path) {
                        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
                        Err(_) => serde_json::Map::new(),
                    };
                let event_name = payload
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown");
                let counter_key = format!("event_count:{}", event_name);
                let current = metrics
                    .get(&counter_key)
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                metrics.insert(counter_key, serde_json::Value::from(current + 1));
                if let Ok(s) = serde_json::to_string_pretty(&metrics) {
                    let _ = std::fs::write(&metrics_path, s);
                }
            } else {
                eprintln!("[telemetry][error] failed to serialize payload");
            }
        }
        Err(e) => {
            eprintln!(
                "[telemetry][error] failed to open telemetry file {}: {}",
                file_path.display(),
                e
            );
            if let Ok(s) = serde_json::to_string(payload) {
                println!("[telemetry] {}", s);
            }
        }
    }

    Ok(())
}

// Return the telemetry directory path for the current platform (helpful for debugging).
#[tauri::command]
async fn get_telemetry_dir(app: tauri::AppHandle) -> Result<String, String> {
    match app.path().app_local_data_dir() {
        Ok(d) => Ok(d
            .join("prompt-vault-telemetry")
            .to_string_lossy()
            .to_string()),
        Err(e) => Err(format!("failed to determine app local data dir: {}", e)),
    }
}

// Force-run the retention cleanup immediately. If `days` is None, uses 30.
#[tauri::command]
async fn force_telemetry_retention_cleanup(
    app: tauri::AppHandle,
    days: Option<i64>,
) -> Result<(), String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("failed to determine app local data dir: {}", e))?
        .join("prompt-vault-telemetry");
    let days = days.unwrap_or(30);
    telemetry_retention_cleanup(&dir, days);
    Ok(())
}

#[tauri::command]
async fn record_telemetry_event(
    app: tauri::AppHandle,
    payload: serde_json::Value,
) -> Result<(), String> {
    if !telemetry_is_enabled() {
        return Ok(());
    }

    // Persist telemetry payload to a rolling daily file under the application's local data directory.
    // Rotation strategy: per-day files rotated when exceeding MAX_BYTES.
    const MAX_BYTES: u64 = 5 * 1024 * 1024; // 5 MiB per file before rotation

    let sanitized = sanitize_telemetry_payload(payload);

    let dir = match app.path().app_local_data_dir() {
        Ok(d) => d.join("prompt-vault-telemetry"),
        Err(e) => {
            eprintln!(
                "[telemetry][error] failed to determine app local data dir: {}",
                e
            );
            // fallback to printing
            if let Ok(s) = serde_json::to_string(&sanitized) {
                println!("[telemetry] {}", s);
            }
            return Ok(());
        }
    };

    // Use the helper to persist with the configured MAX_BYTES
    let _ = persist_telemetry_to_dir(&dir, &sanitized, MAX_BYTES);
    Ok(())
}

fn telemetry_is_enabled() -> bool {
    fn truthy(value: &str) -> bool {
        matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "y" | "on"
        )
    }

    // Explicit app opt-out envs.
    if let Ok(v) = std::env::var("PROMPT_VAULT_TELEMETRY_OPTOUT") {
        if truthy(&v) {
            return false;
        }
    }

    // Repo-wide opt-out env.
    if let Ok(v) = std::env::var("NW_TELEMETRY_OPTOUT") {
        if truthy(&v) {
            return false;
        }
    }

    // Allow explicitly disabling telemetry.
    if let Ok(v) = std::env::var("PROMPT_VAULT_TELEMETRY_ENABLED") {
        if v.trim().eq_ignore_ascii_case("false") || v.trim() == "0" {
            return false;
        }
    }

    true
}

fn should_redact_key(key: &str) -> bool {
    let k = key.to_ascii_lowercase();
    k.contains("token")
        || k.contains("secret")
        || k.contains("password")
        || k.contains("passwd")
        || k.contains("apikey")
        || k.contains("api_key")
        || k.contains("authorization")
        || k.contains("cookie")
        || k.contains("session")
        || k.contains("private")
}

fn truncate_string(value: &str, max_len: usize) -> String {
    if value.chars().count() <= max_len {
        return value.to_string();
    }
    let mut out = String::new();
    for (i, ch) in value.chars().enumerate() {
        if i >= max_len {
            break;
        }
        out.push(ch);
    }
    out.push_str("…(truncated)");
    out
}

fn sanitize_telemetry_payload(payload: serde_json::Value) -> serde_json::Value {
    const MAX_DEPTH: usize = 6;
    const MAX_STRING: usize = 8_192;

    fn walk(value: serde_json::Value, depth: usize) -> serde_json::Value {
        if depth >= MAX_DEPTH {
            return serde_json::Value::String("…(depth-truncated)".to_string());
        }

        match value {
            serde_json::Value::Object(map) => {
                let mut out = serde_json::Map::new();
                for (k, v) in map {
                    if should_redact_key(&k) {
                        out.insert(k, serde_json::Value::String("[REDACTED]".to_string()));
                        continue;
                    }
                    out.insert(k, walk(v, depth + 1));
                }
                serde_json::Value::Object(out)
            }
            serde_json::Value::Array(values) => {
                let out: Vec<serde_json::Value> =
                    values.into_iter().map(|v| walk(v, depth + 1)).collect();
                serde_json::Value::Array(out)
            }
            serde_json::Value::String(s) => {
                serde_json::Value::String(truncate_string(&s, MAX_STRING))
            }
            other => other,
        }
    }

    walk(payload, 0)
}

// Retention: delete telemetry files older than `days` in the telemetry directory.
fn telemetry_retention_cleanup(dir: &std::path::Path, days: i64) {
    use chrono::Duration;
    let cutoff = chrono::Utc::now() - Duration::days(days);
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if let Ok(metadata) = std::fs::metadata(&path) {
                if let Ok(mtime) = metadata.modified() {
                    // Convert SystemTime to chrono::DateTime<Utc>
                    let file_time = chrono::DateTime::<chrono::Utc>::from(mtime);
                    if file_time < cutoff {
                        if let Err(e) = std::fs::remove_file(&path) {
                            eprintln!(
                                "[telemetry][retention] failed to remove {}: {}",
                                path.display(),
                                e
                            );
                        } else {
                            println!(
                                "[telemetry][retention] removed old file: {}",
                                path.display()
                            );
                        }
                    }
                }
            }
        }
    }
}

fn list_prompts_inner(state: State<'_, AppState>) -> Result<ListPromptsResponse, AppError> {
    let connection_guard = state
        .connection
        .lock()
        .map_err(|_| AppError::Internal("database lock poisoned".into()))?;

    list_prompts_from_connection(&connection_guard)
}

fn list_prompts_from_connection(connection: &Connection) -> Result<ListPromptsResponse, AppError> {
    let mut stmt = connection.prepare(
        "SELECT id, slug, title, description, category, is_favorite, rating, created_at, updated_at
     FROM prompts
     ORDER BY updated_at DESC",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok(PartialPrompt {
            id: row.get(0)?,
            slug: row.get(1)?,
            title: row.get(2)?,
            description: row.get(3)?,
            category: row.get(4)?,
            is_favorite: row.get(5)?,
            rating: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
        })
    })?;

    let mut prompts = Vec::new();
    for row in rows {
        let partial = row?;
        prompts.push(compose_prompt_summary(connection, &partial)?);
    }

    Ok(ListPromptsResponse { prompts })
}

fn create_prompt_inner(
    state: State<'_, AppState>,
    payload: CreatePromptPayload,
) -> Result<CreatePromptResponse, AppError> {
    let mut connection = state
        .connection
        .lock()
        .map_err(|_| AppError::Internal("database lock poisoned".into()))?;

    create_prompt_in_connection(&mut connection, payload)
}

fn create_prompt_in_connection(
    connection: &mut Connection,
    payload: CreatePromptPayload,
) -> Result<CreatePromptResponse, AppError> {
    validate_payload(&payload)?;

    let slug = payload.slug.trim().to_string();
    let title = payload.title.trim().to_string();
    let description = payload
        .description
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let category = payload
        .category
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let body = payload.body;
    let semantic_version = payload.semantic_version.trim().to_string();
    let changelog = payload
        .changelog
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let tags: Vec<String> = payload
        .tags
        .into_iter()
        .map(|tag| tag.trim().to_string())
        .filter(|tag| !tag.is_empty())
        .collect();

    let is_favorite = payload.is_favorite.unwrap_or(false);
    let rating = payload.rating;

    let tx = connection.transaction()?;
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    tx.execute(
          "INSERT INTO prompts (id, slug, title, description, category, is_favorite, rating, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
          params![id, slug, title, description, category, if is_favorite { 1 } else { 0 }, rating, now,],
    )
    .map_err(|error| match error {
        SqlError::SqliteFailure(ref sqlite_error, _)
            if sqlite_error.code == ErrorCode::ConstraintViolation =>
        {
            AppError::Validation("A prompt with this slug already exists".into())
        }
        other => AppError::Database(other.to_string()),
    })?;

    let version_id = Uuid::new_v4().to_string();

    tx.execute(
    "INSERT INTO prompt_versions (id, prompt_id, semantic_version, body, changelog, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
    params![
      version_id,
      id,
      semantic_version,
      body,
      changelog,
      now,
    ],
  )?;

    store_tags(tx.deref(), &id, &tags)?;

    tx.commit()?;

    let summary = compose_prompt_summary(
        connection,
        &PartialPrompt {
            id: id.clone(),
            slug,
            title,
            description,
            category,
            is_favorite: if is_favorite { 1 } else { 0 },
            rating,
            created_at: now.clone(),
            updated_at: now,
        },
    )?;

    Ok(CreatePromptResponse { prompt: summary })
}

fn add_prompt_version_inner(
    state: State<'_, AppState>,
    payload: AddVersionPayload,
) -> Result<AddVersionResponse, AppError> {
    if payload.body.trim().is_empty() {
        return Err(AppError::Validation("Prompt body cannot be empty".into()));
    }

    Version::parse(payload.semantic_version.trim()).map_err(|_| {
        AppError::Validation("Semantic version must follow MAJOR.MINOR.PATCH".into())
    })?;

    let connection = state
        .connection
        .lock()
        .map_err(|_| AppError::Internal("database lock poisoned".into()))?;

    let prompt_id = payload.prompt_id;
    let prompt_id_for_update = prompt_id.clone();
    let semantic_version = payload.semantic_version.trim().to_string();
    let changelog = payload.changelog;
    let changelog_for_response = changelog.clone();
    let body = payload.body;
    let body_for_response = body.clone();
    let version_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    connection.execute(
    "INSERT INTO prompt_versions (id, prompt_id, semantic_version, body, changelog, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
    params![
      version_id,
      prompt_id,
      semantic_version,
      body,
      changelog,
      now,
    ],
  )?;

    connection.execute(
        "UPDATE prompts SET updated_at = ?1 WHERE id = ?2",
        params![now, prompt_id_for_update],
    )?;

    Ok(AddVersionResponse {
        version: PromptVersionSummary {
            id: version_id,
            semantic_version,
            changelog: changelog_for_response,
            created_at: now.clone(),
            updated_at: now,
            body: body_for_response,
        },
    })
}

fn update_prompt_inner(
    state: State<'_, AppState>,
    payload: UpdatePromptPayload,
) -> Result<UpdatePromptResponse, AppError> {
    let connection = state
        .connection
        .lock()
        .map_err(|_| AppError::Internal("database lock poisoned".into()))?;

    update_prompt_in_connection(&connection, payload)
}

fn update_prompt_in_connection(
    connection: &Connection,
    payload: UpdatePromptPayload,
) -> Result<UpdatePromptResponse, AppError> {
    let id = payload.id;
    let title = payload
        .title
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty());
    let description = payload
        .description
        .map(|d| d.trim().to_string())
        .filter(|d| !d.is_empty());
    let category = payload.category.map(|value| {
        value
            .map(|category| category.trim().to_string())
            .filter(|category| !category.is_empty())
    });
    let is_favorite = payload.is_favorite;
    let rating = payload.rating;
    let tags = payload.tags.map(|t| {
        t.into_iter()
            .map(|tag| tag.trim().to_string())
            .filter(|tag| !tag.is_empty())
            .collect::<Vec<_>>()
    });

    let mut updates: Vec<&str> = Vec::new();
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(t) = title {
        updates.push("title = ?");
        params_vec.push(Box::new(t));
    }
    if let Some(d) = description {
        updates.push("description = ?");
        params_vec.push(Box::new(d));
    }
    if let Some(category_value) = category {
        updates.push("category = ?");
        params_vec.push(Box::new(category_value));
    }
    if let Some(fav) = is_favorite {
        updates.push("is_favorite = ?");
        params_vec.push(Box::new(if fav { 1 } else { 0 }));
    }
    if let Some(r) = rating {
        updates.push("rating = ?");
        params_vec.push(Box::new(r));
    }

    updates.push("updated_at = ?");
    let now = chrono::Utc::now().to_rfc3339();
    params_vec.push(Box::new(now.clone()));

    let query = format!("UPDATE prompts SET {} WHERE id = ?", updates.join(", "));
    params_vec.push(Box::new(id.clone()));

    let params_refs: Vec<&dyn rusqlite::ToSql> = params_vec
        .iter()
        .map(|value| value.as_ref() as &dyn rusqlite::ToSql)
        .collect();

    let updated = connection.execute(&query, &params_refs[..])?;
    if updated == 0 {
        return Err(AppError::Validation("Prompt not found".into()));
    }

    if let Some(ref t) = tags {
        // Remove existing tags
        connection.execute("DELETE FROM prompt_tags WHERE prompt_id = ?", [&id])?;
        // Add new tags
        store_tags(connection, &id, t)?;
    }

    // Fetch updated prompt
    let mut stmt = connection.prepare(
        "SELECT id, slug, title, description, category, is_favorite, rating, created_at, updated_at FROM prompts WHERE id = ?",
    )?;
    let partial = stmt.query_row([&id], |row| {
        Ok(PartialPrompt {
            id: row.get(0)?,
            slug: row.get(1)?,
            title: row.get(2)?,
            description: row.get(3)?,
            category: row.get(4)?,
            is_favorite: row.get(5)?,
            rating: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
        })
    })?;

    let summary = compose_prompt_summary(connection, &partial)?;

    Ok(UpdatePromptResponse { prompt: summary })
}

fn list_prompt_versions_inner(
    state: State<'_, AppState>,
    payload: ListPromptVersionsPayload,
) -> Result<ListPromptVersionsResponse, AppError> {
    let connection = state
        .connection
        .lock()
        .map_err(|_| AppError::Internal("database lock poisoned".into()))?;

    // If missing, mimic not-found behavior with a validation error string
    // (desktop currently surfaces errors via toString())
    let exists = connection
        .query_row(
            "SELECT 1 FROM prompts WHERE id = ?1",
            [payload.prompt_id.as_str()],
            |_| Ok(1i32),
        )
        .optional()?;
    if exists.is_none() {
        return Err(AppError::Validation("Prompt not found".into()));
    }

    let mut stmt = connection.prepare(
        "SELECT id, semantic_version, changelog, created_at, updated_at, body
         FROM prompt_versions
         WHERE prompt_id = ?1
         ORDER BY created_at DESC, rowid DESC",
    )?;

    let rows = stmt.query_map([payload.prompt_id.as_str()], |row| {
        Ok(PromptVersionSummary {
            id: row.get(0)?,
            semantic_version: row.get(1)?,
            changelog: row.get(2)?,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
            body: row.get(5)?,
        })
    })?;

    let mut versions = Vec::new();
    for row in rows {
        versions.push(row?);
    }

    Ok(ListPromptVersionsResponse { versions })
}

fn delete_prompt_inner(
    state: State<'_, AppState>,
    payload: DeletePromptPayload,
) -> Result<(), AppError> {
    let connection = state
        .connection
        .lock()
        .map_err(|_| AppError::Internal("database lock poisoned".into()))?;

    let exists = connection
        .query_row(
            "SELECT 1 FROM prompts WHERE id = ?1",
            [payload.prompt_id.as_str()],
            |_| Ok(1i32),
        )
        .optional()?;
    if exists.is_none() {
        return Err(AppError::Validation("Prompt not found".into()));
    }

    connection.execute(
        "DELETE FROM prompt_tags WHERE prompt_id = ?1",
        [payload.prompt_id.as_str()],
    )?;
    connection.execute(
        "DELETE FROM prompt_versions WHERE prompt_id = ?1",
        [payload.prompt_id.as_str()],
    )?;
    connection.execute(
        "DELETE FROM prompts WHERE id = ?1",
        [payload.prompt_id.as_str()],
    )?;

    Ok(())
}

fn sha256_text(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

fn sha256_file(path: &Path) -> Result<String, AppError> {
    let mut file = File::open(path).map_err(|error| AppError::Internal(error.to_string()))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|error| AppError::Internal(error.to_string()))?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn database_count(connection: &Connection, table: &str) -> Result<i64, AppError> {
    let sql = format!("SELECT COUNT(*) FROM {table}");
    Ok(connection.query_row(&sql, [], |row| row.get(0))?)
}

fn sidecar_inventory(path: &Path) -> (bool, Option<u64>) {
    match std::fs::metadata(path) {
        Ok(metadata) => (true, Some(metadata.len())),
        Err(_) => (false, None),
    }
}

fn get_storage_status_inner(
    state: State<'_, AppState>,
    integrity_requested: bool,
) -> Result<StorageStatus, AppError> {
    let connection = state
        .connection
        .lock()
        .map_err(|_| AppError::Internal("database lock poisoned".into()))?;
    let metadata = std::fs::metadata(&state.database_path).ok();
    let wal_path = PathBuf::from(format!("{}-wal", state.database_path.display()));
    let shm_path = PathBuf::from(format!("{}-shm", state.database_path.display()));
    let (wal_exists, wal_size) = sidecar_inventory(&wal_path);
    let (shm_exists, shm_size) = sidecar_inventory(&shm_path);
    let integrity_status = if integrity_requested {
        let result: String =
            connection.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
        if result == "ok" {
            "ok"
        } else {
            "failed"
        }
    } else {
        "not-requested"
    };
    Ok(StorageStatus {
        runtime: "native".into(),
        storage: "sqlite".into(),
        database_path: Some(state.database_path.display().to_string()),
        database_exists: metadata.is_some(),
        database_size: metadata.map(|value| value.len()),
        sqlite_user_version: get_user_version(&connection)?,
        prompt_count: database_count(&connection, "prompts")?,
        version_count: database_count(&connection, "prompt_versions")?,
        tag_count: database_count(&connection, "tags")?,
        relationship_count: database_count(&connection, "prompt_tags")?,
        wal_exists,
        wal_size,
        shm_exists,
        shm_size,
        integrity_status: integrity_status.into(),
        native_sqlite_available: true,
        legacy_recovery_available: cfg!(target_os = "windows"),
        plaintext_warning: "Prompt content and local databases are plaintext. Use operating-system permissions and full-disk encryption.".into(),
    })
}

fn resolve_legacy_database_path(current_base_dir: &Path) -> PathBuf {
    if let Some(value) = std::env::var("PROMPT_VAULT_LEGACY_DB_PATH")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        return PathBuf::from(value);
    }
    current_base_dir
        .parent()
        .unwrap_or(current_base_dir)
        .join("com.promptvault.desktop")
        .join("prompt-vault.db")
}

fn legacy_empty_status(state: &str, path: &Path, warnings: Vec<String>) -> LegacySourceStatus {
    LegacySourceStatus {
        state: state.into(),
        file_name: path
            .file_name()
            .map(|value| value.to_string_lossy().to_string()),
        file_size: std::fs::metadata(path).ok().map(|value| value.len()),
        sha256: None,
        sqlite_user_version: None,
        recognized_schema: None,
        prompt_count: None,
        version_count: None,
        tag_count: None,
        relationship_count: None,
        integrity_status: "unavailable".into(),
        warnings,
    }
}

fn read_only_user_data_integrity(connection: &Connection) -> Result<bool, AppError> {
    let _: i64 =
        connection.query_row("SELECT COUNT(*) FROM sqlite_master", [], |row| row.get(0))?;
    for table in ["prompts", "prompt_versions", "tags", "prompt_tags"] {
        if !has_table(connection, table)? {
            continue;
        }
        let sql = format!("PRAGMA integrity_check('{table}')");
        let result: String = connection.query_row(&sql, [], |row| row.get(0))?;
        if result != "ok" {
            return Ok(false);
        }
    }
    Ok(true)
}

fn inspect_legacy_path(path: &Path) -> LegacySourceStatus {
    if !path.exists() {
        return legacy_empty_status("not-found", path, Vec::new());
    }
    let hash_before = match sha256_file(path) {
        Ok(hash) => hash,
        Err(error) => return legacy_empty_status("unreadable", path, vec![error.to_string()]),
    };
    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let connection = match Connection::open_with_flags(path, flags) {
        Ok(connection) => connection,
        Err(error) => {
            let state = match &error {
                SqlError::SqliteFailure(details, _)
                    if details.code == ErrorCode::DatabaseCorrupt =>
                {
                    "corrupt"
                }
                _ => "unreadable",
            };
            return legacy_empty_status(state, path, vec![error.to_string()]);
        }
    };
    let integrity = match read_only_user_data_integrity(&connection) {
        Ok(value) => value,
        Err(error) => return legacy_empty_status("corrupt", path, vec![error.to_string()]),
    };
    if !integrity {
        return legacy_empty_status(
            "corrupt",
            path,
            vec!["SQLite user-data integrity check failed.".into()],
        );
    }
    let compatible = has_table(&connection, "prompts").unwrap_or(false)
        && has_table(&connection, "prompt_versions").unwrap_or(false)
        && has_column(&connection, "prompts", "id").unwrap_or(false)
        && has_column(&connection, "prompts", "slug").unwrap_or(false)
        && has_column(&connection, "prompt_versions", "body").unwrap_or(false)
        && has_column(&connection, "prompt_versions", "semantic_version").unwrap_or(false);
    let hash_after = match sha256_file(path) {
        Ok(hash) => hash,
        Err(error) => return legacy_empty_status("unreadable", path, vec![error.to_string()]),
    };
    if hash_before != hash_after {
        return legacy_empty_status(
            "unreadable",
            path,
            vec!["The legacy source changed during read-only inspection.".into()],
        );
    }
    let optional_count = |table: &str| -> Option<i64> {
        if has_table(&connection, table).unwrap_or(false) {
            database_count(&connection, table).ok()
        } else {
            None
        }
    };
    LegacySourceStatus {
        state: if compatible {
            "compatible".into()
        } else {
            "unsupported-schema".into()
        },
        file_name: path
            .file_name()
            .map(|value| value.to_string_lossy().to_string()),
        file_size: std::fs::metadata(path).ok().map(|value| value.len()),
        sha256: Some(hash_before),
        sqlite_user_version: get_user_version(&connection).ok(),
        recognized_schema: compatible.then(|| "prompt-vault-sqlite-v1".into()),
        prompt_count: optional_count("prompts"),
        version_count: optional_count("prompt_versions"),
        tag_count: optional_count("tags"),
        relationship_count: optional_count("prompt_tags"),
        integrity_status: "ok".into(),
        warnings: if compatible {
            vec![
                "Older schemas may not contain favorite, rating, category, or changelog fields."
                    .into(),
            ]
        } else {
            vec!["The source schema is not recognized; no recovery writes are available.".into()]
        },
    }
}

fn legacy_column_expression(
    connection: &Connection,
    table: &str,
    column: &str,
    fallback: &str,
) -> String {
    if has_column(connection, table, column).unwrap_or(false) {
        column.into()
    } else {
        fallback.into()
    }
}

fn read_legacy_recovery_document(path: &Path) -> Result<LegacyRecoveryPreview, AppError> {
    let status = inspect_legacy_path(path);
    if status.state != "compatible" {
        return Err(AppError::Validation(match status.state.as_str() {
            "not-found" => "No historical Prompt Vault database was found.".into(),
            "corrupt" => "The historical database is corrupt. No recovery was attempted.".into(),
            "unreadable" => {
                "The historical database could not be read. No recovery was attempted.".into()
            }
            _ => "The historical database schema is unsupported. No recovery was attempted.".into(),
        }));
    }
    let source_hash = status
        .sha256
        .clone()
        .ok_or_else(|| AppError::Internal("Legacy source hash is unavailable.".into()))?;
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    let exported_at = std::fs::metadata(path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .map(chrono::DateTime::<chrono::Utc>::from)
        .unwrap_or_else(chrono::Utc::now)
        .to_rfc3339();
    let title = legacy_column_expression(&connection, "prompts", "title", "slug");
    let description = legacy_column_expression(&connection, "prompts", "description", "NULL");
    let category = legacy_column_expression(&connection, "prompts", "category", "NULL");
    let favorite = legacy_column_expression(&connection, "prompts", "is_favorite", "0");
    let rating = legacy_column_expression(&connection, "prompts", "rating", "NULL");
    let created = legacy_column_expression(&connection, "prompts", "created_at", "NULL");
    let updated = legacy_column_expression(&connection, "prompts", "updated_at", "NULL");
    let active_filter = if has_column(&connection, "prompts", "deleted_at")? {
        " WHERE deleted_at IS NULL"
    } else {
        ""
    };
    let prompt_sql = format!(
        "SELECT id, slug, {title}, {description}, {category}, {favorite}, {rating}, {created}, {updated} FROM prompts{active_filter} ORDER BY LOWER(slug), id"
    );
    let mut prompt_statement = connection.prepare(&prompt_sql)?;
    let prompt_rows = prompt_statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, Option<String>>(4)?,
            row.get::<_, i64>(5)?,
            row.get::<_, Option<i32>>(6)?,
            row.get::<_, Option<String>>(7)?,
            row.get::<_, Option<String>>(8)?,
        ))
    })?;
    let version_changelog =
        legacy_column_expression(&connection, "prompt_versions", "changelog", "NULL");
    let version_created =
        legacy_column_expression(&connection, "prompt_versions", "created_at", "NULL");
    let version_updated =
        legacy_column_expression(&connection, "prompt_versions", "updated_at", "NULL");
    let version_sql = format!(
        "SELECT id, semantic_version, body, {version_changelog}, {version_created}, {version_updated} FROM prompt_versions WHERE prompt_id = ?1 ORDER BY COALESCE({version_created}, {version_updated}), rowid"
    );
    let has_tags = has_table(&connection, "tags")?
        && has_table(&connection, "prompt_tags")?
        && has_column(&connection, "prompt_tags", "prompt_id")?
        && has_column(&connection, "prompt_tags", "tag_id")?;
    let tag_label = if has_column(&connection, "tags", "label")? {
        Some("label")
    } else if has_column(&connection, "tags", "name")? {
        Some("name")
    } else {
        None
    };
    let mut prompts = Vec::new();
    for row in prompt_rows {
        let (id, slug, title, description, category, favorite, rating, created, updated) = row?;
        let prompt_updated = updated.unwrap_or_else(|| exported_at.clone());
        let prompt_created = created.unwrap_or_else(|| prompt_updated.clone());
        let mut version_statement = connection.prepare(&version_sql)?;
        let versions = version_statement
            .query_map([id.as_str()], |version| {
                let body: String = version.get(2)?;
                let version_updated: Option<String> = version.get(5)?;
                let updated_at = version_updated.unwrap_or_else(|| prompt_updated.clone());
                let version_created: Option<String> = version.get(4)?;
                Ok(RecoveryVersion {
                    source_id: Some(version.get(0)?),
                    semantic_version: version.get(1)?,
                    body_hash: sha256_text(&body),
                    body,
                    changelog: version.get(3)?,
                    created_at: version_created.unwrap_or_else(|| updated_at.clone()),
                    updated_at,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let mut tags = Vec::new();
        if has_tags {
            if let Some(label) = tag_label {
                let tag_sql = format!(
                    "SELECT t.{label} FROM tags t JOIN prompt_tags pt ON pt.tag_id = t.id WHERE pt.prompt_id = ?1 ORDER BY LOWER(t.{label}), t.{label}"
                );
                let mut tag_statement = connection.prepare(&tag_sql)?;
                tags = tag_statement
                    .query_map([id.as_str()], |tag| tag.get(0))?
                    .collect::<Result<Vec<String>, _>>()?;
            }
        }
        prompts.push(RecoveryPrompt {
            source_id: Some(id),
            slug: slug.trim().to_lowercase(),
            title: title.unwrap_or_else(|| slug.clone()),
            description,
            category,
            is_favorite: favorite != 0,
            rating,
            tags,
            created_at: prompt_created,
            updated_at: prompt_updated,
            versions,
        });
    }
    let hash_after = sha256_file(path)?;
    if hash_after != source_hash {
        return Err(AppError::Validation(
            "The legacy source changed during read-only preview.".into(),
        ));
    }
    let document = RecoveryDocument {
        format: "prompt-vault-backup".into(),
        source_version: "2.0".into(),
        exported_at,
        history_coverage: "full-history".into(),
        prompts,
    };
    validate_recovery_document(&document)?;
    Ok(LegacyRecoveryPreview {
        status,
        source_hash,
        document,
    })
}

fn recovery_version_identity(version: &RecoveryVersion) -> String {
    format!("{}\0{}", version.semantic_version.trim(), version.body_hash)
}

fn compare_javascript_text(left: &str, right: &str) -> std::cmp::Ordering {
    left.encode_utf16().cmp(right.encode_utf16())
}

fn compare_recovery_tags(left: &str, right: &str) -> std::cmp::Ordering {
    let left_lower = left.to_lowercase();
    let right_lower = right.to_lowercase();
    compare_javascript_text(&left_lower, &right_lower)
        .then_with(|| compare_javascript_text(left, right))
}

fn read_recovery_library(
    connection: &Connection,
) -> Result<Vec<(String, RecoveryPrompt)>, AppError> {
    let mut prompt_statement = connection.prepare(
        "SELECT id, slug, title, description, category, is_favorite, rating, created_at, updated_at
         FROM prompts WHERE deleted_at IS NULL ORDER BY LOWER(slug), id",
    )?;
    let prompt_rows = prompt_statement.query_map([], |row| {
        Ok(PartialPrompt {
            id: row.get(0)?,
            slug: row.get(1)?,
            title: row.get(2)?,
            description: row.get(3)?,
            category: row.get(4)?,
            is_favorite: row.get(5)?,
            rating: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
        })
    })?;
    let mut result = Vec::new();
    for row in prompt_rows {
        let prompt = row?;
        let mut version_statement = connection.prepare(
            "SELECT id, semantic_version, body, changelog, created_at, updated_at
             FROM prompt_versions WHERE prompt_id = ?1 ORDER BY datetime(created_at), rowid",
        )?;
        let versions = version_statement
            .query_map([prompt.id.as_str()], |version| {
                let body: String = version.get(2)?;
                Ok(RecoveryVersion {
                    source_id: Some(version.get(0)?),
                    semantic_version: version.get(1)?,
                    body_hash: sha256_text(&body),
                    body,
                    changelog: version.get(3)?,
                    created_at: version.get(4)?,
                    updated_at: version.get(5)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let mut tags = fetch_tags(connection, &prompt.id)?;
        tags.sort_by(|left, right| compare_recovery_tags(left, right));
        result.push((
            prompt.id.clone(),
            RecoveryPrompt {
                source_id: Some(prompt.id),
                slug: prompt.slug.trim().to_lowercase(),
                title: prompt.title,
                description: prompt.description,
                category: prompt.category,
                is_favorite: prompt.is_favorite != 0,
                rating: prompt.rating,
                tags,
                created_at: prompt.created_at,
                updated_at: prompt.updated_at,
                versions,
            },
        ));
    }
    Ok(result)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CanonicalLibraryVersion {
    identity: String,
    created_at: String,
    updated_at: String,
    changelog: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CanonicalLibraryPrompt {
    id: String,
    slug: String,
    title: String,
    description: Option<String>,
    category: Option<String>,
    is_favorite: bool,
    rating: Option<i32>,
    tags: Vec<String>,
    created_at: String,
    updated_at: String,
    versions: Vec<CanonicalLibraryVersion>,
}

fn fingerprint_library(library: &[(String, RecoveryPrompt)]) -> Result<String, AppError> {
    let mut canonical: Vec<CanonicalLibraryPrompt> = library
        .iter()
        .map(|(id, prompt)| {
            let mut tags = prompt.tags.clone();
            tags.sort_by(|left, right| compare_recovery_tags(left, right));
            let mut versions: Vec<CanonicalLibraryVersion> = prompt
                .versions
                .iter()
                .map(|version| CanonicalLibraryVersion {
                    identity: recovery_version_identity(version),
                    created_at: version.created_at.clone(),
                    updated_at: version.updated_at.clone(),
                    changelog: version.changelog.clone(),
                })
                .collect();
            versions.sort_by(|left, right| {
                compare_javascript_text(&left.created_at, &right.created_at)
                    .then_with(|| compare_javascript_text(&left.identity, &right.identity))
            });
            CanonicalLibraryPrompt {
                id: id.clone(),
                slug: prompt.slug.trim().to_lowercase(),
                title: prompt.title.clone(),
                description: prompt.description.clone(),
                category: prompt.category.clone(),
                is_favorite: prompt.is_favorite,
                rating: prompt.rating,
                tags,
                created_at: prompt.created_at.clone(),
                updated_at: prompt.updated_at.clone(),
                versions,
            }
        })
        .collect();
    canonical.sort_by(|left, right| {
        compare_javascript_text(&left.slug, &right.slug)
            .then_with(|| compare_javascript_text(&left.id, &right.id))
    });
    let encoded =
        serde_json::to_string(&canonical).map_err(|error| AppError::Internal(error.to_string()))?;
    Ok(sha256_text(&encoded))
}

fn validate_recovery_document(document: &RecoveryDocument) -> Result<(), AppError> {
    if document.format != "prompt-vault-backup"
        || !matches!(document.source_version.as_str(), "1.0" | "2.0")
        || !matches!(
            (
                document.source_version.as_str(),
                document.history_coverage.as_str()
            ),
            ("1.0", "latest-version-only") | ("2.0", "full-history")
        )
    {
        return Err(AppError::Validation(
            "Unsupported recovery document.".into(),
        ));
    }
    chrono::DateTime::parse_from_rfc3339(&document.exported_at)
        .map_err(|_| AppError::Validation("Invalid recovery export timestamp.".into()))?;
    if document.prompts.len() > 10_000 {
        return Err(AppError::Validation(
            "Recovery prompt limit exceeded.".into(),
        ));
    }
    if serde_json::to_vec(document)
        .map_err(|error| AppError::Validation(error.to_string()))?
        .len()
        > 10 * 1024 * 1024
    {
        return Err(AppError::Validation(
            "Recovery input size limit exceeded.".into(),
        ));
    }
    let mut slugs = std::collections::HashSet::new();
    let mut version_count = 0_usize;
    for prompt in &document.prompts {
        if !SLUG_PATTERN.is_match(&prompt.slug)
            || prompt.title.trim().is_empty()
            || prompt.title.chars().count() > 500
            || prompt
                .description
                .as_ref()
                .is_some_and(|value| value.chars().count() > 2_000)
            || prompt
                .category
                .as_ref()
                .is_some_and(|value| value.chars().count() > 100)
            || prompt.tags.len() > 10
            || prompt.rating.is_some_and(|value| !(1..=5).contains(&value))
            || chrono::DateTime::parse_from_rfc3339(&prompt.created_at).is_err()
            || chrono::DateTime::parse_from_rfc3339(&prompt.updated_at).is_err()
        {
            return Err(AppError::Validation(format!(
                "Invalid recovery metadata for slug {}.",
                prompt.slug
            )));
        }
        let mut normalized_tags = std::collections::HashSet::new();
        for tag in &prompt.tags {
            if tag.trim().is_empty()
                || tag.chars().count() > 100
                || !normalized_tags.insert(tag.to_lowercase())
            {
                return Err(AppError::Validation(format!(
                    "Invalid recovery tags for slug {}.",
                    prompt.slug
                )));
            }
        }
        if !slugs.insert(prompt.slug.clone()) {
            return Err(AppError::Validation(
                "Duplicate recovery prompt slug.".into(),
            ));
        }
        if prompt.versions.is_empty() {
            return Err(AppError::Validation(
                "Recovery prompt has no versions.".into(),
            ));
        }
        let mut identities = std::collections::HashSet::new();
        for version in &prompt.versions {
            version_count += 1;
            if !SEMANTIC_VERSION_PATTERN.is_match(&version.semantic_version)
                || version.body.is_empty()
                || version.body.chars().count() > 100 * 1024
                || version.body_hash != sha256_text(&version.body)
                || version
                    .changelog
                    .as_ref()
                    .is_some_and(|value| value.chars().count() > 2_000)
                || chrono::DateTime::parse_from_rfc3339(&version.created_at).is_err()
                || chrono::DateTime::parse_from_rfc3339(&version.updated_at).is_err()
            {
                return Err(AppError::Validation(format!(
                    "Invalid recovery version for slug {}.",
                    prompt.slug
                )));
            }
            if !identities.insert(recovery_version_identity(version)) {
                return Err(AppError::Validation(
                    "Duplicate recovery version identity.".into(),
                ));
            }
        }
    }
    if version_count > 50_000 {
        return Err(AppError::Validation(
            "Recovery version limit exceeded.".into(),
        ));
    }
    Ok(())
}

fn insert_recovery_version(
    transaction: &Transaction<'_>,
    prompt_id: &str,
    version: &RecoveryVersion,
) -> Result<(), AppError> {
    transaction.execute(
        "INSERT INTO prompt_versions
         (id, prompt_id, semantic_version, body, format, changelog, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'markdown', ?5, ?6, ?7)",
        params![
            Uuid::new_v4().to_string(),
            prompt_id,
            version.semantic_version,
            version.body,
            version.changelog,
            version.created_at,
            version.updated_at,
        ],
    )?;
    Ok(())
}

fn insert_recovery_prompt(
    transaction: &Transaction<'_>,
    source: &RecoveryPrompt,
    slug: &str,
    title: &str,
    failure_point: Option<&str>,
) -> Result<String, AppError> {
    let id = Uuid::new_v4().to_string();
    transaction.execute(
        "INSERT INTO prompts
         (id, slug, title, description, category, is_favorite, rating, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            id,
            slug,
            title,
            source.description,
            source.category,
            if source.is_favorite { 1 } else { 0 },
            source.rating,
            source.created_at,
            source.updated_at,
        ],
    )?;
    inject_recovery_failure(failure_point, "prompt-insertion")?;
    for (index, version) in source.versions.iter().enumerate() {
        insert_recovery_version(transaction, &id, version)?;
        if index == 0 {
            inject_recovery_failure(failure_point, "version-insertion")?;
        }
    }
    let mut find_tag =
        transaction.prepare("SELECT id FROM tags WHERE LOWER(label) = LOWER(?1) LIMIT 1")?;
    let mut insert_tag = transaction.prepare(
        "INSERT INTO tags (id, label, description, created_at) VALUES (?1, ?2, NULL, ?3)",
    )?;
    let mut insert_link = transaction
        .prepare("INSERT OR IGNORE INTO prompt_tags (prompt_id, tag_id) VALUES (?1, ?2)")?;
    for label in &source.tags {
        let existing: Option<String> = find_tag.query_row([label], |row| row.get(0)).optional()?;
        let tag_id = match existing {
            Some(id) => id,
            None => {
                let id = Uuid::new_v4().to_string();
                insert_tag.execute(params![id, label, chrono::Utc::now().to_rfc3339()])?;
                inject_recovery_failure(failure_point, "tag-insertion")?;
                id
            }
        };
        insert_link.execute(params![id, tag_id])?;
        inject_recovery_failure(failure_point, "relationship-insertion")?;
    }
    Ok(id)
}

fn inject_recovery_failure(failure_point: Option<&str>, expected: &str) -> Result<(), AppError> {
    if failure_point == Some(expected) {
        return Err(AppError::Internal(format!(
            "Injected recovery failure after {expected}"
        )));
    }
    Ok(())
}

fn execute_backup_restore_inner(
    state: State<'_, AppState>,
    payload: ExecuteRestorePayload,
) -> Result<RestoreResult, AppError> {
    let mut connection = state
        .connection
        .lock()
        .map_err(|_| AppError::Internal("database lock poisoned".into()))?;
    execute_backup_restore_on_connection(&mut connection, payload, None)
}

fn execute_backup_restore_on_connection(
    connection: &mut Connection,
    payload: ExecuteRestorePayload,
    failure_point: Option<&str>,
) -> Result<RestoreResult, AppError> {
    validate_recovery_document(&payload.document)?;
    if !matches!(
        payload.policy.as_str(),
        "skip-existing" | "add-missing-versions" | "import-as-copy"
    ) {
        return Err(AppError::Validation("Unsupported restore policy.".into()));
    }
    let encoded_document = serde_json::to_string(&payload.document)
        .map_err(|error| AppError::Internal(error.to_string()))?;
    if sha256_text(&encoded_document) != payload.plan.document_fingerprint
        || payload.plan.source_version != payload.document.source_version
        || payload.plan.plan_version != "1"
    {
        return Err(AppError::Validation(
            "The recovery source or plan changed after preview. Create a new preview.".into(),
        ));
    }
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct PlanCore<'a> {
        plan_version: &'a str,
        source_version: &'a str,
        document_fingerprint: &'a str,
        current_library_fingerprint: &'a str,
        entries: &'a [RestorePlanEntry],
        warnings: &'a [String],
    }
    let plan_core = PlanCore {
        plan_version: &payload.plan.plan_version,
        source_version: &payload.plan.source_version,
        document_fingerprint: &payload.plan.document_fingerprint,
        current_library_fingerprint: &payload.plan.current_library_fingerprint,
        entries: &payload.plan.entries,
        warnings: &payload.plan.warnings,
    };
    let encoded_plan =
        serde_json::to_string(&plan_core).map_err(|error| AppError::Internal(error.to_string()))?;
    if sha256_text(&encoded_plan) != payload.plan.plan_id {
        return Err(AppError::Validation(
            "The restore plan signature is invalid.".into(),
        ));
    }

    let current = read_recovery_library(connection)?;
    if fingerprint_library(&current)? != payload.plan.current_library_fingerprint {
        return Err(AppError::Validation(
            "The current library changed after preview. Create a new preview.".into(),
        ));
    }
    let current_by_slug: std::collections::HashMap<&str, &(String, RecoveryPrompt)> = current
        .iter()
        .map(|entry| (entry.1.slug.as_str(), entry))
        .collect();
    let sources: std::collections::HashMap<&str, &RecoveryPrompt> = payload
        .document
        .prompts
        .iter()
        .map(|prompt| (prompt.slug.as_str(), prompt))
        .collect();
    if payload.plan.entries.len() != sources.len() {
        return Err(AppError::Validation(
            "The restore plan is incomplete.".into(),
        ));
    }
    let transaction = connection.transaction()?;
    let mut new_prompts = 0_usize;
    let mut copied_prompts = 0_usize;
    let mut merged_versions = 0_usize;
    let mut skipped_prompts = 0_usize;
    let mut skipped_versions = 0_usize;
    let mut seen_sources = std::collections::HashSet::new();
    let mut reserved_slugs: std::collections::HashSet<String> = current_by_slug
        .keys()
        .map(|value| (*value).to_string())
        .collect();
    for entry in &payload.plan.entries {
        if !seen_sources.insert(entry.source_slug.as_str()) {
            return Err(AppError::Validation(
                "The restore plan contains duplicate entries.".into(),
            ));
        }
        let source = sources.get(entry.source_slug.as_str()).ok_or_else(|| {
            AppError::Validation("The restore plan references a missing source.".into())
        })?;
        let current_entry = current_by_slug.get(entry.source_slug.as_str()).copied();
        if entry.kind == "new-prompt" {
            if current_entry.is_some() || entry.current_prompt_id.is_some() {
                return Err(AppError::Validation(
                    "The new-prompt plan target is stale.".into(),
                ));
            }
            insert_recovery_prompt(
                &transaction,
                source,
                &source.slug,
                &source.title,
                failure_point,
            )?;
            new_prompts += 1;
            reserved_slugs.insert(source.slug.clone());
            continue;
        }
        let (current_id, current_prompt) = current_entry.ok_or_else(|| {
            AppError::Validation("The restore conflict target no longer exists.".into())
        })?;
        if entry.current_prompt_id.as_deref() != Some(current_id.as_str()) {
            return Err(AppError::Validation(
                "The restore conflict target changed.".into(),
            ));
        }
        let existing_identities: std::collections::HashSet<String> = current_prompt
            .versions
            .iter()
            .map(recovery_version_identity)
            .collect();
        let actual_missing: Vec<String> = source
            .versions
            .iter()
            .map(recovery_version_identity)
            .filter(|identity| !existing_identities.contains(identity))
            .collect();
        let actual_skipped: Vec<String> = source
            .versions
            .iter()
            .map(recovery_version_identity)
            .filter(|identity| existing_identities.contains(identity))
            .collect();
        if actual_missing != entry.missing_version_identities
            || actual_skipped != entry.skipped_version_identities
        {
            return Err(AppError::Validation(
                "The restore version plan changed.".into(),
            ));
        }
        match payload.policy.as_str() {
            "skip-existing" => {
                skipped_prompts += 1;
                skipped_versions += source.versions.len();
            }
            "import-as-copy" => {
                let copy_slug = entry.copy_slug.as_deref().ok_or_else(|| {
                    AppError::Validation("The restore copy slug is missing.".into())
                })?;
                let copy_title = entry.copy_title.as_deref().ok_or_else(|| {
                    AppError::Validation("The restore copy title is missing.".into())
                })?;
                if reserved_slugs.contains(copy_slug) {
                    return Err(AppError::Validation(
                        "The restore copy slug is stale.".into(),
                    ));
                }
                insert_recovery_prompt(&transaction, source, copy_slug, copy_title, failure_point)?;
                inject_recovery_failure(failure_point, "copy-creation")?;
                reserved_slugs.insert(copy_slug.into());
                copied_prompts += 1;
            }
            "add-missing-versions" => {
                let missing: std::collections::HashSet<&str> = entry
                    .missing_version_identities
                    .iter()
                    .map(String::as_str)
                    .collect();
                for version in &source.versions {
                    if missing.contains(recovery_version_identity(version).as_str()) {
                        insert_recovery_version(&transaction, current_id, version)?;
                        merged_versions += 1;
                        inject_recovery_failure(failure_point, "version-merge")?;
                    } else {
                        skipped_versions += 1;
                    }
                }
                if missing.is_empty() {
                    skipped_prompts += 1;
                } else if let Some(latest) = source
                    .versions
                    .iter()
                    .map(|version| version.updated_at.as_str())
                    .max()
                {
                    transaction.execute(
                        "UPDATE prompts SET updated_at = CASE WHEN updated_at > ?1 THEN updated_at ELSE ?1 END WHERE id = ?2",
                        params![latest, current_id],
                    )?;
                }
            }
            _ => unreachable!(),
        }
    }
    let foreign_key_violation_count: i64 = {
        let mut statement = transaction.prepare("PRAGMA foreign_key_check")?;
        let mut rows = statement.query([])?;
        let mut count = 0_i64;
        while rows.next()?.is_some() {
            count += 1;
        }
        count
    };
    let integrity: String =
        transaction.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
    if integrity != "ok" || foreign_key_violation_count != 0 {
        return Err(AppError::Database(
            "Post-restore verification failed; all writes were rolled back.".into(),
        ));
    }
    transaction.commit()?;
    Ok(RestoreResult {
        source_format: payload.document.source_version,
        policy: payload.policy,
        new_prompts,
        copied_prompts,
        merged_versions,
        skipped_prompts,
        skipped_versions,
        invalid_records: 0,
        warnings: payload.plan.warnings,
        integrity_result: integrity,
        foreign_key_violation_count: foreign_key_violation_count as usize,
    })
}

struct PartialPrompt {
    id: String,
    slug: String,
    title: String,
    description: Option<String>,
    category: Option<String>,
    is_favorite: i64,
    rating: Option<i32>,
    created_at: String,
    updated_at: String,
}

fn compose_prompt_summary(
    connection: &Connection,
    partial: &PartialPrompt,
) -> Result<PromptSummary, AppError> {
    let tags = fetch_tags(connection, &partial.id)?;
    let latest_version = fetch_latest_version(connection, &partial.id)?;

    Ok(PromptSummary {
        id: partial.id.clone(),
        slug: partial.slug.clone(),
        title: partial.title.clone(),
        description: partial.description.clone(),
        category: partial.category.clone(),
        is_favorite: partial.is_favorite != 0,
        rating: partial.rating,
        tags,
        created_at: partial.created_at.clone(),
        updated_at: partial.updated_at.clone(),
        latest_version,
    })
}

fn fetch_tags(connection: &Connection, prompt_id: &str) -> Result<Vec<String>, AppError> {
    let mut stmt = connection.prepare(
        "SELECT t.label
     FROM tags t
     INNER JOIN prompt_tags pt ON pt.tag_id = t.id
     WHERE pt.prompt_id = ?1
     ORDER BY t.label",
    )?;

    let rows = stmt.query_map([prompt_id], |row| row.get::<_, String>(0))?;
    let mut tags = Vec::new();
    for row in rows {
        tags.push(row?);
    }
    Ok(tags)
}

fn fetch_latest_version(
    connection: &Connection,
    prompt_id: &str,
) -> Result<Option<PromptVersionSummary>, AppError> {
    let mut stmt = connection.prepare(
        "SELECT id, semantic_version, changelog, created_at, updated_at, body
     FROM prompt_versions
     WHERE prompt_id = ?1
     ORDER BY created_at DESC, rowid DESC
     LIMIT 1",
    )?;

    let version = stmt
        .query_row([prompt_id], |row| {
            Ok(PromptVersionSummary {
                id: row.get(0)?,
                semantic_version: row.get(1)?,
                changelog: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                body: row.get(5)?,
            })
        })
        .optional()?;

    Ok(version)
}

fn store_tags(connection: &Connection, prompt_id: &str, tags: &[String]) -> Result<(), AppError> {
    if tags.is_empty() {
        return Ok(());
    }

    let mut insert_tag = connection.prepare(
        "INSERT INTO tags (id, label, description, created_at)
     VALUES (?1, ?2, NULL, ?3)
     ON CONFLICT(label) DO NOTHING",
    )?;

    let mut insert_edge = connection.prepare(
        "INSERT OR IGNORE INTO prompt_tags (prompt_id, tag_id)
     VALUES (?1, (SELECT id FROM tags WHERE label = ?2))",
    )?;

    let now = chrono::Utc::now().to_rfc3339();

    for label in tags {
        insert_tag.execute(params![Uuid::new_v4().to_string(), label, now.clone()])?;
        insert_edge.execute(params![prompt_id, label])?;
    }

    Ok(())
}

fn validate_payload(payload: &CreatePromptPayload) -> Result<(), AppError> {
    if payload.slug.trim().is_empty() {
        return Err(AppError::Validation("Slug is required".into()));
    }

    if !SLUG_PATTERN.is_match(payload.slug.trim()) {
        return Err(AppError::Validation(
            "Slug must use lowercase letters, numbers, and hyphens".into(),
        ));
    }

    if payload.title.trim().is_empty() {
        return Err(AppError::Validation("Title cannot be empty".into()));
    }

    if payload.body.trim().is_empty() {
        return Err(AppError::Validation("Prompt body cannot be empty".into()));
    }

    Version::parse(payload.semantic_version.trim()).map_err(|_| {
        AppError::Validation("Semantic version must follow MAJOR.MINOR.PATCH".into())
    })?;

    Ok(())
}

fn ensure_database(handle: &AppHandle) -> Result<AppState, AppError> {
    let base_dir = handle
        .path()
        .app_local_data_dir()
        .map_err(|error| AppError::Internal(error.to_string()))?;

    std::fs::create_dir_all(&base_dir).map_err(|error| AppError::Internal(error.to_string()))?;

    let database_path = resolve_database_path(&base_dir);
    let connection = Connection::open(&database_path)?;
    connection.pragma_update(None, "foreign_keys", "ON")?;
    apply_migrations(&connection)?;

    Ok(AppState {
        connection: Mutex::new(connection),
        database_path,
    })
}

fn resolve_database_path(base_dir: &Path) -> PathBuf {
    let raw = std::env::var("PROMPT_VAULT_DB_PATH")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    match raw {
        Some(value) => {
            let candidate = PathBuf::from(value);
            if candidate.is_absolute() {
                candidate
            } else {
                base_dir.join(candidate)
            }
        }
        None => base_dir.join("prompt-vault.db"),
    }
}

fn has_table(connection: &Connection, table: &str) -> Result<bool, AppError> {
    let mut stmt = connection
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1 LIMIT 1")?;
    let exists: Option<String> = stmt
        .query_row(params![table], |row| row.get(0))
        .optional()?;
    Ok(exists.is_some())
}

fn has_column(connection: &Connection, table: &str, column: &str) -> Result<bool, AppError> {
    let sql = format!("PRAGMA table_info({})", table);
    let mut stmt = connection.prepare(&sql)?;
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let name: String = row.get(1)?;
        if name == column {
            return Ok(true);
        }
    }
    Ok(false)
}

fn get_user_version(connection: &Connection) -> Result<i32, AppError> {
    let mut stmt = connection.prepare("PRAGMA user_version")?;
    let version: i32 = stmt.query_row([], |row| row.get(0))?;
    Ok(version)
}

fn set_user_version(connection: &Connection, version: i32) -> Result<(), AppError> {
    connection.pragma_update(None, "user_version", version.to_string())?;
    Ok(())
}

fn infer_schema_version(connection: &Connection) -> Result<i32, AppError> {
    if !has_table(connection, "prompts")? {
        return Ok(0);
    }

    let has_category = has_column(connection, "prompts", "category")?;
    let has_deleted_at = has_column(connection, "prompts", "deleted_at")?;
    let has_favorite = has_column(connection, "prompts", "is_favorite")?;
    let has_rating = has_column(connection, "prompts", "rating")?;
    let has_format = has_column(connection, "prompt_versions", "format")?;

    if has_category && has_deleted_at && has_format && has_favorite && has_rating {
        return Ok(5);
    }

    if has_category && has_deleted_at && has_format {
        return Ok(2);
    }

    Ok(1)
}

fn apply_migrations(connection: &Connection) -> Result<(), AppError> {
    let stored_version = get_user_version(connection)?;
    let inferred_version = infer_schema_version(connection)?;
    let mut current_version = std::cmp::max(stored_version, inferred_version);

    if stored_version != current_version {
        set_user_version(connection, current_version)?;
    }

    // Migration 001: initialize schema.
    if current_version < 1 {
        if !has_table(connection, "prompts")? {
            connection.execute_batch(MIGRATION_001)?;
        }
        set_user_version(connection, 1)?;
        current_version = 1;
    }

    // Migration 002: category + indexes.
    if current_version < 2 {
        if !has_column(connection, "prompts", "category")? {
            connection.execute_batch(MIGRATION_002_CATEGORY)?;
        }
        connection.execute_batch(MIGRATION_002_INDEXES)?;
        set_user_version(connection, 2)?;
        current_version = 2;
    }

    // Migration 003: format support.
    if current_version < 3 {
        if !has_column(connection, "prompt_versions", "format")? {
            connection.execute_batch(MIGRATION_003_FORMAT)?;
        }
        set_user_version(connection, 3)?;
        current_version = 3;
    }

    // Migration 004: soft delete.
    if current_version < 4 {
        if !has_column(connection, "prompts", "deleted_at")? {
            connection.execute_batch(MIGRATION_004_SOFT_DELETE)?;
        }
        set_user_version(connection, 4)?;
        current_version = 4;
    }

    // Migration 005: favorite + rating.
    if current_version < 5 {
        if !has_column(connection, "prompts", "is_favorite")? {
            connection.execute(
                "ALTER TABLE prompts ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0",
                [],
            )?;
        }

        if !has_column(connection, "prompts", "rating")? {
            connection.execute("ALTER TABLE prompts ADD COLUMN rating INTEGER", [])?;
        }

        set_user_version(connection, 5)?;
    }

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle();
            let state = ensure_database(handle)?;
            app.manage(state);
            // Run a background retention cleanup (best-effort): remove telemetry files older than configured days
            // Read retention days from env var PROMPT_VAULT_TELEMETRY_RETENTION_DAYS (positive integer). Fallback to 30.
            let telemetry_dir = handle
                .path()
                .app_local_data_dir()
                .map(|d| d.join("prompt-vault-telemetry"));
            if let Ok(dir) = telemetry_dir {
                let dir_clone = dir.clone();
                // Determine retention days from env, default to 30 if missing or invalid
                let retention_days: i64 = std::env::var("PROMPT_VAULT_TELEMETRY_RETENTION_DAYS")
                    .ok()
                    .and_then(|s| s.parse::<i64>().ok())
                    .filter(|&n| n > 0)
                    .unwrap_or(30);

                println!(
                    "[telemetry][retention] starting background cleanup with retention_days={}",
                    retention_days
                );

                // Spawn a background thread that performs an initial, short-delayed cleanup
                // and then performs a periodic daily cleanup. This keeps long-lived installs
                // from accumulating old telemetry files.
                std::thread::spawn(move || {
                    // Short initial delay to avoid blocking startup I/O heavy operations
                    std::thread::sleep(std::time::Duration::from_secs(2));
                    telemetry_retention_cleanup(&dir_clone, retention_days);

                    // Determine cleanup interval from env: PROMPT_VAULT_TELEMETRY_CLEANUP_INTERVAL_HOURS
                    // If absent or invalid, default to 24 hours.
                    let interval_hours: u64 =
                        std::env::var("PROMPT_VAULT_TELEMETRY_CLEANUP_INTERVAL_HOURS")
                            .ok()
                            .and_then(|s| s.parse::<u64>().ok())
                            .filter(|&n| n > 0)
                            .unwrap_or(24);

                    let interval_secs = interval_hours.saturating_mul(60 * 60);
                    let interval = std::time::Duration::from_secs(interval_secs);
                    loop {
                        std::thread::sleep(interval);
                        telemetry_retention_cleanup(&dir_clone, retention_days);
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_prompts,
            create_prompt,
            add_prompt_version,
            update_prompt,
            list_prompt_versions,
            delete_prompt,
            get_storage_status,
            inspect_legacy_database,
            preview_legacy_recovery,
            execute_legacy_restore,
            execute_backup_restore,
            record_telemetry_event,
            get_telemetry_dir,
            force_telemetry_retention_cleanup,
            nw_secrets_encrypt,
            nw_secrets_decrypt
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn category_prompt_payload(category: Option<&str>) -> CreatePromptPayload {
        CreatePromptPayload {
            slug: "category-round-trip".into(),
            title: "Category round trip".into(),
            description: None,
            category: category.map(str::to_string),
            is_favorite: Some(false),
            rating: None,
            body: "Persist this prompt body".into(),
            semantic_version: "1.0.0".into(),
            changelog: None,
            tags: vec!["native".into()],
        }
    }

    #[test]
    fn tauri_migrations_apply_to_latest_schema_version() {
        let connection = Connection::open_in_memory().expect("open db");
        apply_migrations(&connection).expect("apply migrations");

        let version = get_user_version(&connection).expect("read user_version");
        assert_eq!(version, 5, "expected user_version to be 5 after migrations");

        assert!(has_table(&connection, "prompts").expect("has_table prompts"));
        assert!(has_table(&connection, "prompt_versions").expect("has_table prompt_versions"));

        assert!(has_column(&connection, "prompts", "category").expect("has_column category"));
        assert!(has_column(&connection, "prompts", "deleted_at").expect("has_column deleted_at"));
        assert!(has_column(&connection, "prompts", "is_favorite").expect("has_column is_favorite"));
        assert!(has_column(&connection, "prompts", "rating").expect("has_column rating"));
        assert!(has_column(&connection, "prompt_versions", "format").expect("has_column format"));
    }

    #[test]
    fn tauri_migrations_repair_stale_user_version_via_schema_inference() {
        let connection = Connection::open_in_memory().expect("open db");
        apply_migrations(&connection).expect("apply migrations");

        set_user_version(&connection, 2).expect("force stale user_version");
        let before = get_user_version(&connection).expect("read user_version before");
        assert_eq!(before, 2);

        apply_migrations(&connection).expect("re-apply migrations");
        let after = get_user_version(&connection).expect("read user_version after");
        assert_eq!(after, 5, "expected user_version to be repaired to 5");
    }

    #[test]
    fn native_category_round_trips_through_create_and_list() {
        let mut connection = Connection::open_in_memory().expect("open db");
        apply_migrations(&connection).expect("apply migrations");

        let created = create_prompt_in_connection(
            &mut connection,
            category_prompt_payload(Some("  Research  ")),
        )
        .expect("create prompt");
        assert_eq!(created.prompt.category.as_deref(), Some("Research"));

        let listed = list_prompts_from_connection(&connection).expect("list prompts");
        assert_eq!(listed.prompts.len(), 1);
        assert_eq!(listed.prompts[0].category.as_deref(), Some("Research"));
        assert_eq!(listed.prompts[0].tags, vec!["native"]);
    }

    #[test]
    fn native_category_update_distinguishes_omitted_set_and_clear() {
        let mut connection = Connection::open_in_memory().expect("open db");
        apply_migrations(&connection).expect("apply migrations");
        let created =
            create_prompt_in_connection(&mut connection, category_prompt_payload(Some("Research")))
                .expect("create prompt");
        let id = created.prompt.id;

        let omitted: UpdatePromptPayload = serde_json::from_value(serde_json::json!({
            "id": id,
            "title": "Renamed"
        }))
        .expect("deserialize omitted category");
        assert!(omitted.category.is_none());
        let unchanged = update_prompt_in_connection(&connection, omitted).expect("update title");
        assert_eq!(unchanged.prompt.category.as_deref(), Some("Research"));

        let set: UpdatePromptPayload = serde_json::from_value(serde_json::json!({
            "id": unchanged.prompt.id,
            "category": "  Writing  ",
            "rating": 4
        }))
        .expect("deserialize category value");
        assert_eq!(
            set.category.as_ref().and_then(Option::as_deref),
            Some("  Writing  ")
        );
        let updated = update_prompt_in_connection(&connection, set).expect("set category");
        assert_eq!(updated.prompt.category.as_deref(), Some("Writing"));
        assert_eq!(updated.prompt.rating, Some(4));

        let clear: UpdatePromptPayload = serde_json::from_value(serde_json::json!({
            "id": updated.prompt.id,
            "category": null,
            "rating": null
        }))
        .expect("deserialize category clear");
        assert_eq!(clear.category, Some(None));
        assert_eq!(clear.rating, Some(None));
        let cleared = update_prompt_in_connection(&connection, clear).expect("clear category");
        assert_eq!(cleared.prompt.category, None);
        assert_eq!(cleared.prompt.rating, None);
    }

    #[test]
    fn native_category_survives_database_reopen_and_migration_path() {
        let tmp = TempDir::new().expect("create tempdir");
        let database_path = tmp.path().join("prompt-vault.db");
        let prompt_id = {
            let mut connection = Connection::open(&database_path).expect("open db");
            apply_migrations(&connection).expect("apply migrations");
            create_prompt_in_connection(&mut connection, category_prompt_payload(Some("Durable")))
                .expect("create prompt")
                .prompt
                .id
        };

        let reopened = Connection::open(&database_path).expect("reopen db");
        apply_migrations(&reopened).expect("reapply migrations");
        let listed = list_prompts_from_connection(&reopened).expect("list reopened prompts");
        let prompt = listed
            .prompts
            .into_iter()
            .find(|prompt| prompt.id == prompt_id)
            .expect("persisted prompt");
        assert_eq!(prompt.category.as_deref(), Some("Durable"));
    }

    fn recovery_document(slug: &str, include_second: bool) -> RecoveryDocument {
        let mut versions = vec![RecoveryVersion {
            source_id: Some("legacy-version-1".into()),
            semantic_version: "1.0.0".into(),
            body: "Original recovery body".into(),
            body_hash: sha256_text("Original recovery body"),
            changelog: Some("Initial".into()),
            created_at: "2026-01-01T00:00:00.000Z".into(),
            updated_at: "2026-01-01T00:00:00.000Z".into(),
        }];
        if include_second {
            versions.push(RecoveryVersion {
                source_id: Some("legacy-version-2".into()),
                semantic_version: "1.1.0".into(),
                body: "Second recovery body".into(),
                body_hash: sha256_text("Second recovery body"),
                changelog: Some("Second".into()),
                created_at: "2026-01-02T00:00:00.000Z".into(),
                updated_at: "2026-01-02T00:00:00.000Z".into(),
            });
        }
        RecoveryDocument {
            format: "prompt-vault-backup".into(),
            source_version: "2.0".into(),
            exported_at: "2026-02-01T00:00:00.000Z".into(),
            history_coverage: "full-history".into(),
            prompts: vec![RecoveryPrompt {
                source_id: Some("legacy-prompt".into()),
                slug: slug.into(),
                title: "Recovery fixture".into(),
                description: Some("Disposable source".into()),
                category: Some("Safety".into()),
                is_favorite: true,
                rating: Some(5),
                tags: vec!["alpha".into(), "recovery".into()],
                created_at: "2026-01-01T00:00:00.000Z".into(),
                updated_at: if include_second {
                    "2026-01-02T00:00:00.000Z".into()
                } else {
                    "2026-01-01T00:00:00.000Z".into()
                },
                versions,
            }],
        }
    }

    fn recovery_plan(
        connection: &Connection,
        document: &RecoveryDocument,
        kind: &str,
    ) -> RestorePlan {
        let current = read_recovery_library(connection).expect("read current recovery library");
        let current_prompt = current
            .iter()
            .find(|entry| entry.1.slug == document.prompts[0].slug);
        let current_identities: std::collections::HashSet<String> = current_prompt
            .map(|entry| {
                entry
                    .1
                    .versions
                    .iter()
                    .map(recovery_version_identity)
                    .collect()
            })
            .unwrap_or_default();
        let missing_version_identities = document.prompts[0]
            .versions
            .iter()
            .map(recovery_version_identity)
            .filter(|identity| !current_identities.contains(identity))
            .collect();
        let skipped_version_identities = document.prompts[0]
            .versions
            .iter()
            .map(recovery_version_identity)
            .filter(|identity| current_identities.contains(identity))
            .collect();
        let document_fingerprint =
            sha256_text(&serde_json::to_string(document).expect("serialize recovery document"));
        let entry = RestorePlanEntry {
            source_slug: document.prompts[0].slug.clone(),
            kind: kind.into(),
            current_prompt_id: current_prompt.map(|entry| entry.0.clone()),
            missing_version_identities,
            skipped_version_identities,
            copy_slug: current_prompt.map(|_| format!("{}-imported", document.prompts[0].slug)),
            copy_title: current_prompt.map(|_| "Recovery fixture (imported copy)".into()),
        };
        let mut plan = RestorePlan {
            plan_version: "1".into(),
            plan_id: String::new(),
            source_version: document.source_version.clone(),
            document_fingerprint,
            current_library_fingerprint: fingerprint_library(&current)
                .expect("fingerprint current library"),
            entries: vec![entry],
            warnings: Vec::new(),
        };
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct TestPlanCore<'a> {
            plan_version: &'a str,
            source_version: &'a str,
            document_fingerprint: &'a str,
            current_library_fingerprint: &'a str,
            entries: &'a [RestorePlanEntry],
            warnings: &'a [String],
        }
        plan.plan_id = sha256_text(
            &serde_json::to_string(&TestPlanCore {
                plan_version: &plan.plan_version,
                source_version: &plan.source_version,
                document_fingerprint: &plan.document_fingerprint,
                current_library_fingerprint: &plan.current_library_fingerprint,
                entries: &plan.entries,
                warnings: &plan.warnings,
            })
            .expect("serialize recovery plan"),
        );
        plan
    }

    fn recovery_database_snapshot(connection: &Connection) -> Vec<String> {
        [
            "SELECT COALESCE(group_concat(row_value, ';'), '') FROM (SELECT quote(id)||'|'||quote(slug)||'|'||quote(title)||'|'||quote(created_at)||'|'||quote(updated_at) AS row_value FROM prompts ORDER BY rowid)",
            "SELECT COALESCE(group_concat(row_value, ';'), '') FROM (SELECT quote(id)||'|'||quote(prompt_id)||'|'||quote(semantic_version)||'|'||quote(body)||'|'||quote(created_at)||'|'||quote(updated_at) AS row_value FROM prompt_versions ORDER BY rowid)",
            "SELECT COALESCE(group_concat(row_value, ';'), '') FROM (SELECT quote(id)||'|'||quote(label)||'|'||quote(created_at) AS row_value FROM tags ORDER BY rowid)",
            "SELECT COALESCE(group_concat(row_value, ';'), '') FROM (SELECT quote(prompt_id)||'|'||quote(tag_id) AS row_value FROM prompt_tags ORDER BY rowid)",
        ]
        .iter()
        .map(|sql| {
            connection
                .query_row(sql, [], |row| row.get(0))
                .expect("snapshot recovery table")
        })
        .collect()
    }

    #[test]
    fn native_recovery_fingerprints_match_the_typescript_contract() {
        let connection = Connection::open_in_memory().expect("open database");
        apply_migrations(&connection).expect("apply migrations");
        let document = recovery_document("cross-runtime", true);
        let document_fingerprint =
            sha256_text(&serde_json::to_string(&document).expect("serialize recovery document"));
        assert_eq!(
            document_fingerprint,
            "c4a8cf76a152881df929c7133478333fedfaed60a83370aabcd0fc3fc6170093"
        );
        assert_eq!(
            fingerprint_library(&[]).expect("fingerprint empty library"),
            "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
        );
        let plan = recovery_plan(&connection, &document, "new-prompt");
        assert_eq!(
            plan.plan_id,
            "136afdad207d9b65aa4a17204ac0651ad50182210760b7b695633454f3f71b79"
        );
        let mut unicode_tags = vec!["\u{e000}", "alpha", "😀", "Alpha"];
        unicode_tags.sort_by(|left, right| compare_recovery_tags(left, right));
        assert_eq!(unicode_tags, vec!["Alpha", "alpha", "😀", "\u{e000}"]);
    }

    #[test]
    fn native_recovery_rolls_back_new_prompt_write_stages() {
        for failure_point in [
            "prompt-insertion",
            "version-insertion",
            "tag-insertion",
            "relationship-insertion",
        ] {
            let mut connection = Connection::open_in_memory().expect("open db");
            apply_migrations(&connection).expect("apply migrations");
            let document = recovery_document("native-rollback", false);
            let plan = recovery_plan(&connection, &document, "new-prompt");
            let before = recovery_database_snapshot(&connection);
            let error = execute_backup_restore_on_connection(
                &mut connection,
                ExecuteRestorePayload {
                    document,
                    plan,
                    policy: "skip-existing".into(),
                },
                Some(failure_point),
            )
            .expect_err("injected failure must roll back");
            assert!(error.to_string().contains(failure_point));
            assert_eq!(recovery_database_snapshot(&connection), before);
        }
    }

    #[test]
    fn native_recovery_rolls_back_copy_and_version_merge() {
        for (failure_point, policy, include_second) in [
            ("copy-creation", "import-as-copy", false),
            ("version-merge", "add-missing-versions", true),
        ] {
            let mut connection = Connection::open_in_memory().expect("open db");
            apply_migrations(&connection).expect("apply migrations");
            create_prompt_in_connection(
                &mut connection,
                CreatePromptPayload {
                    slug: "native-conflict".into(),
                    title: "Recovery fixture".into(),
                    description: Some("Disposable source".into()),
                    category: Some("Safety".into()),
                    is_favorite: Some(true),
                    rating: Some(5),
                    body: "Original recovery body".into(),
                    semantic_version: "1.0.0".into(),
                    changelog: Some("Initial".into()),
                    tags: vec!["alpha".into(), "recovery".into()],
                },
            )
            .expect("create current conflict");
            connection
                .execute(
                    "UPDATE prompts SET created_at = ?1, updated_at = ?1 WHERE slug = 'native-conflict'",
                    ["2026-01-01T00:00:00.000Z"],
                )
                .expect("normalize prompt timestamp");
            connection
                .execute(
                    "UPDATE prompt_versions SET created_at = ?1, updated_at = ?1 WHERE semantic_version = '1.0.0'",
                    ["2026-01-01T00:00:00.000Z"],
                )
                .expect("normalize version timestamp");
            let document = recovery_document("native-conflict", include_second);
            let plan = recovery_plan(
                &connection,
                &document,
                if include_second {
                    "mergeable-missing-versions"
                } else {
                    "existing-exact-duplicate"
                },
            );
            let before = recovery_database_snapshot(&connection);
            let error = execute_backup_restore_on_connection(
                &mut connection,
                ExecuteRestorePayload {
                    document,
                    plan,
                    policy: policy.into(),
                },
                Some(failure_point),
            )
            .expect_err("injected failure must roll back");
            assert!(error.to_string().contains(failure_point));
            assert_eq!(recovery_database_snapshot(&connection), before);
        }
    }

    #[test]
    fn native_recovery_commits_verified_full_history() {
        let mut connection = Connection::open_in_memory().expect("open db");
        apply_migrations(&connection).expect("apply migrations");
        let document = recovery_document("native-success", true);
        let plan = recovery_plan(&connection, &document, "new-prompt");
        let result = execute_backup_restore_on_connection(
            &mut connection,
            ExecuteRestorePayload {
                document,
                plan,
                policy: "skip-existing".into(),
            },
            None,
        )
        .expect("execute native recovery");
        assert_eq!(result.new_prompts, 1);
        assert_eq!(result.integrity_result, "ok");
        assert_eq!(database_count(&connection, "prompt_versions").unwrap(), 2);
        assert_eq!(database_count(&connection, "prompt_tags").unwrap(), 2);
    }

    #[test]
    fn legacy_fixture_inspection_and_preview_are_read_only() {
        let temp = TempDir::new().expect("create tempdir");
        let path = temp.path().join("prompt-vault.db");
        {
            let mut connection = Connection::open(&path).expect("open legacy fixture");
            apply_migrations(&connection).expect("apply migrations");
            create_prompt_in_connection(&mut connection, category_prompt_payload(Some("Legacy")))
                .expect("create legacy prompt");
            let prompt_id: String = connection
                .query_row("SELECT id FROM prompts LIMIT 1", [], |row| row.get(0))
                .unwrap();
            connection
                .execute(
                    "INSERT INTO prompt_versions (id, prompt_id, semantic_version, body, changelog, created_at, updated_at) VALUES (?1, ?2, '1.1.0', 'Legacy second body', 'Second', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z')",
                    params![Uuid::new_v4().to_string(), prompt_id],
                )
                .expect("insert second legacy version");
        }
        let before = sha256_file(&path).expect("hash before");
        let status = inspect_legacy_path(&path);
        assert_eq!(status.state, "compatible", "status: {status:?}");
        assert_eq!(status.version_count, Some(2));
        assert_eq!(status.relationship_count, Some(1));
        let preview = read_legacy_recovery_document(&path).expect("preview legacy");
        assert_eq!(preview.document.prompts.len(), 1);
        assert_eq!(preview.document.prompts[0].versions.len(), 2);
        assert_eq!(preview.document.prompts[0].tags, vec!["native"]);
        assert_eq!(preview.source_hash, before);
        assert_eq!(sha256_file(&path).expect("hash after"), before);
    }

    #[test]
    fn legacy_detection_handles_missing_zero_row_unsupported_and_corrupt_sources() {
        let temp = TempDir::new().expect("create tempdir");
        let missing = temp.path().join("missing.db");
        assert_eq!(inspect_legacy_path(&missing).state, "not-found");
        assert!(
            !missing.exists(),
            "inspection must not create a missing source"
        );

        let empty = temp.path().join("empty.db");
        {
            let connection = Connection::open(&empty).expect("create empty compatible fixture");
            apply_migrations(&connection).expect("apply migrations");
        }
        let empty_status = inspect_legacy_path(&empty);
        assert_eq!(empty_status.state, "compatible", "status: {empty_status:?}");
        let empty_preview = read_legacy_recovery_document(&empty).expect("preview zero-row source");
        assert!(empty_preview.document.prompts.is_empty());

        let unsupported = temp.path().join("unsupported.db");
        Connection::open(&unsupported)
            .expect("create unsupported fixture")
            .execute("CREATE TABLE unrelated (id TEXT)", [])
            .expect("create unsupported table");
        assert_eq!(
            inspect_legacy_path(&unsupported).state,
            "unsupported-schema"
        );

        let corrupt = temp.path().join("corrupt.db");
        std::fs::write(&corrupt, b"not sqlite").expect("write corrupt fixture");
        assert_eq!(inspect_legacy_path(&corrupt).state, "corrupt");
    }

    #[test]
    fn old_compatible_legacy_source_restores_without_inventing_unavailable_fields() {
        let temp = TempDir::new().expect("create tempdir");
        let source_path = temp.path().join("old-compatible.db");
        {
            let connection = Connection::open(&source_path).expect("open old source");
            connection
                .execute_batch(
                    "CREATE TABLE prompts (
                       id TEXT PRIMARY KEY,
                       slug TEXT NOT NULL UNIQUE,
                       title TEXT,
                       description TEXT,
                       created_at TEXT NOT NULL,
                       updated_at TEXT NOT NULL
                     );
                     CREATE TABLE prompt_versions (
                       id TEXT PRIMARY KEY,
                       prompt_id TEXT NOT NULL REFERENCES prompts(id),
                       semantic_version TEXT NOT NULL,
                       body TEXT NOT NULL,
                       created_at TEXT NOT NULL,
                       updated_at TEXT NOT NULL
                     );
                     INSERT INTO prompts VALUES (
                       'old-prompt', 'old-compatible', 'Old compatible', NULL,
                       '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z'
                     );
                     INSERT INTO prompt_versions VALUES (
                       'old-version', 'old-prompt', '1.0.0', 'Old body',
                       '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z'
                     );",
                )
                .expect("create old schema");
        }
        let source_hash = sha256_file(&source_path).expect("hash old source");
        let preview = read_legacy_recovery_document(&source_path).expect("preview old source");
        let source_prompt = &preview.document.prompts[0];
        assert_eq!(source_prompt.category, None);
        assert!(!source_prompt.is_favorite);
        assert_eq!(source_prompt.rating, None);
        assert!(source_prompt.tags.is_empty());
        assert_eq!(source_prompt.versions[0].changelog, None);

        let mut target = Connection::open_in_memory().expect("open target");
        apply_migrations(&target).expect("migrate target");
        let plan = recovery_plan(&target, &preview.document, "new-prompt");
        let result = execute_backup_restore_on_connection(
            &mut target,
            ExecuteRestorePayload {
                document: preview.document,
                plan,
                policy: "skip-existing".into(),
            },
            None,
        )
        .expect("restore old source");
        assert_eq!(result.new_prompts, 1);
        assert_eq!(database_count(&target, "prompt_versions").unwrap(), 1);
        assert_eq!(
            sha256_file(&source_path).expect("hash source after"),
            source_hash
        );
    }

    #[test]
    fn test_persist_and_rotate_and_metrics() {
        let tmp = TempDir::new().expect("create tempdir");
        let dir = tmp.path();

        // small max bytes so rotation happens quickly during test
        let max_bytes = 100u64;

        let payload = serde_json::json!({
            "name": "test_event",
            "message": "hello",
        });

        // write multiple times to exceed rotation
        for _ in 0..10 {
            persist_telemetry_to_dir(dir, &payload, max_bytes).expect("persist ok");
        }

        // assert that at least one rotated file exists or the main file exists
        let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
        let base = dir.join(format!("telemetry-{}.log", today));
        let rotated = dir.join(format!("telemetry-{}.1.log", today));
        assert!(
            base.exists() || rotated.exists(),
            "expected base or rotated file"
        );

        let metrics_path = dir.join("telemetry-metrics.json");
        assert!(metrics_path.exists(), "metrics file should exist");
        let content = std::fs::read_to_string(metrics_path).expect("read metrics");
        let metrics: serde_json::Value = serde_json::from_str(&content).expect("parse metrics");
        let key = format!("event_count:{}", "test_event");
        assert!(
            metrics.get(&key).is_some(),
            "metrics should contain event counter"
        );
    }
}
