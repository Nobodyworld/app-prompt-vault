# Tools (app-prompt-vault)

## Doc Meta

- **Tier:** 3

## Overview

Prompt Vault exposes orchestrator tools (the `pv_*` surface) via the tool registry.

## Canonical Entry Point

- Registration: `src/tools/index.ts` (`registerPromptVaultTools()`)

## Response Envelope (Locked)

- Success responses use `{ data: <payload> }`.
- Errors use `{ error: { code, message, details? } }`.

## Notes

This doc is intentionally lightweight; the authoritative schemas and tool names live in code.

## Examples

### Tool call: search prompts

```json
{

  "tool": "pv_search_prompts",
  "args": {
    "query": "onboarding",
    "tags": ["policy"],
    "limit": 5
  }
}
```

### Envelope example (HTTP API)

Successful response:

```json
{

  "data": {
    "prompt": {
      "id": "pv_123",
      "title": "Onboarding",
      "body": "..."
    }
  }
}
```

Error response:

```json
{

  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": {
      "issues": ["..."],
      "requestId": "...",
      "traceId": "..."
    }
  }
}
```
