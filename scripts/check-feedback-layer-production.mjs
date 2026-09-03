import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const DEFAULT_OUTPUT_DIRECTORY = path.join(REPOSITORY_ROOT, "desktop", "dist");
const AUDITED_EXTENSIONS = new Set([".html", ".js", ".css", ".map"]);
const MAX_AUDITED_FILE_BYTES = 64 * 1024 * 1024;
const MAX_REPORTED_FAILURES = 20;

export const FORBIDDEN_PRODUCTION_MARKERS = Object.freeze([
  {
    label: "Feedback Layer global installation",
    pattern: /FeedbackLayer\s*\.\s*install/,
  },
  {
    label: "Feedback Layer SDK host",
    pattern: /feedback-layer-root|data-feedback-layer-ui/,
  },
  {
    label: "Feedback Layer server configuration",
    pattern: /FEEDBACK_LAYER_[A-Z0-9_]+/,
  },
  {
    label: "Feedback Layer protocol route",
    pattern:
      /feedback-layer\.development-integration@|\/integration\/feedback-layer\.development@/,
  },
  {
    label: "Feedback Layer capture API",
    pattern:
      /\/api\/(?:bootstrap\?projectId=|sessions(?:\/|["'`?]|$)|annotations(?:\/|["'`?]|$)|attachments(?:\/|["'`?]|$)|resolution-challenges\/)/,
  },
  {
    label: "Feedback Layer runtime project ID",
    pattern: /project_[a-f0-9]{32}/,
  },
  {
    label: "Feedback Layer development service origin",
    pattern:
      /http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):(?:3178(?:\/|["'`]|$)|\d+\/(?:integration\/feedback-layer|api\/(?:bootstrap|sessions|annotations|attachments|resolution-challenges)))/,
  },
  {
    label: "Prompt Vault pilot loader",
    pattern:
      /@prompt-vault\/feedback-layer|__PROMPT_VAULT_FEEDBACK_LAYER_PILOT_RUNTIME__|prompt-vault-feedback-layer-pilot|Feedback Layer pilot/,
  },
]);

function fail(message) {
  throw new Error(message);
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function boundedRelative(repositoryRoot, candidate) {
  const relative = path.relative(repositoryRoot, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    fail("production output escaped the repository boundary");
  }
  return relative.split(path.sep).join("/");
}

async function verifyContainedPath(repositoryRoot, outputDirectory) {
  let repositoryReal;
  let outputReal;
  try {
    repositoryReal = await fs.realpath(repositoryRoot);
    outputReal = await fs.realpath(outputDirectory);
  } catch {
    fail("production output is missing or unreadable");
  }
  if (!isWithin(repositoryReal, outputReal)) {
    fail("production output redirected outside the repository");
  }

  const outputInfo = await fs.lstat(outputDirectory).catch(() => null);
  if (!outputInfo?.isDirectory() || outputInfo.isSymbolicLink()) {
    fail("production output is not a direct directory");
  }
  return { repositoryReal, outputReal };
}

async function inventoryOutput(repositoryRoot, outputDirectory) {
  const { outputReal } = await verifyContainedPath(
    repositoryRoot,
    outputDirectory,
  );
  const pending = [outputDirectory];
  const files = [];

  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) break;
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      fail(
        `production output is unreadable at ${boundedRelative(
          repositoryRoot,
          directory,
        )}`,
      );
    }

    for (const entry of entries.toSorted((left, right) =>
      left.name.localeCompare(right.name, "en-US"),
    )) {
      const candidate = path.join(directory, entry.name);
      const relative = boundedRelative(repositoryRoot, candidate);
      const info = await fs.lstat(candidate).catch(() => null);
      if (!info) fail(`production output is unreadable at ${relative}`);
      if (info.isSymbolicLink()) {
        fail(`production output contains a redirected entry at ${relative}`);
      }

      const real = await fs.realpath(candidate).catch(() => null);
      if (!real || !isWithin(outputReal, real)) {
        fail(`production output escaped its root at ${relative}`);
      }

      if (info.isDirectory()) {
        pending.push(candidate);
        continue;
      }
      if (!info.isFile() || info.nlink !== 1) {
        fail(`production output contains an unexpected file at ${relative}`);
      }
      if (info.size > MAX_AUDITED_FILE_BYTES) {
        fail(`production output exceeds the audit bound at ${relative}`);
      }
      files.push({ absolute: candidate, relative, size: info.size });
    }
  }

  if (files.length === 0) fail("production output contains no files");
  const indexPath = path.join(outputDirectory, "index.html");
  if (!files.some((file) => path.resolve(file.absolute) === path.resolve(indexPath))) {
    fail("production output is missing desktop/dist/index.html");
  }

  const audited = files.filter((file) =>
    AUDITED_EXTENSIONS.has(path.extname(file.absolute).toLowerCase()),
  );
  for (const required of [".html", ".js", ".css"]) {
    if (
      !audited.some(
        (file) => path.extname(file.absolute).toLowerCase() === required,
      )
    ) {
      fail(`production output is missing generated ${required} assets`);
    }
  }
  return { files, audited };
}

export async function scanFeedbackLayerProduction({
  repositoryRoot = REPOSITORY_ROOT,
  outputDirectory = DEFAULT_OUTPUT_DIRECTORY,
} = {}) {
  const root = path.resolve(repositoryRoot);
  const output = path.resolve(outputDirectory);
  const { files, audited } = await inventoryOutput(root, output);
  const failures = [];
  let auditedBytes = 0;

  for (const file of audited) {
    let text;
    try {
      text = await fs.readFile(file.absolute, "utf8");
    } catch {
      fail(`production output is unreadable at ${file.relative}`);
    }
    auditedBytes += Buffer.byteLength(text, "utf8");

    for (const marker of FORBIDDEN_PRODUCTION_MARKERS) {
      marker.pattern.lastIndex = 0;
      if (marker.pattern.test(text)) {
        failures.push(`${file.relative}: ${marker.label}`);
        if (failures.length >= MAX_REPORTED_FAILURES) break;
      }
    }
    if (failures.length >= MAX_REPORTED_FAILURES) break;
  }

  if (failures.length > 0) {
    fail(
      `executable Feedback Layer pilot material reached production:\n${failures.join(
        "\n",
      )}`,
    );
  }

  return {
    output: boundedRelative(root, output),
    fileCount: files.length,
    auditedFileCount: audited.length,
    auditedBytes,
  };
}

async function runCli() {
  const outputArgument = process.argv
    .slice(2)
    .find((argument) => argument.startsWith("--output="));
  const outputDirectory = outputArgument
    ? path.resolve(outputArgument.slice("--output=".length))
    : DEFAULT_OUTPUT_DIRECTORY;
  const result = await scanFeedbackLayerProduction({
    repositoryRoot: REPOSITORY_ROOT,
    outputDirectory,
  });
  console.log(
    `[feedback-production] PASS output=${result.output} files=${result.fileCount} audited=${result.auditedFileCount} bytes=${result.auditedBytes}`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  runCli().catch((error) => {
    console.error(
      `[feedback-production] FAIL ${error instanceof Error ? error.message : "unknown production scan failure"}`,
    );
    process.exitCode = 1;
  });
}
