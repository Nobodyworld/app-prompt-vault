#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use nw_secrets::{decrypt_from_base64, encrypt_to_base64};
use once_cell::sync::Lazy;
use regex::Regex;
use rusqlite::{params, Connection, Error as SqlError, ErrorCode, OptionalExtension};
use semver::Version;
use serde::{Deserialize, Serialize};
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

struct AppState {
    connection: Mutex<Connection>,
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
    updated_at: String,
    body: String,
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
        "SELECT id, semantic_version, updated_at, body
         FROM prompt_versions
         WHERE prompt_id = ?1
         ORDER BY created_at DESC, rowid DESC",
    )?;

    let rows = stmt.query_map([payload.prompt_id.as_str()], |row| {
        Ok(PromptVersionSummary {
            id: row.get(0)?,
            semantic_version: row.get(1)?,
            updated_at: row.get(2)?,
            body: row.get(3)?,
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
        "SELECT id, semantic_version, updated_at, body
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
                updated_at: row.get(2)?,
                body: row.get(3)?,
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
