---
name: using-git-worktrees
description: Use when starting implementation for an ASDF item - creates or reuses the item's worktree and branch outside the repo
---

# Using Git Worktrees (ASDF)

Each ASDF item gets its own git worktree and branch, so several items can be in progress in the same repo without clashing, and the user's own checkout is never touched. Worktrees live under <asdf-context>\worktrees\, never inside the repo.

**Announce at start:** "I'm using the using-git-worktrees skill to set up the item's worktree."

Hold the item operation lock from `asdf:using-asdf`. The app's selected project is only the launch location; it is never a fallback code checkout.

## 1. Reuse what's there

Run `asdf.ts item -Id <id>`. If `repo.worktreePath` is set, run `asdf.ts execution-context -Id <id> -Owner <operation owner>` to verify it before reuse. On success, save the returned packet and skip to step 4. On mismatch, block; never switch branches, overwrite that folder or substitute another checkout. A later `do-next` pass resumes in the same verified worktree.

## 2. The workspace

The item's code is in its workspace, `repo.clonePath`: one of the local checkouts registered by the manual `node "<plugin root>\asdf.js" --init` wizard. Never search the disk for code, and never clone a repo.

- **If `repo.clonePath` is empty,** record it: run `asdf.ts item-repo -Id <id> -Name <package>` with the package the work item names, or a person's reply naming one.
- **If nothing names a package with a workspace** (`ASDF_NO_WORKSPACE`): post the `blocker` comment asking which package it is, and list the configured workspaces (`asdf.ts config`) in it. Run `asdf.ts stage -Id <id> -Stage blocked -Reason "package unknown"`, and stop.

## 3. Create the worktree

The branch is repo.branch, set when the item was created; never name a branch yourself. It's `user/<userName>/<id>-<slug>`, the only kind of branch the guard lets you push. Below, `<workspace>` is `repo.clonePath`.

First check the recorded workspace is still configured and its origin identifies `repo.org`, `repo.project` and `repo.name`. Use that absolute path, not the host cwd.

1. `git -C "<workspace>" fetch origin`
2. `git -C "<workspace>" symbolic-ref --short refs/remotes/origin/HEAD` prints `origin/<default branch>`.
3. `git -C "<workspace>" worktree add "<asdf-context>\worktrees\<id>-<slug>" -b "<repo.branch>" "origin/<default branch>"`

- **If the branch already exists** (an earlier attempt), add the worktree on that branch without `-b`.
- **Record the location:** write `{"repo":{"worktreePath":"<path>"}}` and run `asdf.ts item-set`.
- **Verify before execution:** run `asdf.ts execution-context -Id <id> -Owner <operation owner>` and save the JSON as `<item>\execution-context.json`. On failure, stop before code edits or builds; use the blocker flow, except lock loss permits no further writes.

## 4. Baseline

Before changing anything, prove the worktree starts clean:

- **Find the commands.** Use the repo's own build and test skills when it has them: run `asdf.ts repo-skills -RepoPath "<worktree>" -Kind build`, then the same with `-Kind test`. Otherwise use the repo's documented commands (README, `.github/copilot-instructions.md`, `AGENTS.md`).
- Load the target-repo instructions from the execution context and run every command with its `codeRoot` as cwd. Do not build in the user's original checkout or the launch project.
- **Record the result** with `asdf.ts ledger-add -Id <id> -Text "baseline: <command> -> <result>"`.
- **If the baseline fails,** record the evidence and block. Existing workspace results may help identify a path-dependent environment, but never run a new build there as a fallback: it could change the user's files. Never build on a red baseline.

## 5. Cleanup

`asdf:finishing-a-development-branch` removes the worktree and the local branch after the merge. Don't remove them earlier: a later pass may need them.

## Common rationalizations

| Excuse | Reality |
|---|---|
| "I'll just work in the user's checkout" | It belongs to the user. Worktrees keep items apart. |
| "A worktree inside the repo is simpler" | It pollutes the repo. Worktrees live in the asdf-context. |
| "The repo isn't cloned; I'll clone it" | Big repos need their own setup. Block and ask. |
| "I'll search the disk for the repo" | Only the workspaces listed in init. Block and ask which package. |
| "The baseline can wait" | A dirty baseline makes every later failure ambiguous. |
