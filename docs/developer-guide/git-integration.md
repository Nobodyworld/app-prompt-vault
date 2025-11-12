# Git Integration Design Document

## Overview

This document outlines the design for Git integration and synchronization capabilities in Prompt Vault. The goal is to enable users to synchronize their prompt libraries across devices and collaborate on prompt collections.

## Requirements

### Core Use Cases

1. **Personal Sync**: Sync prompts across multiple devices (desktop, laptop, etc.)
2. **Team Collaboration**: Share prompt collections within teams
3. **Version Control**: Track changes to prompts over time
4. **Backup**: Use Git as an additional backup mechanism

### Non-Goals

- Real-time collaboration (like Google Docs)
- Complex merge conflict resolution UI
- Integration with Git hosting services beyond basic push/pull

## Architecture

### Repository Structure

```
prompt-vault-repo/
├── .prompt-vault/
│   ├── config.json          # Vault-specific configuration
│   ├── schema.json          # Schema version and metadata
│   └── sync.json            # Sync state and metadata
├── prompts/                 # Exported prompt files
│   ├── my-prompt.md
│   ├── another-prompt.yaml
│   └── ...
├── .gitignore              # Standard Git ignore
└── README.md               # Repo documentation
```

### Data Flow

1. **Export**: Convert SQLite database to file-based representation
2. **Commit**: Stage and commit changes to Git repository
3. **Push/Pull**: Sync with remote repository
4. **Import**: Convert file-based representation back to SQLite

## Authentication Models

### Option 1: Personal Access Tokens

- Users provide Git credentials (username + PAT)
- Stored securely using system keychain
- Works with GitHub, GitLab, Bitbucket, etc.

### Option 2: SSH Keys

- Users provide SSH private key path
- Key must be added to target Git service
- More secure but higher setup complexity

### Option 3: Local Repositories Only

- No remote sync, local Git operations only
- Simplest implementation, no auth required

## Conflict Resolution Strategy

### Automatic Resolution (Default)

- Last-write-wins for simple conflicts
- Timestamp-based resolution
- Clear logging of resolved conflicts

### Manual Resolution (Advanced)

- Detect conflicts and pause sync
- Provide CLI commands to choose resolution strategy
- Export conflicted versions for manual review

### Conflict Types

1. **Content Conflicts**: Same prompt modified differently
2. **Metadata Conflicts**: Tags, descriptions changed
3. **Deletion Conflicts**: One side deleted, other modified

## On-Disk Layout

### Prompt File Format

Each prompt becomes a separate file with frontmatter:

```yaml
---
id: "uuid-here"
slug: "my-prompt"
title: "My Prompt Title"
description: "Optional description"
format: "markdown"
version: "1.0.0"
tags: ["tag1", "tag2"]
created: "2025-11-11T10:00:00Z"
updated: "2025-11-11T10:00:00Z"
---

# Prompt Content Here

This is the actual prompt content in the specified format.
```

### Directory Structure Options

#### Option A: Flat Structure

```
prompts/
├── prompt-1.md
├── prompt-2.yaml
└── prompt-3.json
```

#### Option B: Organized by Tags

```
prompts/
├── development/
│   ├── code-review.md
│   └── debugging.md
├── writing/
│   ├── blog-posts.md
│   └── documentation.md
└── untagged/
    └── miscellaneous.md
```

#### Option C: Organized by Format

```
prompts/
├── markdown/
├── yaml/
└── json/
```

## Implementation Plan

### Phase 1: Core Sync (MVP)

1. Export/import functionality for file-based representation
2. Basic Git operations (init, add, commit, push, pull)
3. Simple authentication (PAT-based)
4. Automatic conflict resolution

### Phase 2: Enhanced Features

1. Multiple auth methods (SSH support)
2. Advanced conflict resolution
3. Selective sync (sync only certain prompts/tags)
4. Sync status and progress reporting

### Phase 3: Collaboration Features

1. Branch-based workflows
2. Merge request support
3. Team permission management

## CLI Commands

```bash
# Initialize Git sync for a vault
prompt-vault sync init --repo https://github.com/user/my-prompts

# Sync changes (export + commit + push)
prompt-vault sync push

# Pull latest changes (pull + import)
prompt-vault sync pull

# Check sync status
prompt-vault sync status

# Resolve conflicts manually
prompt-vault sync resolve --strategy theirs
```

## Security Considerations

### Credential Storage

- Use system keychain/API for credential storage
- Never store credentials in plain text
- Provide clear warnings about credential usage

### Data Privacy

- Prompts may contain sensitive information
- Repository access controls user's responsibility
- Consider encryption for sensitive prompts

### Network Security

- Use HTTPS for Git operations when possible
- Validate SSL certificates
- Handle network failures gracefully

## Testing Strategy

### Unit Tests

- Export/import logic
- Conflict resolution algorithms
- Authentication handling

### Integration Tests

- Full sync workflows
- Git repository operations
- Network failure scenarios

### E2E Tests

- Complete sync cycles
- Multi-device scenarios
- Conflict resolution workflows

## Open Questions

1. **File Format Evolution**: How to handle schema changes in exported files?
2. **Large Repositories**: Performance implications for libraries with 1000+ prompts?
3. **Binary Content**: How to handle prompts with images or other binary content?
4. **Rate Limiting**: How to handle Git service rate limits during sync?

## Next Steps

1. Create prototype export/import functionality
2. Implement basic Git operations wrapper
3. Add authentication handling
4. Build conflict resolution logic
5. Create comprehensive test suite

## Related Issues

- [Git Integration Implementation](https://github.com/Nobodyworld/app-prompt-vault/issues/xxx)
- [Sync Protocol Design](https://github.com/Nobodyworld/app-prompt-vault/issues/yyy)
