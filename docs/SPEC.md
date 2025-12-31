# Prompt Vault App

## Doc Meta

- **Tier:** 3

Prompt Vault is the prompt library for Nobodyworld OS. It stores reusable prompts, organizes them by tags/projects, and exposes them to other apps and the orchestrator.

This document captures scope, data model, and integration points for `app-prompt-vault` in the `nobodyworld_full_build` monorepo.

---

## 1. Standalone Utility

- Create/edit/delete prompts with title, body, tags, and metadata.
- Organize by project and tags for quick retrieval.
- Quick-insert and copy flows for local use.

## 2. Ecosystem Utility

- Hub widgets surface recent/favorite prompts.
- Orchestrator tools search/get/create/update prompts.
- Marketplace packages can install prompt packs into Prompt Vault.
- Planner AiDo and Workflow Buttons reuse prompts as templates or instructions.

## 3. Data Model (high level)

- `prompts` table: id, title, body, tags (taggings), project_tag_id, metadata_json, created_at, updated_at.
- Tagging uses shared `tags`/`taggings` via Core DB.

## 4. Integrations

- **Core DB**: prompt records, taggings, project binding.
- **Event Bus**: emit `pv:prompt_created/updated/deleted`.
- **Orchestrator Tools**: `pv_search`, `pv_get`, `pv_create`, `pv_update`, `pv_delete`.
- **Hub Widgets**: Recent Prompts, Prompt Search.

## 5. UI Requirements (initial)

- List/search prompts by title/tag/project.
- Prompt detail view with copy-to-clipboard.
- Edit/create form with tag + project selection.
- Favorites/pin surface for Hub widget consumption.
