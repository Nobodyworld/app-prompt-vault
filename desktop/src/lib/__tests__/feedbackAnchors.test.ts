import { describe, expect, it } from "vitest";
import {
  isFeedbackRecordId,
  promptFeedbackId,
  versionFeedbackId,
} from "../feedbackAnchors";

describe("Feedback Layer semantic record anchors", () => {
  it("accepts bounded Prompt Vault record identifiers", () => {
    expect(isFeedbackRecordId("prompt-1")).toBe(true);
    expect(isFeedbackRecordId("p_abc_123")).toBe(true);
    expect(isFeedbackRecordId("a".repeat(128))).toBe(true);
  });

  it.each(["", "has space", "../private", "contains.dot", "a".repeat(129)])(
    "rejects a private or malformed record identifier: %s",
    (value) => {
      expect(isFeedbackRecordId(value)).toBe(false);
      expect(() => promptFeedbackId(value)).toThrow(/invalid prompt record ID/);
    },
  );

  it("builds stable prompt and version action identities", () => {
    expect(promptFeedbackId("prompt-1")).toBe("prompt-vault.prompt.prompt-1");
    expect(promptFeedbackId("prompt-1", "copy")).toBe(
      "prompt-vault.prompt.prompt-1.copy",
    );
    expect(promptFeedbackId("prompt-1", "favorite")).toBe(
      "prompt-vault.prompt.prompt-1.favorite",
    );
    expect(promptFeedbackId("prompt-1", "edit")).toBe(
      "prompt-vault.prompt.prompt-1.edit",
    );
    expect(versionFeedbackId("version-old", "preview")).toBe(
      "prompt-vault.editor.version.version-old.preview",
    );
    expect(versionFeedbackId("version-old", "revert")).toBe(
      "prompt-vault.editor.version.version-old.revert",
    );
  });
});
