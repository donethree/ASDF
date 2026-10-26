---
name: using-git-worktrees
description: Use when starting or resuming implementation, or when an item's worktree creation, initialization or baseline build fails
---

# Using Git Worktrees (ASDF)

The repository's own README decides how a feature branch and checkout are made.
ASDF follows it, then records what exists. Without README guidance, ASDF makes
a short linked worktree from the default branch. Worktrees may live outside asdf-context, but never inside another checkout or item artifact folder.

**Announce at start:** "I'm using the using-git-worktrees skill to set up the item's checkout."

Hold the item operation lock from `asdf:using-asdf`. The app's selected project
is only the launch location; the repository is the configured `repo.clonePath`.

## 1. Reuse what's there

Run `asdf.ts item -Id <id>`. If `repo.worktreePath` is set and exists, run
`execution-context` and save the packet. On success go to step 4. A missing
recorded directory can be a reserved path from an interrupted creation: continue
to step 3 with that same path. Never move, reset or replace an existing checkout.

## 2. The workspace

The item's code is in its workspace, `repo.clonePath`: one of the local checkouts registered by the manual `node "<plugin root>\asdf.js" --init` wizard. Never search the disk for code, and never clone a repo.

- **If `repo.clonePath` is empty,** record it: run `asdf.ts item-repo -Id <id> -Name <package>` with the package the work item names, or a person's reply naming one.
- **If nothing names a package with a workspace** (`ASDF_NO_WORKSPACE`): post the `blocker` comment asking which package it is, and list the configured workspaces (`asdf.ts config`) in it. Run `asdf.ts stage -Id <id> -Stage blocked -Reason "package unknown"`, and stop.

## 3. Make the checkout

**Read the repository's guidance first.** Read the workspace's README and the
worktree, bootstrap, build and test documentation it links, plus its root
instructions. Run `asdf.ts repo-skills -RepoPath "<workspace>" -Kind worktree`,
then `-Kind build` and `-Kind test`, and read the returned skills. Also check
host-provided skills for this repo. Do not run another repo's build skill.

Branches must be under user/<userName>/, the only branches the guard lets ASDF push. `repo.branch` (`user/<userName>/<id>-<slug>`) is the default name.

Then pick the first case that applies:

1. **A branch for this item already exists** (yours, or from an earlier attempt),
   even with commits: check it out the way the README says, or use the checkout
   it is already in. Never reset, rebase or recreate it.
2. **The README or a repo skill documents how to start a feature branch** (its
   own worktree script, enlistment init, a branch command, a different base such
   as a last-known-good build branch): follow it exactly, naming the branch under
   `user/<userName>/`. Prefer `repo.branch` unless the README needs another form.
   Run its documented initialization in the resulting checkout.
3. **Otherwise, the default worktree:**
   1. `asdf.ts worktree-path -Id <id> -Owner <operation owner>` reserves a short
      unused path under the init-selected root (at most 13 characters) and records it.
      If the config has no root, direct the user to manual `asdf.js --init`.
   2. `git -C "<workspace>" fetch origin`
   3. `git -C "<workspace>" symbolic-ref --short refs/remotes/origin/HEAD` prints `origin/<default branch>`.
   4. `git -C "<workspace>" worktree add "<returned path>" -b "<repo.branch>" "origin/<default branch>"`.
      If the branch already exists, add the worktree on it without `-b`.

For cases 1 and 2, record the checkout:

```text
asdf.ts checkout-record -Id <id> -Owner <operation owner> -Path "<checkout root>" -Reason "<README procedure or existing branch>"
```

It checks the origin is the item's repository, that a branch under
`user/<userName>/` is checked out, and that no unfinished item uses that
checkout. It records the branch and folder as they are; it switches, resets and
moves nothing. In-place use of the configured checkout is allowed this way.

Then run `asdf.ts execution-context -Id <id> -Owner <operation owner>` and save
the JSON as `<item>\execution-context.json`. It verifies only the lock, the
repository origin, the recorded branch and that no other unfinished item uses
the checkout.

### When setup fails: source-branch fallback

If the default worktree cannot be created or initialized (for example, the
repo's tooling refuses linked worktrees), diagnose with `asdf:systematic-debugging`,
then use the configured checkout instead:

1. Re-read assignment and heartbeat. `git -C "<workspace>" fetch origin`.
   Pick the fetched base the README names (for example `origin/build/main/latest`),
   or the default branch from step 3.
2. `asdf.ts source-fallback -Id <id> -Owner <operation owner> -BaseRef "<origin/...>" -Reason "<initialization failure>"`.
   It switches the clean configured checkout to `repo.branch`: an existing item
   branch is adopted as it is, with its commits; a new one starts at the base.
   It refuses only when the checkout has uncommitted changes or a Git operation
   in progress, or another unfinished item uses it. It never stashes, resets or
   force-checks-out. If you, the person, already have the right branch checked
   out, use `checkout-record` instead: it needs no clean checkout.
3. Save the returned packet, re-read the README, initialize per its steps, and
   run step 4 there.

## 4. Baseline

Run the repository's real build and baseline tests once for each checkout and
branch, after initialization:

```text
asdf.ts baseline -Id <id> -Owner <operation owner> -BuildCommand "<repo build command>" -TestCommand "<repo baseline test command>"
```

- Use the README's or skill's executable commands, not a skill name, `echo` or
  a dry run. A repo with no separate build uses its documented compile or
  validation command. Omit TestCommand only when the repo documents no runnable
  baseline tests, and say why in the ledger.
- `recorded: true` means continue, whether it passed or not. A failing build
  skips the tests.
- **A red baseline is recorded as known failures**, not a blocker. Read
  `baseline.log` and write `<item>\known-failures.md`: each failing build error
  or test, with its file or test name. Implementation continues. Later, only
  failures not in that list block: task-done accepts `-KnownFailure "<which
  known failures>"` only when the baseline was red, and the PR's full-suite
  run compares against the same list.
- **Reuse the recorded baseline** in later sessions. `code-path`, `task-start`
  and `task-done` accept it while the checkout and branch are unchanged and HEAD
  descends from it. Run it again after `checkout-record` or a fallback changes
  the checkout or branch, or when the README says setup changed.

## 5. Cleanup

`asdf:finishing-a-development-branch` performs mode-aware cleanup after merge.
Never remove the configured checkout or a checkout recorded with `checkout-record`.

## Common mistakes

| Mistake | Instead |
|---|---|
| Creating a fresh ASDF branch while your branch for the item already has commits | Adopt the existing branch and record it with `checkout-record`. |
| Ignoring the README's branch or bootstrap procedure | The README decides; ASDF records the result. |
| Blocking because the default branch's build is red | Record known failures; only new failures block. |
| Re-running a long build on every resume | Reuse the recorded baseline while checkout, branch and history are unchanged. |
| Switching branches in a checkout with uncommitted work | Leave it; ask the person, or record their checked-out branch. |
| Searching the disk for the repo | Only the workspaces listed in init. Block and ask which package. |
