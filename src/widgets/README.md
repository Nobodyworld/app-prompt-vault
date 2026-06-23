# Widgets (app-prompt-vault)

Reserved for Hub-embeddable widgets exposed by `app-prompt-vault`.

## Notes

- The desktop UI widgets live under `desktop/src/widgets/`.
- This folder is intended for Hub-facing widget entrypoints and contracts.

Implementation:

- Widget metadata is exported from `src/widgets/index.ts`.
- Registration is handled via `registerPromptVaultWidgetsWithPagesWidgets` in `src/widgets/register.ts`.
