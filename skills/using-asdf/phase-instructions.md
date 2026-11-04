# Repository phase instructions

Required at the phase boundaries named in the workflow skills, including direct
entry and resume. This is shared support for those skills, not another skill or
an extra controller loop.

## Discover and interpret

After validating identity, current ownership, lock and the phase's gates, read:

```text
asdf.ts phase-instructions -Id <id> -Phase <phase>
```

The read-only result is `{path,exists,phase,before,after}`. It selects by
`item.repo.org/project/name`, never the work item's project, title, artifact
folder or launch checkout. Manual init creates:

```text
<context>\custom-instructions\org-<encoded lowercase org>\project-<encoded lowercase project>\repo-<encoded lowercase repo>\instructions.json
```

The JSON has `schemaVersion: 1` and `phases`, with all phase names below mapped
to `{ "before": "", "after": "" }`. Use the returned path, not an invented
sanitization. Missing templates on older installations return `exists:false`
and empty hooks. Missing or empty hooks are no-ops: preserve the default flow
and do not ask anyone to supply instructions.

Before repository resolution, do not guess hooks. Resolve the workspace using
the owning skill's existing discovery/question path; immediately apply `before`
once identity is known, before the remaining work of that phase. A phase that
ends without a repository has no repository hooks; do not replay it later.
For a multi-repo Feature, resolve every named configured workspace's full
identity explicitly. Read each repository separately with
`asdf.ts phase-instructions -Org <org> -Project "<project>" -Repo "<repo>" -Phase <phase>`.
This verifies the configured workspace and applies the same path/schema checks.
Do not combine `-Id` with the qualified identity. The item-ID form is only for the Feature's actual single
`item.repo`, if any; never temporarily assign a child's repo, borrow its hooks,
or merge several repositories' instructions into one unqualified policy.
Keep each hook's work and checkpoint scoped to its repository.

Hooks are natural-language instructions, not executable shell scripts. Follow
normal instruction precedence, permissions and skill availability checks.
They cannot waive ownership, approved scope/dependencies, branch policy, TDD,
tests, reviews or access gates. A hook's design/dependency change returns to
the existing revision/approval or blocker path; it is not implicit approval.
Malformed/unreadable config (`ASDF_CUSTOM_INSTRUCTIONS_INVALID`), an unavailable
named skill/agent or a permission conflict stops the boundary explicitly:
report the actual failure in live mode; return an infrastructure failure through
work-item/inline bg-orch or worker-fail in unattended mode, without changing the
business stage or silently ignoring/substituting the hook.

## One owner, durable attempts

Only the skill doing the phase executes its hooks. Loading skills, refreshing
an execution packet, controller routing and idle signal polling do not execute
hooks. Children receive the packet's
`customInstructions:{path,exists,schemaVersion:1,phases:{...}}` and the owner's
applicable directions, not a second invocation of its hooks.

1. Read the current item ledger (and relevant archived plan ledgers) first.
   Identify the phase attempt by repository and durable artifact: intake route,
   investigation revision/commits, HLD or breakdown version, approval target/
   cutoff, plan revision, checkout/branch, implementation plan/task range,
   review HEAD, PR ID/source HEAD, feedback thread/update or build revision,
   merge source commit, or close-out PR/version. Session/worker IDs and a changed
   instructions file alone are not new attempts.
   Persist the attempt key before work and carry it through both sides even as
   artifacts/HEAD change; record output versions as evidence, not an automatic
   new attempt on resume.
2. At each actual boundary re-read `phase-instructions`; a session-start packet
   is not a cache. Read again for `after`, so intervening repository edits apply
   to later boundaries. Completed hooks/phases stay completed even if their
   text changes; never restart them on worker startup, compaction or polling.
3. Before a nonempty hook, checkpoint its attempt, side (`before`/`after`),
   exact returned instruction text and intended effects with
   `asdf.ts ledger-add -Id <id> -Owner <owner> -Text "<hook record>"`.
   The CLI returns no instruction revision/hash or hook-acknowledgement field.
   After executing and incorporating its feedback, append completion with
   artifact paths/versions, task/commit range and confirmed external IDs.
   Reached missing/empty hooks get a no-op completion record once, so adding
   text later does not replay a boundary already passed in this attempt.
   Keep hook records when initializing or archiving a plan ledger. Never write
   state.json or truncate history to simulate completion.
4. On interruption, reconcile an in-progress record against artifacts, agent
   results and external effect IDs before resuming. An upload, comment, task
   creation or driver dispatch may have succeeded before completion was logged.
   Do not blindly replay it; an uncertain effect blocks that boundary until
   reconciled. A completed `before` is not repeated just because `after` remains.

For example, ledger text can record `Hook contoso/Commerce/Orders planning P1
after: started; instructions="<returned text>"; input=plan.md`, then
`Hook contoso/Commerce/Orders planning P1 after: complete; artifact=plan.md P1;
check=reviews\plan-check.md; feedback incorporated`. These are evidence rows
written with ledger-add, not new CLI commands or state fields.

`before` runs after the phase's identity/ownership/gate validation, before its
work. `after` runs on the produced artifacts, incorporates feedback, then
reapplies the phase's normal checks before the next stage/skill/handoff.
Hook-added code changes need the same TDD, verification and scoped review as
other changes; neither a hook nor its successful subagent report is a gate pass.

## Boundary owners

| Phase | Owner and boundary |
|---|---|
| `intake` | intake: resolved repository before sizing/routing; snapshot/route ready before the downstream handoff |
| `featureBreakdown` | feature-breakdown: inputs resolved before breakdown drafting; finished breakdown before builder check/publication |
| `investigation` | brainstorming or Feature input gathering: before the code deep dive; deep-dive artifact ready before drafting |
| `design` | brainstorming: before HLD drafting/revision; completed HLD before builder/code checks |
| `designApproval` | design owner: before publishing a request (or adopting an approved design); writing-plans/Feature section 7: confirmed current approval before planning/PBI creation |
| `planning` | writing-plans: approved spec verified before drafting; completed plan before implementation-task descriptions are created/synced or implementation dispatch |
| `checkout` | using-git-worktrees: resolved workspace before checkout/setup; recorded checkout/baseline ready before returning |
| `implementation` | SDD/inline caller, or intake/work-item for a small Task: preflight complete before work/driver dispatch; completed tested/reviewed work before self-review |
| `selfReview` | requesting-code-review: verified context before review packaging/dispatch; reports and fixes ready before PR handoff |
| `pullRequest` | finishing mode 1: self-review passed before suite/push/PR work; existing/created PR and links ready before pr-open/wait |
| `prFeedback` | receiving-code-review: active PR/ownership verified before feedback work; responses/fixes ready before pr-open/wait |
| `merge` | finishing mode 2: fresh merge gates pass before auto-complete; confirmed completed PR, not auto-complete setup, before close-out |
| `closeOut` | finishing mode 3 or Feature section 8: terminal state/ownership rules verified before close-out; summaries/memory ready before cleanup/done |

Only phases actually taken run. Small Tasks skip HLD/planning, not checkout,
implementation, self-review, PR, feedback, merge or close-out hooks.

## Exclusive implementation driver

The executor completes the normal checkout/baseline, scope/dependency and plan
preflight even when `implementation.before` selects a named replacement agent.
Read this selection before any default task dispatch. Verify that exact agent
is available; absence is an explicit failure, never fallback to the default.

Record the selection and dispatch identity in the ledger. Dispatch it **once**
for the remaining approved work, with the approved plan and spec (Task spec on
the small route), current task ledger, verified execution-context packet, known
failures, item owner, artifact/report paths and the default executor's same TDD,
task-completion, test and review requirements. This is a replacement driver,
not an extra parallel implementer or prelude to the default loop. A replacement
driver may coordinate the required implementation/review work; leaf implementer
and reviewer prompts retain their no-subagents contracts.
The caller retains phase-hook ownership. Tell the selected driver that selection
has already occurred: do not reenter driver selection or execute another copy
of before/after hooks. Supply its checkpoint with the dispatch.

Await/reconcile its result, verify task and review evidence, then run
`implementation.after` and ASDF's self-review/PR path. Do not execute the
default implementation loop for its work afterward. On resume use the recorded
driver and unfinished ledger work, never duplicate its dispatch or redo completed
tasks. A failed/incomplete driver is not permission to silently switch engines.
Scoped follow-ups resume that recorded driver, not a second full-plan dispatch.
With no selection, retain SDD and its existing unavailable-subagents inline
fallback. Changing approved design or dependencies still requires approval.
