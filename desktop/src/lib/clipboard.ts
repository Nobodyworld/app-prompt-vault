export async function copyTextToClipboard(text: string): Promise<void> {
  if (!text) {
    return;
  }

  // Try modern Clipboard API first
  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    navigator.clipboard.writeText
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (error) {
      // Clipboard API failed - likely due to permissions policy or HTTPS requirement
      console.warn("Clipboard API failed:", error);
      // Check if it's a permissions-related error
      if (
        error instanceof Error &&
        (error.message.includes("permissions") ||
          error.message.includes("blocked") ||
          error.name === "NotAllowedError")
      ) {
        throw new Error("CLIPBOARD_PERMISSIONS_BLOCKED");
      }
      // Fall through to fallback method
    }
  }

  // Fallback method for browsers without Clipboard API or when API is blocked
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "absolute";
    textarea.style.left = "-9999px";
    textarea.style.top = "-9999px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);

    // Select and copy
    const range = document.createRange();
    range.selectNodeContents(textarea);
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
      textarea.setSelectionRange(0, text.length);
    }

    const successful = document.execCommand("copy");
    document.body.removeChild(textarea);

    if (!successful) {
      throw new Error("FALLBACK_COPY_FAILED");
    }
  } catch (error) {
    console.error("Failed to copy text to clipboard:", error);
    // As a last resort, show the text in an alert so user can manually copy
    alert(`Copy this text manually:\n\n${text}`);
    throw new Error("MANUAL_COPY_REQUIRED");
  }
}
