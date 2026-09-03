const RECORD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export type PromptFeedbackAction = "copy" | "edit" | "favorite" | "select";
export type VersionFeedbackAction = "preview" | "revert";

export function isFeedbackRecordId(value: string): boolean {
  return RECORD_ID_PATTERN.test(value);
}

function checkedRecordId(value: string, kind: "prompt" | "version"): string {
  if (!isFeedbackRecordId(value)) {
    throw new Error(
      `Cannot expose an invalid ${kind} record ID as a Feedback Layer anchor.`,
    );
  }
  return value;
}

export function promptFeedbackId(
  promptId: string,
  action?: PromptFeedbackAction,
): string {
  const base = `prompt-vault.prompt.${checkedRecordId(promptId, "prompt")}`;
  return action ? `${base}.${action}` : base;
}

export function versionFeedbackId(
  versionId: string,
  action: VersionFeedbackAction,
): string {
  return `prompt-vault.editor.version.${checkedRecordId(versionId, "version")}.${action}`;
}
