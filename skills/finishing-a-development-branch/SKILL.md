---
name: finishing-a-development-branch
description: Use when an ASDF item has passed self-review (open the PR), is approved and ready (merge), or has merged (close out)
---

# Finishing a Development Branch (ASDF)

ASDF never merges locally. It opens a PR in Azure DevOps, lets reviewers and branch policies decide, merges through auto-complete, then closes the item out. The item's stage picks the mode.

**Verification first** (`asdf:verification-before-completion`): before any mode changes something, confirm the current state with real output (test results, PR state). Never assume it.

Reuse the operation owner from `asdf:using-asdf`. Before modes 1 or 2 push or mutate a PR, fetch its current status if `ado.prId` is set. Completed means `stage merged` and mode 3, not another push or PR; abandoned means a blocker, not recreation. Repeat before subsequent PR writes.

Before builds, repairs, commits or pushes, refresh the verified execution context and follow `asdf:using-asdf`'s Code execution context contract. Use codeRoot cwd and validated absolute edit paths; keep reports in artifactRoot. Only a recorded source-fallback mode authorizes the original checkout; do not substitute it when the item worktree is missing or wrong.

When origin live is supplied, return external pr-open/merging waits to
`asdf:live-continuation` for same-session polling. Chat approval cannot supply
a PR vote or bypass checks. After close-out, return to the live controller for
watch cleanup and any approved Feature child handoff. Unattended runs retain
their existing return behavior and never create live watches.

## Mode 1: open the PR (from stage `self-review`)

1. **Run the full test suite** in codeRoot, through the repo's own test skills when it has them. Don't open a PR on red. Diagnose and repair failures directly with `asdf:systematic-debugging` and TDD, not by redispatching a completed plan. This also applies to small Tasks with no plan. Record each attempt and result in `<item>\reviews\full-suite-repair.md`, retaining the count across passes. Allow at most two repair attempts; if still red, post a blocker and set `stage -Stage blocked -Reason "<failure>"`. Stop rather than re-running reviews every hour. Reset the count only after green or an explicit human reply authorizing another repair cycle. After repair commits, self-review the changed range before continuing.
2. **Push the branch:** `git -C "<codeRoot>" push -u origin <repo.branch>`. Push only repo.branch. Never force-push, never push to main or master.
3. **Create the PR.** Never open a second PR for an item: reuse an active ado.prId. If `ado.prId` is set and that PR is still active, the push in step 2 already added the new commits: update its description, then go to step 5. Otherwise create it with `repo_pull_request_write create` in the item's repo (`repo.project` and `repo.name`, as in `asdf:ado-work-items`):
   - source `<repo.branch>`, target the default branch;
   - title `<id>: <title>`;
   - description from [pr-description-template.md](./pr-description-template.md). Fill in what changed, the work items, every `P<n>` planning decision from `decisions.md`, the self-review summary, and the test results.
4. **Link the work items** to the PR with `wit_work_item_link_write link_to_pull_request`: the governing parent or Task, plus only recorded HLD, Review and implementation ids permitted by the ownership rules. Do not invent links for missing Task-path artifacts.
5. **Update ADO and the item:**
   - If a Review task exists and is still assigned to you, move it to the `Completed` category.
   - Write `{"ado":{"prId":<id>}}` with `asdf.ts item-set`.
   - Run `asdf.ts stage -Id <id> -Stage pr-open`.

## Mode 2: merge (stage `pr-ready`)

The signals say the PR is approved, the build is green, and no threads are active. Check again, live, right now:

- `repo_pull_request get` shows the PR active, with an approval vote (5 or 10) and no vote below 0;
- the latest PR build `succeeded`, or the repo has none;
- no active thread whose last comment is human;
- `mergeStatus` isn't `conflicts`.

Set auto-complete only after ASDF's own merge checks pass. Then:

- `repo_pull_request_write update` with `autoComplete=true`, `deleteSourceBranch=true` and `transitionWorkItems=false`.
- Leave out `mergeStrategy`, so the repo's merge settings apply. Never pass `bypassPolicy`.
- ADO completes the PR as soon as its own policies pass.

Then run `asdf.ts stage -Id <id> -Stage merging`. If a check fails, run `stage pr-open` (or `pr-feedback` if a human thread is waiting) instead, and stop.

## Mode 3: close out (stage `merged`)

Before close-out, compare any local follow-up commits with the completed PR's recorded source commit and inspect uncommitted changes. Preserve work not included in that PR; record a local blocker and, only when the governing item is still yours, post the blocker comment. Do not delete that work or claim it merged.

1. **Close ASDF's tasks.** Re-read each task's assignee. Move an open task to `Completed` only if it is still assigned to you; this includes a standalone Task itself. Close the HLD task only when ado.hldOwned is true. Leave reassigned tasks untouched and name them in the summary.
2. **The parent.** Close the parent only if it is assigned to you and every child task is complete. Otherwise leave it as it is: it may belong to someone else, or other developers' tasks may still be open.
3. **As built.** Append an "As built" section to the local `hld.md`, or to `item.md` for a small Task with no HLD. Record planning and PR-review changes; write "As designed" if nothing differs. Never upload as-built edits over a shared design.
4. **The memory index.** Resolve it with `asdf.ts memory-path -Org <repo.org> -Project <repo.project> -Repo <repo.name>`. Use the returned path, not a name-only index. The CLI qualifies and filesystem-encodes the full repository identity. Append there, creating its parent directories if needed:

   ```
   ## {Type} {id} · {title} · merged {yyyy-MM-dd}
   Repository: {repo.org}/{repo.project}/{repo.name}
   Spec: ..\..\..\{id}-{slug}\{hld.md, or item.md for a small Task}
   Feature: {featureId} · ..\..\..\{featureId}-{featureSlug}\breakdown.md
   - D{n} {decision} ({how it was made})
   - P{n} {decision} (ASDF, while planning)
   ```

   The `Feature:` line is only for one of a Feature's PBIs (its `size` is `phase`).
   Leave legacy name-only indexes untouched. Their entries may be reused only after checking the linked item's stored full repository identity; never infer identity from the filename.

5. **Record the `final-summary`.** Post it on the governing item only if it is still assigned to you. After reassignment, keep the summary locally in `item.md` instead; safe local close-out may still reach `done` without editing another person's work item.
6. **Clean up:**
   - In worktree mode, run `git -C "<repo.clonePath>" worktree remove "<repo.worktreePath>"`, then delete the local branch.
   - In source mode, never remove `repo.clonePath`. Verify it is still clean on
     the item's branch, then switch back to `sourceFallback.previousBranch`
     (or detach at `previousHead` when the original checkout was detached).
     Do not pull, reset or overwrite the user's previous branch. Remove only
     the recorded detached `sourceFallback.worktreePath`, if present and clean,
     and delete the item branch after leaving it. If restoration or removal
     fails, preserve the checkout/reservation and report the local blocker;
     do not mark done and allow another item to take it over.
     Successful `stage done` releases the source reservation: the CLI excludes
     done items when checking source occupancy. Keep sourceFallback metadata
     as history; there is no separate release command.
   - If `<item>\sdd\` exists, delete the briefs, review packages and test logs, and keep `ledger.md`. Small Tasks may have no ledger.
   - Keep everything else in the item folder. It's the memory bank.
   - In particular keep `session\` bindings, run evidence, status and transcripts.
     The persistent CLI cwd is the item artifact folder, never the removed worktree.
7. **Finish:** `asdf.ts stage -Id <id> -Stage done`.

## Never

- Merge locally, push to main or master, or force-push.
- Vote on the PR, or set `bypassPolicy`.
- Set auto-complete before the live checks pass.
- Close a parent that isn't yours, or one with open child tasks.
