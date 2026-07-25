import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  access,
  mkdtemp,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { GitService } from "../src/services/GitService.js";
import { PromptVaultService } from "../src/services/PromptVaultService.js";
import { SyncService } from "../src/services/SyncService.js";
import { StructuredLogger } from "../src/observability/logger.js";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];
const databases: Database.Database[] = [];

async function createTemporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function runGit(
  workingDirectory: string,
  ...arguments_: string[]
): Promise<string> {
  const result = await execFileAsync("git", arguments_, {
    cwd: workingDirectory,
    windowsHide: true,
  });
  return result.stdout.trim();
}

function createVaultService(): PromptVaultService {
  const database = new Database(":memory:");
  databases.push(database);
  return new PromptVaultService(database, {
    logger: new StructuredLogger({ level: "error" }),
  });
}

async function seedPrompt(
  service: PromptVaultService,
  slug = "sync-prompt",
): Promise<string> {
  const id = randomUUID();
  await service.createPrompt({
    id,
    slug,
    title: "Sync Prompt",
    description: "Synced description",
    body: "Initial sync body",
    format: "markdown",
    semanticVersion: "1.0.0",
    tags: ["sync", "portable"],
  });
  return id;
}

afterEach(async () => {
  for (const database of databases.splice(0)) {
    if (database.open) {
      database.close();
    }
  }
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("GitService disposable repository behavior", () => {
  it("initializes, commits, reports status and history, and manages branches and remotes", async () => {
    const repositoryPath = await createTemporaryDirectory("pv-git-service-");
    const remotePath = await createTemporaryDirectory("pv-git-remote-");
    await runGit(remotePath, "init", "--bare");
    const service = new GitService(repositoryPath, {
      authorName: "Coverage Author",
      authorEmail: "coverage@example.test",
    });

    expect(await service.isInitialized()).toBe(false);
    await service.init();
    expect(await service.isInitialized()).toBe(true);
    expect(await readFile(join(repositoryPath, ".gitignore"), "utf8")).toContain(
      "node_modules/",
    );

    const initialStatus = await service.status();
    expect(initialStatus.isClean).toBe(true);
    expect(initialStatus.current).not.toBe("");
    expect(await service.hasConflicts()).toBe(false);

    await writeFile(join(repositoryPath, "prompt.md"), "first body");
    const dirty = await service.status();
    expect(dirty.isClean).toBe(false);
    expect(dirty.files).toEqual([
      expect.objectContaining({ path: "prompt.md" }),
    ]);

    await service.add();
    const commit = await service.commit("Add prompt");
    expect(commit).toMatch(/^[0-9a-f]{7,40}$/);
    const log = await service.log(2);
    expect(log[0]).toMatchObject({
      message: "Add prompt",
      author_name: "Coverage Author",
      author_email: "coverage@example.test",
    });
    expect(log[0].hash).toBe(commit);

    const originalBranch = (await service.status()).current;
    await service.createBranch("coverage-branch");
    expect((await service.getBranches()).current).toBe("coverage-branch");
    await service.checkout(originalBranch);
    expect((await service.getBranches()).local).toEqual(
      expect.arrayContaining([originalBranch, "coverage-branch"]),
    );

    await service.addRemote("origin", remotePath);
    expect(await service.getRemotes()).toEqual([
      { name: "origin", url: remotePath },
    ]);
    await service.push("origin", originalBranch);
    expect(
      await runGit(remotePath, "show-ref", `refs/heads/${originalBranch}`),
    ).toContain(`refs/heads/${originalBranch}`);
    await service.pull("origin", originalBranch);
    await service.removeRemote("origin");
    expect(await service.getRemotes()).toEqual([]);

    await expect(service.abortMerge()).resolves.toBeUndefined();
    expect(await service.hasConflicts()).toBe(false);
  }, 20_000);

  it("preserves a caller-managed gitignore instead of replacing or committing it", async () => {
    const repositoryPath = await createTemporaryDirectory("pv-git-existing-");
    await writeFile(join(repositoryPath, ".gitignore"), "caller-owned/\n");
    const service = new GitService(repositoryPath);

    await service.init();

    expect(await readFile(join(repositoryPath, ".gitignore"), "utf8")).toBe(
      "caller-owned/\n",
    );
    const status = await service.status();
    expect(status.isClean).toBe(false);
    expect(status.files[0]).toMatchObject({ path: ".gitignore" });
  });
});

describe("SyncService filesystem and Git integration", () => {
  it("exports deterministically, removes stale prompt files, and imports create and update paths", async () => {
    const repositoryPath = await createTemporaryDirectory("pv-sync-files-");
    const sourceService = createVaultService();
    const promptId = await seedPrompt(sourceService);
    const sourceSync = new SyncService(sourceService, { repoPath: repositoryPath });
    await sourceSync.initialize();

    expect(await sourceSync.isInitialized()).toBe(true);
    const promptsDirectory = join(repositoryPath, "prompts");
    await writeFile(join(promptsDirectory, "stale.json"), "{}");
    await writeFile(join(promptsDirectory, "keep.txt"), "unrelated");

    await sourceSync.export();

    const exportedPath = join(promptsDirectory, "sync-prompt.md");
    const exported = await readFile(exportedPath, "utf8");
    expect(exported).toContain(`id: "${promptId}"`);
    expect(exported).toContain('tags: ["portable","sync"]');
    expect(exported).toContain("Initial sync body");
    await expect(access(join(promptsDirectory, "stale.json"))).rejects.toThrow();
    expect(await readFile(join(promptsDirectory, "keep.txt"), "utf8")).toBe(
      "unrelated",
    );

    const targetService = createVaultService();
    const targetSync = new SyncService(targetService, {
      repoPath: repositoryPath,
    });
    await targetSync.initialize();
    await targetSync.import();
    const imported = await targetService.getPrompt(promptId);
    expect(imported).toMatchObject({
      slug: "sync-prompt",
      title: "Sync Prompt",
      description: "Synced description",
    });
    expect(imported.tags.map((tag) => tag.label)).toEqual([
      "portable",
      "sync",
    ]);

    const updatedFile = exported
      .replace('version: "1.0.0"', 'version: "1.1.0"')
      .replace("Initial sync body", "Updated from filesystem");
    await writeFile(exportedPath, updatedFile);
    await targetSync.import();
    const updated = await targetService.getPrompt(promptId);
    expect(updated.latestVersion).toMatchObject({
      semanticVersion: "1.1.0",
      body: "Updated from filesystem",
    });
    expect(targetService.listPromptVersions(promptId)).toHaveLength(2);
    await targetSync.import();
    expect(targetService.listPromptVersions(promptId)).toHaveLength(2);

    const status = await sourceSync.getStatus();
    expect(status).toMatchObject({
      hasChanges: true,
      remoteAhead: false,
      localAhead: false,
      conflicts: [],
    });
    expect(status.lastSync).toBeInstanceOf(Date);
  });

  it("handles empty directories and rejects malformed prompt files", async () => {
    const repositoryPath = await createTemporaryDirectory("pv-sync-invalid-");
    const service = createVaultService();
    const sync = new SyncService(service, { repoPath: repositoryPath });

    expect(await sync.isInitialized()).toBe(false);
    await expect(sync.export()).resolves.toBeUndefined();
    await expect(sync.import()).resolves.toBeUndefined();

    await sync.initialize();
    const promptsDirectory = join(repositoryPath, "prompts");
    await writeFile(join(promptsDirectory, "invalid.md"), "missing frontmatter");
    await expect(sync.import()).rejects.toThrow("Invalid prompt file format");

    await unlink(join(promptsDirectory, "invalid.md"));
    await writeFile(
      join(promptsDirectory, "fallback.yaml"),
      [
        "---",
        `id: ${JSON.stringify(randomUUID())}`,
        "slug: fallback",
        "title: Fallback",
        "tags: not-an-array",
        "unparsed: plain:value",
        "---",
        "Fallback body",
      ].join("\n"),
    );
    await sync.import();
    const prompts = await service.listAllPrompts();
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject({
      slug: "fallback",
      title: "Fallback",
      description: "",
    });
    expect(prompts[0].latestVersion).toMatchObject({
      semanticVersion: "1.0.0",
      format: "markdown",
      body: "Fallback body",
    });
    expect(prompts[0].tags).toEqual([]);
  });

  it(
    "pushes and pulls through a disposable local bare remote",
    async () => {
      const repositoryPath = await createTemporaryDirectory("pv-sync-push-");
      const remotePath = await createTemporaryDirectory("pv-sync-push-remote-");
      await runGit(remotePath, "init", "--bare");
      const service = createVaultService();
      await seedPrompt(service, "remote-prompt");
      const sync = new SyncService(service, { repoPath: repositoryPath });
      await sync.initialize(remotePath);
      await runGit(repositoryPath, "branch", "-M", "main");

      await sync.push("Synchronize prompt");

      expect(
        await runGit(remotePath, "show-ref", "refs/heads/main"),
      ).toContain("refs/heads/main");
      const files = await readdir(join(repositoryPath, "prompts"));
      expect(files).toEqual(["remote-prompt.md"]);
      await expect(sync.pull()).resolves.toBeUndefined();
      expect((await sync.getStatus()).conflicts).toEqual([]);
    },
    30_000,
  );
});
