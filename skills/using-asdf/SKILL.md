---
name: using-asdf
description: Use when starting any session - establishes the ASDF workflow rules and how to find and use ASDF skills
---

<SUBAGENT-STOP>
If you were dispatched as a subagent to execute a specific task, ignore this skill.
</SUBAGENT-STOP>

# Using ASDF

ASDF (Automated Software Development Workflow) runs the whole development cycle against Azure DevOps (ADO) work items. It designs an HLD, gets it approved, plans, implements one task at a time with TDD, reviews its own work, opens the PR, and merges. It does the steering between those steps itself, so people only answer HLD questions, approve the HLD, and review the PR. Every key decision goes into ADO with who made it.

**Persistent worker entry:** if the invocation supplies `ASDF_WORKER_REQUEST`,
load `asdf:work-item`, not intake or do-next. Validate the current request
with `worker-request` before mutations. Old conversation owners and completed
task claims are not authority. The Node runner owns the lock lifecycle;
nested skills never unlock that governing item or recursively dispatch workers.
This exception changes orchestration, not the ADO, approval or code-root rules.

**Live continuation:** direct manually started item work preserves origin live,
threadId and rootItemId through skill handoffs. At design/PR waits use
`asdf:live-continuation` for five-minute same-session checks, chat approval/
feedback and safe resumption. A scheduled prompt for an existing live watch
keeps that live origin. do-next, persistent workers and subagents never arm
these watches. A missing host scheduler is reported, not silently substituted.

## The rules

1. No work starts without a Feature, PBI, User Story, or Task. Large work is a Feature, broken into PBIs that each get their own HLD and PR (`asdf:feature-breakdown`).
2. Azure DevOps is reached only through the Azure DevOps MCP server. Never `az devops`, `az boards`, `az repos`, or REST calls. Code moves with `git`.
3. Nothing ASDF writes goes into the product repo except code changes on ASDF branches. Designs, plans, questions, decisions, reviews and state live in the asdf-context folder.
4. Keep it simple: make the smallest change that delivers the feature. Keep the code readable and manageable, never verbose or bloated. A new dependency needs approval in the HLD.
5. ASDF acts under your name. Every ADO comment it writes starts with `[ASDF]` and uses a template from `asdf:ado-work-items`. Those cover question rounds, approval requests, blockers, task-size and parent requests, Feature splits, HLD updates and proposals, session summaries, and the final and Feature summaries. Never progress chatter.
6. Never vote on a pull request, bypass a branch policy, force-push, or push to main or master. The guard hook blocks these anyway.
7. Record every decision with its provenance: decided by a person, an ASDF assumption approved with the HLD, or an ASDF planning decision.
8. In an unattended run, questions go to ADO as a question round, never to `ask_user`.

## Which skill, when

| Situation | Skill |
|---|---|
| The user asks to work on, build, fix, or change something | `asdf:intake` |
| "do next", "make progress", or an automation run | `asdf:do-next` |
| A runner-supplied worker request or an inline item handoff from do-next | `asdf:work-item` |
| A registered live-check prompt, live approval/feedback, or manual rejoin of a watched item | `asdf:live-continuation` |
| "Answer the open questions for <id>" | `asdf:brainstorming` |
| ASDF isn't initialized, or its settings should change | Tell the user to run the manual setup command shown in session context, then stop; setup is not a skill |
| Any ADO read or write | `asdf:ado-work-items` |

The engine, by stage:

| Stage | Skill |
|---|---|
| Design the HLD, ask questions, request approval | `asdf:brainstorming` |
| Break a Feature into PBIs, or make a large PBI a Feature | `asdf:feature-breakdown` |
| Plan once the HLD is approved | `asdf:writing-plans` |
| Worktree and branch for the item | `asdf:using-git-worktrees` |
| Implement the plan | `asdf:subagent-driven-development` (fallback: `asdf:executing-plans`) |
| Every code change | `asdf:test-driven-development` |
| A bug, a failing test, an unexpected result | `asdf:systematic-debugging` |
| Before claiming anything is done | `asdf:verification-before-completion` |
| Self-review (the Review task) | `asdf:requesting-code-review` |
| PR comments, failed builds, merge conflicts | `asdf:receiving-code-review` |
| Open the PR, merge, close out | `asdf:finishing-a-development-branch` |
| Independent investigations in parallel | `asdf:dispatching-parallel-agents` |
| Changing ASDF's own skills | `asdf:writing-skills` |

## Paths and state

The session context gives you three lines:

- `ASDF plugin root: ...`
- `ASDF CLI: node ".../scripts/asdf.ts" <command>`
- `asdf-context: ...`

In ASDF's skills, `asdf.ts <command>` is short for that CLI line. Use the CLI for all ASDF state: item folders, stages, locks, the work queue, ADO signals, and the SDD workspace. Never edit `state.json` by hand. The CLI prints JSON and exits 1 with `{"error": ...}` on failure. If settings or config are missing, tell the user to run `node "<plugin root>\asdf.js" --init` manually and stop. Never launch the interactive wizard from a skill or automation.

Setup writes local configuration only; MCP preparation is optional and skipped
by default. Discover host-provided ADO tools at runtime using
`asdf:ado-work-items`, including local servers without a saved mcpServer hint.
Only report an access problem when a required operation has no usable candidate.
Include the actual org/project/team, capability and server error. In a live
session clarify that problem; manual init is for correcting setup values,
not for supplying a mandatory server association. Unattended runs report it
without chat questions or changing business stages. There is no separate
first-run verification workflow.

`task-done` also exits nonzero when its test command fails; its JSON keeps `exitCode`, `log` and `recorded`. Completion requires exit 0 and `recorded: true`.

## Item operation: live or unattended

Every top-level item operation uses this protocol, including a direct answer session. `item-new` may create the folder before locking; no other item writes happen before acquisition.

An unfinished persistent worker claim also excludes live/inline operations
and sync, even after the ordinary lease ages. Never remove that claim or
reuse its owner to bypass a deferred lock. The runner and work-item skill
perform the protocol for persistent entry; the runner alone finalizes it.

An unexpired interactive watch also reserves its item. Ordinary lock acquisition
defers to it; the matching live controller uses live-enter with a fresh owner,
not a borrowed token/owner from old chat. While live-protected, include Owner
on item-set, item-repo, stage, ledger-add and task-brief. Wait reservations expire
after 15 minutes without successful required reads; existing active operation
locks and persistent claims retain their own rules.

1. Generate an operation owner with `node -e "console.log(crypto.randomUUID())"` and run `asdf.ts lock -Id <id> -Owner <operation owner>`. If `acquired` is false, leave the item untouched and report it deferred.
2. Pass the same owner through skill handoffs. Nested skills reuse the held lock; they never generate another owner. At entry, before mutations, between long steps, and immediately after a user answer, run `asdf.ts heartbeat -Id <id> -Owner <operation owner>`.
3. Apply gathered signals with `asdf.ts signals -Id <id> -File <file> -Owner <operation owner>` without releasing the lock. Re-read the governing item's assignment before ADO or code writes. If it is no longer yours, run `asdf.ts stage -Id <id> -Stage paused` and stop without ADO writes. A completed PR is the exception: perform only mode 3's ownership-checked close-out, which leaves others' work items untouched; do not pause and restart that terminal loop.
4. The entry point releases the lock when the operation ends or waits for an external answer, including ordinary failures. On ASDF_LOCK_NOT_OWNER, stop immediately: no further commits, comments, state changes or unlock. After a lost live lock, discard the stale snapshot; a later operation reloads it before recording answers.

`session-info -Id <id>` reads the current session/status without running a
model. Its transcript is the last complete export, not necessarily live.
An `ASDF_SESSION_STATUS_FAILED` result with `operationApplied: true` preserves
the completed state mutation: reread it and report the observation failure.

For a second item (for example a new Feature), acquire its own lock before writing it; release it at that handoff's end. Never assume that holding a parent's lock also locks a child.

## Code execution context

Before implementation entry/resume, use `asdf:using-git-worktrees`: the repo's
README and worktree/build/test skills decide how its checkout and branch are
made; ASDF records the result. An existing branch for the item is adopted, not
recreated. Its recorded baseline is reused while checkout and branch are
unchanged; a red baseline is recorded as known failures, and only new failures block.

After creating or reusing an item's code checkout, run `asdf.ts execution-context -Id <id> -Owner <operation owner>`. Save its JSON to `<item>\execution-context.json` and pass that path to every implementation, review and repair worker, including repository-provided reviewers. Inline execution uses the same contract.

The packet names the item and operation owner, exact CLI executable/script,
work-item and repository identities, original workspace, `codeRoot`,
`checkoutMode`, `artifactRoot`, expected branch, current HEAD and target-repository
instruction files. `checkoutMode` is `source` when codeRoot is the configured
checkout itself. Invoke helpers with the packet's quoted `cli.executable` and
`cli.script`, not paths inferred from cwd. The CLI verifies the held lock, the
checkout's repository origin and the recorded branch, and that no other
unfinished item uses the checkout. It does not change the host's cwd or grant permissions.

- Refresh the packet at worker entry, on resume, and before commits or pushes. Compare item, repository, roots, branch and owner with the dispatch; a mismatch stops work rather than silently changing the assignment.
- Before each code-file edit, run `asdf.ts code-path -Id <id> -Owner <operation owner> -Path "<target>"`. Relative paths are rooted at `codeRoot`, never the launcher. Use the returned absolute path in file tools. Paths outside that checkout, another item, artifacts, nested repositories or Git metadata are rejected, including directory-link escapes. During implementation, this also requires a recorded baseline for the checkout and branch.
- Read `instructions.root`, applicable ancestor files from `code-path`'s `instructions.directory`, and applicable `instructions.scoped` files. Scoped entries are candidates: read their scope metadata (`applyTo` or rule paths) and apply only matches. Follow normal instruction trust and precedence; do not replace higher-priority/session rules. Report unresolved conflicts.
- Every shell call specifies the worktree cwd, or explicitly changes to `codeRoot` within that call. Git commands use `git -C "<codeRoot>"`. A previous `cd` does not carry to the next tool call. Never infer a repo from the launch folder.
- `codeRoot` retains the verified configured path spelling for command execution; edit-path checks use native physical paths. On Windows, `task-done` requires a drive-qualified cwd and rejects UNC cwd instead of allowing cmd to fall back elsewhere. Do not create a drive mapping or change permissions automatically.
- Write reports, plans, logs and context packets under this item's `artifactRoot`, using absolute paths. Reviewers write no product code. Git may update shared metadata in the original checkout for fetch/worktree operations; that is not permission to edit its source files.
- Missing directory access or tools blocks the item through the normal permission workflow; never widen access or disable safeguards to proceed. These checks catch misrouting, not arbitrary writes hidden inside a build script: host permissions and sandbox restrictions still apply.

## Copilot tools

- `skill` loads a skill. `task` dispatches a subagent.
- `ask_user` shows a form in a live session.
- The `sql` todos table is your todo list.
- The shell tool (`powershell` on Windows, `bash` elsewhere) runs the ASDF CLI and git.

## Skill discipline

If there's even a small chance a skill applies, load it with the `skill` tool before you act, including before clarifying questions. Announce "Using <skill> to <purpose>" and follow it exactly. Process skills come first (`asdf:brainstorming`, `asdf:systematic-debugging`), then implementation.

| Thought | Reality |
|---|---|
| "This is just a simple question" | Questions are tasks. Check for skills. |
| "Let me explore the codebase first" | Skills tell you how to explore. Check first. |
| "I remember this skill" | Skills change. Load the current version. |
| "The skill is overkill" | Simple things become complex. Use it. |
| "I'll just do this one thing first" | Check before doing anything. |

## User instructions

The user's instructions (`AGENTS.md`, `.github/copilot-instructions.md`, direct requests) take precedence over skills, and skills take precedence over default behavior. ASDF's rules above stay in force unless the user explicitly changes them.
