import { simpleGit } from "simple-git";
import path from "path";
import fs from "fs/promises";

export interface GitCredentials {
  username: string;
  password: string; // For PAT tokens
}

export interface GitConfig {
  remoteUrl?: string;
  credentials?: GitCredentials;
  authorName?: string;
  authorEmail?: string;
}

export class GitService {
  private git: ReturnType<typeof simpleGit>;
  private repoPath: string;
  private config: GitConfig;

  constructor(repoPath: string, config: GitConfig = {}) {
    this.repoPath = repoPath;
    this.git = simpleGit(repoPath);
    this.config = config;
  }

  /**
   * Initialize a new Git repository
   */
  async init(): Promise<void> {
    await this.git.init();
    await this.git.addConfig(
      "user.name",
      this.config.authorName || "Prompt Vault",
    );
    await this.git.addConfig(
      "user.email",
      this.config.authorEmail || "prompt-vault@localhost",
    );

    // Create .gitignore if it doesn't exist
    const gitignorePath = path.join(this.repoPath, ".gitignore");
    try {
      await fs.access(gitignorePath);
    } catch {
      await fs.writeFile(gitignorePath, this.getDefaultGitignore());
      await this.git.add(".gitignore");
      await this.git.commit("Initial commit: Add .gitignore");
    }
  }

  /**
   * Check if the directory is a Git repository
   */
  async isInitialized(): Promise<boolean> {
    try {
      await this.git.status();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Add remote repository
   */
  async addRemote(name: string, url: string): Promise<void> {
    await this.git.addRemote(name, url);
  }

  /**
   * Remove remote repository
   */
  async removeRemote(name: string): Promise<void> {
    await this.git.removeRemote(name);
  }

  /**
   * Get list of remotes
   */
  async getRemotes(): Promise<Array<{ name: string; url: string }>> {
    const remotes = await this.git.getRemotes(true);
    return remotes.map((remote) => ({
      name: remote.name,
      url: remote.refs.fetch,
    }));
  }

  /**
   * Add files to staging area
   */
  async add(files: string[] = ["."]): Promise<void> {
    await this.git.add(files);
  }

  /**
   * Commit staged changes
   */
  async commit(message: string): Promise<string> {
    const result = await this.git.commit(message);
    return result.commit || "";
  }

  /**
   * Push changes to remote repository
   */
  async push(
    remote: string = "origin",
    branch: string = "main",
  ): Promise<void> {
    if (this.config.credentials) {
      // Configure credentials for push
      await this.git.addConfig("credential.helper", "store");
      // Note: In production, credentials should be handled more securely
    }

    await this.git.push(remote, branch);
  }

  /**
   * Pull changes from remote repository
   */
  async pull(
    remote: string = "origin",
    branch: string = "main",
  ): Promise<void> {
    if (this.config.credentials) {
      // Configure credentials for pull
      await this.git.addConfig("credential.helper", "store");
    }

    await this.git.pull(remote, branch);
  }

  /**
   * Get repository status
   */
  async status(): Promise<{
    isClean: boolean;
    files: Array<{
      path: string;
      index: string;
      working_dir: string;
    }>;
    ahead: number;
    behind: number;
    current: string;
  }> {
    const status = await this.git.status();

    return {
      isClean: status.isClean(),
      files: status.files.map((file) => ({
        path: file.path,
        index: file.index,
        working_dir: file.working_dir,
      })),
      ahead: status.ahead,
      behind: status.behind,
      current: status.current || "HEAD",
    };
  } /**
   * Get commit history
   */
  async log(maxCount: number = 10): Promise<
    Array<{
      hash: string;
      date: string;
      message: string;
      author_name: string;
      author_email: string;
    }>
  > {
    const log = await this.git.log({ maxCount });
    return log.all.map((commit) => ({
      hash: commit.hash,
      date: commit.date,
      message: commit.message,
      author_name: commit.author_name || "",
      author_email: commit.author_email || "",
    }));
  }

  /**
   * Create and checkout a new branch
   */
  async createBranch(branchName: string): Promise<void> {
    await this.git.checkoutLocalBranch(branchName);
  }

  /**
   * Checkout existing branch
   */
  async checkout(branchName: string): Promise<void> {
    await this.git.checkout(branchName);
  }

  /**
   * Get list of branches
   */
  async getBranches(): Promise<{
    current: string;
    local: string[];
    remote: string[];
  }> {
    const branches = await this.git.branch();

    return {
      current: branches.current,
      local: branches.all.filter((b) => !b.includes("remotes/")),
      remote: branches.all
        .filter((b) => b.includes("remotes/"))
        .map((b) => b.replace("remotes/", "")),
    };
  }

  /**
   * Check for conflicts after merge/pull
   */
  async hasConflicts(): Promise<boolean> {
    const status = await this.status();
    return status.files.some(
      (file) => file.working_dir === "U" || file.index === "U",
    );
  }

  /**
   * Abort current merge/rebase operation
   */
  async abortMerge(): Promise<void> {
    try {
      await this.git.merge(["--abort"]);
    } catch {
      try {
        await this.git.rebase(["--abort"]);
      } catch {
        // No merge/rebase in progress
      }
    }
  }

  private getDefaultGitignore(): string {
    return `# Prompt Vault Git Ignore
# OS generated files
.DS_Store
.DS_Store?
._*
.Spotlight-V100
.Trashes
ehthumbs.db
Thumbs.db

# Node.js
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Build outputs
dist/
build/
*.tsbuildinfo

# Environment files
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# IDE files
.vscode/
.idea/
*.swp
*.swo

# Logs
logs/
*.log

# Temporary files
tmp/
temp/
`;
  }
}
