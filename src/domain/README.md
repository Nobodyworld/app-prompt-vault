# Domain (app-prompt-vault)

Domain models, invariants, and validation for prompts, templates, and metadata.

Key modules:

- `models.ts`: Core domain types (Prompt, PromptVersion, tags, etc.).
- `validation.ts`: Input validation helpers.
- `templating.ts`: Prompt template rendering.
- `kbLinking.ts`: Knowledge Base link token formatting/parsing (`kb_doc:<id>`).
