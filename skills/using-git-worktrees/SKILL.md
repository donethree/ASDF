---
name: using-git-worktrees
description: Use when starting or resuming implementation, or when an item's worktree creation, initialization or baseline build fails
---

# Using Git Worktrees (ASDF)

Prefer an isolated worktree on the item's branch. If worktree creation or
repository initialization cannot work, use the validated source-branch fallback
below. Worktrees may live outside asdf-context, but never inside another checkout or item artifact folder.
Manual init collects `worktreeRoot` separately from the context folder. New
worktree paths are at most 13 characters for legacy build-root limits. A short
example is `Q:\w\a1b2c3`; titles and work-item IDs do not lengthen the path.

**Announce at start:** "I'm using the using-git-worktrees skill to set up the item's worktree."

Hold the item operation lock from `asdf:using-asdf`. The app's selected project
is only the launch location; fallback uses only the configured `repo.clonePath`.
This preflight is required on every implementation entry and resume, including
small Tasks. A previous baseline pass does not authorize a new operation.

## 1. Reuse what's there

Run `asdf.ts item -Id <id>`. If `repo.worktreePath` is set and exists, run
`execution-context` to verify it before reuse, wherever it is located. On
success save the packet and continue through discovery and step 4, including
when `checkoutMode` is `source`. A missing recorded directory can
be a reserved path from an interrupted creation: continue to step 3 using that
same path. Never replace an existing directory, switch its branch or move it
automatically. A too-long existing build root needs an explicit `git worktree
move`/record-update operation under ownership, not a drive mapping or bypass.

## 2. The workspace

The item's code is in its workspace, `repo.clonePath`: one of the local checkouts registered by the manual `node "<plugin root>\asdf.js" --init` wizard. Never search the disk for code, and never clone a repo.

- **If `repo.clonePath` is empty,** record it: run `asdf.ts item-repo -Id <id> -Name <package>` with the package the work item names, or a person's reply naming one.
- **If nothing names a package with a workspace** (`ASDF_NO_WORKSPACE`): post the `blocker` comment asking which package it is, and list the configured workspaces (`asdf.ts config`) in it. Run `asdf.ts stage -Id <id> -Stage blocked -Reason "package unknown"`, and stop.

## 3. Create the worktree

The branch is repo.branch, set when the item was created; never name a branch yourself. It's `user/<userName>/<id>-<slug>`, the only kind of branch the guard lets you push. Below, `<workspace>` is `repo.clonePath`.

First check the recorded workspace is still configured and its origin identifies `repo.org`, `repo.project` and `repo.name`. Use that absolute path, not the host cwd.

**Discover before setup, not after a failed generic build.** Read the workspace's
README and linked worktree, bootstrap, build and test documentation, plus its
root instructions. Run `asdf.ts repo-skills -RepoPath "<workspace>" -Kind worktree`,
then `-Kind build` and `-Kind test`. Read applicable returned skill files and
use their tools for checkout creation, environment initialization, build and
tests. Also check host-provided build/test skills for this repo. Discovery
includes `.github`, `.agents`, `.claude` and `.copilot` skill folders.
README is required even when skills exist. Do not run another repo's build skill.

1. `asdf.ts worktree-path -Id <id> -Owner <operation owner>` reserves a stable
   unused short path under the init-selected root and records it on the item.
   It creates no checkout and grants no host permissions. If the old config
   has no root, direct the user to manual `asdf.js --init`; do not guess one.
2. `git -C "<workspace>" fetch origin`
3. `git -C "<workspace>" symbolic-ref --short refs/remotes/origin/HEAD` prints `origin/<default branch>`.
4. `git -C "<workspace>" worktree add "<returned path>" -b "<repo.branch>" "origin/<default branch>"`

- When repository tooling supplies worktree creation, use it with the reserved
  path, recorded branch and fetched remote base instead of generic `worktree add`.
  Run its documented initialization in the resulting checkout. Do not improvise
  path mappings, permissions or setup that contradicts the repository instructions.
- **If the branch already exists** (an earlier attempt), add the worktree on that branch without `-b`.
- **Use the recorded location:** reuse the path returned by worktree-path on
  retries. If another process occupied it, report the collision; never clear it.
- **Verify before execution:** run `asdf.ts execution-context -Id <id> -Owner <operation owner>` and save the JSON as `<item>\execution-context.json`. An identity, branch, lock or access mismatch is a blocker, not grounds for fallback.

### Worktree initialization failure: source-branch fallback

If creation or repository bootstrap fails, retain the error and diagnose with
`asdf:systematic-debugging`. A baseline failure caused by worktree-specific
setup is also eligible. Do not fall back from permission/policy denial, lost
ownership, a wrong repository, or failures in already-implemented code.

1. Re-read assignment and heartbeat. In the configured workspace run
   `git -C "<workspace>" fetch origin`; stop if it fails. Select the existing
   fetched `origin/main`, or `origin/master` if main is absent. Never use a local
   main/master or stale refs after a failed fetch.
2. Run `asdf.ts source-fallback -Id <id> -Owner <operation owner> -BaseRef "<origin/main or origin/master>" -Reason "<initialization failure>"`.
   It requires a clean source checkout, reserves it against other fallback
   items, and creates `repo.branch` from that remote base. It preserves the
   source checkout's previous branch/commit. An existing item branch is usable
   only at exactly that base, with no pending changes. A clean fresh worktree
   is detached, not deleted; dirty or implemented branches block rather than
   being reset. Never stash, force checkout or reset to make fallback succeed.
3. Save the returned execution packet. Its `checkoutMode: source` explicitly
   makes the configured workspace the writable `codeRoot`; never set this mode
   or its evidence by hand. Re-read its README/instructions and discovered
   skills, initialize the feature branch with the repo's documented tools,
   then repeat the entire baseline in step 4. The failed worktree's results
   cannot authorize implementation in the source checkout.

If fallback cannot safely initialize and build, record evidence, post the
blocker and stop. Do not cycle between locations or keep implementing.

## 4. Baseline

Before editing code or dispatching implementation, on every entry/resume:

- Read the actual codeRoot's README, instructions and applicable worktree,
  build and test skills; repeat discovery there if it differs from the source.
  Complete documented environment/bootstrap steps before building.
- Run `asdf.ts baseline -Id <id> -Owner <operation owner> -BuildCommand "<repo build command>" -TestCommand "<repo baseline test command>"`.
  Commands run in the verified `codeRoot`, build first; a failing build skips
  tests. Use the skill's executable commands, not a skill name as a shell command.
  A repo with no separate build uses its documented compile/typecheck/validation
  command; record that choice. Omit TestCommand only when the repo documents no
  runnable baseline tests, recording why. Never substitute `echo`, a dry run,
  guessed commands or an unrelated small test for a real build.
- Continue only on exit 0 and `recorded: true`. Read `baseline.log` and retain
  `baseline.json` in artifactRoot; ledger the commands, codeRoot, HEAD and result.
  `task-start`/`task-done` and implementation `code-path` checks require this
  operation's passing evidence. A failed retry invalidates an earlier pass.
- A worktree-specific initialization failure uses the fallback above. Other
  failures block with evidence. Never implement on a red or unverified baseline.

## 5. Cleanup

`asdf:finishing-a-development-branch` performs mode-aware cleanup after merge.
Never remove a source checkout as though it were a linked worktree.

## Common rationalizations

| Excuse | Reality |
|---|---|
| "I'll just work in the user's checkout" | Only source-fallback can register that checkout, after clean/branch/ownership checks. |
| "A worktree inside the repo is simpler" | It pollutes the repo. Use the separately configured short root, outside source checkouts and artifacts. |
| "The repo isn't cloned; I'll clone it" | Big repos need their own setup. Block and ask. |
| "I'll search the disk for the repo" | Only the workspaces listed in init. Block and ask which package. |
| "The baseline can wait" | A dirty baseline makes every later failure ambiguous. |
| "The last session passed" | Every entry/resume reruns the actual build in the chosen checkout. |
