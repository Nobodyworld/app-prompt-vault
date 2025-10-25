#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use once_cell::sync::Lazy;
use regex::Regex;
use rusqlite::{params, Connection, Error as SqlError, ErrorCode, OptionalExtension};
use semver::Version;
use serde::{Deserialize, Serialize};
use std::ops::Deref;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use thiserror::Error;
use uuid::Uuid;

const MIGRATIONS: &str = include_str!("../../src/db/migrations/001_init.sql");

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
    body: String,
    semantic_version: String,
    changelog: Option<String>,
    tags: Vec<String>,
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

#[tauri::command]
async fn add_prompt_version(
    state: State<'_, AppState>,
    payload: AddVersionPayload,
) -> Result<AddVersionResponse, String> {
    add_prompt_version_inner(state, payload).map_err(|error| error.to_string())
}

fn list_prompts_inner(state: State<'_, AppState>) -> Result<ListPromptsResponse, AppError> {
    let connection_guard = state
        .connection
        .lock()
        .map_err(|_| AppError::Internal("database lock poisoned".into()))?;

    let mut stmt = connection_guard.prepare(
        "SELECT id, slug, title, description, created_at, updated_at
     FROM prompts
     ORDER BY updated_at DESC",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok(PartialPrompt {
            id: row.get(0)?,
            slug: row.get(1)?,
            title: row.get(2)?,
            description: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
        })
    })?;

    let mut prompts = Vec::new();
    for row in rows {
        let partial = row?;
        prompts.push(compose_prompt_summary(&connection_guard, &partial)?);
    }

    Ok(ListPromptsResponse { prompts })
}

fn create_prompt_inner(
    state: State<'_, AppState>,
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

    let mut connection = state
        .connection
        .lock()
        .map_err(|_| AppError::Internal("database lock poisoned".into()))?;

    let tx = connection.transaction()?;
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    tx.execute(
        "INSERT INTO prompts (id, slug, title, description, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![id, slug, title, description, now,],
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
        &connection,
        &PartialPrompt {
            id: id.clone(),
            slug,
            title,
            description,
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

struct PartialPrompt {
    id: String,
    slug: String,
    title: String,
    description: Option<String>,
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

    let database_path = base_dir.join("prompt-vault.db");
    let connection = Connection::open(&database_path)?;
    connection.pragma_update(None, "foreign_keys", "ON")?;
    connection.execute_batch(MIGRATIONS)?;

    Ok(AppState {
        connection: Mutex::new(connection),
    })
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle();
            let state = ensure_database(&handle)?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_prompts,
            create_prompt,
            add_prompt_version
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
