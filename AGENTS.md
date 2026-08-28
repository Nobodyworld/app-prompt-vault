# Repository Agent Instructions

These instructions supplement, and do not weaken, any stricter repository rules in `CONTRIBUTING.md`, scoped `AGENTS.md` files, or `PROJECT_RULESET.md` when that file is present.

## Work-slice workspace hygiene

A work slice is not complete until every temporary workspace created for that slice has been reconciled safely.

### Start-of-slice rules

- Treat the primary checkout and every pre-existing worktree or clone as protected. Do not modify, clean, move, or delete them merely to prepare the slice.
- Run `git worktree list --porcelain` before creating anything. Record the pre-existing paths and refs so they cannot be mistaken for slice-owned workspaces later.
- Use at most one agent-owned temporary worktree for the slice unless concurrent validation genuinely requires more. Reuse it instead of creating serial worktrees.
- Create temporary workspaces outside the primary checkout and only under an approved temporary root. Record each owned path, branch or detached ref, starting SHA, and purpose.
- Do not use a stash as a substitute for preserving or reconciling work.

### Safe reconciliation gate

Before removing an agent-owned worktree or disposable clone:

1. Leave that directory so no process is operating from inside it.
2. Record its path, branch or ref, exact `HEAD`, remotes, and `git status --short --untracked-files=all` output.
3. Inventory ignored paths with `git status --short --ignored=matching` or an equivalent reviewed report. A clean ordinary status is not proof that ignored content is disposable. Preserve or explicitly classify every ignored environment file, database, user-data path, download, evidence artifact, or unknown item.
4. Prove the working tree is clean, including no staged, unstaged, or untracked work.
5. Prove the exact `HEAD` is already preserved by an approved destination such as a pushed branch, pull request, merged base, verified bundle, or explicitly retained rescue ref.
6. Confirm the workspace was created by the current slice, is under an approved temporary root, and is not used by another process.
7. Confirm the workspace root is not a reparse point and that cleanup will not follow a contained link outside the owned workspace.

If any proof is missing, ownership is uncertain, ignored content is unexplained, unique work exists, or deletion would cross the recorded workspace boundary, stop and retain the workspace. Report the blocker; do not force cleanup.

### Normal worktree removal

- Remove a reconciled worktree with `git worktree remove <path>` without `--force`.
- Immediately inspect `git worktree list --porcelain` and the filesystem path.
- If Git still lists the path, cleanup is blocked. Do not use raw deletion, pruning, or force to hide the registered worktree.
- If Git no longer lists the path and the directory is absent, the removal is complete.
- Run `git worktree prune --dry-run` only after understood removals. Prune stale metadata only when every reported entry belongs to a workspace already reconciled and removed safely.

### Residual-directory exception

Normal `git worktree remove` can deregister a worktree yet leave an exact residual directory containing ignored or generated files. Raw removal of that residual is permitted only when all of the following are true:

- the pre-removal reconciliation gate passed and the exact `HEAD` is preserved;
- `git worktree list --porcelain` no longer lists the path;
- the path is the recorded slice-owned path under an approved temporary root, not the primary checkout, a pre-existing workspace, a shared cache, or a parent directory;
- the residual root is not a reparse point, no root or nested `.git` file or directory remains, and any contained links are enumerated, classified as reproducible slice-owned build/package links, and removed without following their targets;
- no process has the residual as its current directory, executable location, profile, database location, or open workspace;
- every remaining item is a previously classified reproducible ignored output such as `node_modules`, `target`, `dist`, coverage, or test results;
- no environment file, secret, database, user data, download, protected evidence, or unknown artifact remains.

Delete only the exact residual path. Recheck that the path is absent, that the primary checkout is unchanged, and that the worktree list contains only the expected entries. The final report must identify the normal removal result, residual classification, exact deletion command, and post-delete verification.

A slice-owned disposable clone may be removed by its exact path only after the same reconciliation gate and path-containment checks pass. Never delete a parent temporary root or unrelated sibling content.

### Prohibited cleanup shortcuts

- Never use `git worktree remove --force`, `git clean -fd`, `git clean -fdx`, or `git reset --hard` to make a cleanup check pass.
- Never use broad or pattern-based raw deletion. Raw removal is limited to a reconciled disposable clone or the residual-directory exception above.
- Never delete a local or remote branch merely because its worktree was removed. Branch deletion requires separate proof that the work is merged or otherwise preserved and explicit authorization when repository policy requires it.
- Never clear shared npm, pnpm, Yarn, Cargo, Rustup, NuGet, pip, Python, Playwright, browser, or operating-system caches during ordinary slice cleanup.
- Never delete environment files, secrets, local databases, user data, fixtures, protected evidence, or unknown untracked or ignored paths.
- Do not run repository-wide garbage collection or aggressive Git maintenance as an incidental cleanup step.

### Required completion evidence

The final slice report must include:

- the primary checkout path and confirmation that it was not cleaned or overwritten;
- before-and-after `git worktree list --porcelain` inventories;
- every temporary worktree or clone created by the slice and its disposition;
- the exact SHA and branch, pull request, merged base, verified bundle, or rescue ref preserving its work;
- the ignored-path inventory and classification used before removal;
- cleanup commands and safety checks actually run;
- any residual-directory exception used and its post-delete proof;
- any retained workspace or storage-heavy path, with the reason it was not removed.

Do not claim the slice complete while an agent-owned temporary workspace remains unexplained.