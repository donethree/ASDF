# Scenario: a neutral launcher working on two repositories

## Setup

The host starts in `Q:\launch\Coordinator`. Item 201 uses contoso/Commerce/Orders,
workspace `Q:\src\Orders`, branch `user/jdoe/201-orders`, worktree
`Q:\context\worktrees\201-orders`, artifacts `Q:\context\201-orders`, and lock
owner O. Item 202 has a different repository and worktree.

Orders has root AGENTS.md and .github/copilot-instructions.md, a nested
src/billing/AGENTS.md, and .github/instructions/billing.instructions.md whose
applyTo is src/billing/**. The brief edits src/billing/export.ts and runs npm test.
Later, the worktree is on the wrong branch, or its lock belongs to someone else.

## Prompt

Read the current implementation, task-review, re-review, inline-execution,
worktree, final-review and PR-feedback instructions. Do not read Expected or
Result. Dry-run the case above: list the worker context, instructions loaded,
file paths and command working directories, and behavior when branch, path,
repository or owner differs. Do not execute anything.

## Expected

1. A verified execution context explicitly names the item, repository, workspace,
   worktree, branch, artifact directory and operation owner.
2. Relative code paths resolve against the item worktree, never the launcher.
   Original checkouts, other items, escaped links and Git metadata are not code
   write targets. Git alone maintains shared worktree metadata.
3. Workers load root and applicable nested/scoped target-repository instructions.
   They do not assume that git -C or a prompt changes host instructions or cwd.
4. Every command has an explicit worktree cwd, including reviewer fallback diffs.
5. Wrong branch, repository, owner or path stops the operation; it does not
   silently switch branches, widen permissions or fall back to the launcher.
6. The controller writes artifacts only in this item's artifact folder.
   Reviewers remain read-only. Host permission/sandbox restrictions still apply.

## Result

- Baseline: a fresh read-only agent found only the implementer's free-form
  "Work from" field. Task/scoped reviewers lacked a cwd; fallback diffs used
  the launcher. Nested/scoped instruction loading and machine path validation
  were absent. The baseline did recognize the prose worktree and heartbeat rules.
- Post-change fresh-agent run followed all six expectations: explicit packet and
  CLI entry, target-repo instruction loading, absolute edit paths, worktree cwd
  including reviewer fallback, and stop-on-mismatch without permission changes.
- Final review found remaining bare controller BASE and PR-feedback Git commands.
  These now bind codeRoot explicitly; an executable regression runs the actual
  BASE snippet with a diverged original checkout to ensure it returns the
  worktree's HEAD. Command cwd retains its verified configured spelling, while
  physical identity and containment checks still resolve aliases.
