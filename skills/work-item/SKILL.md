---
name: work-item
description: Use when do-next, a live-continuation controller, or a persistent CLI worker hands off one ASDF item
---

# Work one ASDF item

This is the shared single-item stage router. Work only the governing item
in the dispatch. Unattended questions/approval remain in ADO, never chat.
Conversation history is context, not proof of completion or authority.

## Entry and ownership

**Live handoff:** only `asdf:live-continuation` or direct interactive intake
supplies origin live, threadId/rootItemId and a held operation owner. Retain that
mode through stage skills; normal chat questions/feedback/design approval are
allowed. At an external design or PR wait, return to live-continuation once,
not worker-complete. Never invoke do-next or a separate CLI worker from live
mode. `ASDF_WORKER_REQUEST` always takes precedence as persistent, never live.
Include the current Owner on live-protected item-set/item-repo/stage/ledger-add/
task-brief commands as well as normal owner-required helpers.

**Persistent worker:** read the absolute `ASDF_WORKER_REQUEST` file supplied
by the runner. Call its `cli.executable` and `cli.script` with
`worker-request -Id <id> -RunId <runId> -Owner <owner>` before any work.
Use the returned current request, not an owner or stage from old chat.
The Node runner owns acquisition, periodic renewal and final unlock.
Never invoke do-next, another item runner, or session-recover from a worker.

**Inline handoff:** do-next supplies the item ID and held operation owner.
Heartbeat it before work. The caller acquires and releases it; no binding,
worker request or persistent acknowledgement is needed.

**Decision-log correlation:** live mode sets `auditPassId = threadId`; inline do-next supplies `auditPassId`;
persistent entry uses the validated request's `passId`, never its worker owner
or CLI session ID. Direct work without a do-next or live-controller audit context
does not invent one.

Read the current item, config and ledger. Re-read ADO assignment and parent
roles. Skip newly managed children. For a completed PR, perform only the
ownership-checked close-out; otherwise pause a reassigned item without ADO
or code writes. Reuse the existing item worktree and refresh execution-context
before code work; this session's artifact cwd is never the code root.
Completed ledger tasks stay completed even if old chat says otherwise.
Before continuing stage `implementing`, require the executor's
`asdf:using-git-worktrees` preflight: repository guidance discovery, initialization
and a fresh recorded baseline. For a resumed small Task, run it here before
continuing TDD; full-plan executors run it at their entry. Do not edit or dispatch
on an old baseline. Preserve the verified worktree/source checkout mode.

Check the required ASDF skills are enabled and resolve to this plugin before
loading them. Discover ADO tools in this worker process using
`asdf:ado-work-items`, when a step needs ADO access (including WIQL for tracked
assignment). The request's optional mcpServer is a hint; neither an absent hint
nor a different tool prefix is failure. Verify the actual target org/project
through the required reads; the parent session's tool routing is not evidence
that the child has access. A missing/disabled/wrong-source skill, actual ADO
access/capability failure or missing host
permission is an infrastructure failure. Do not enable skills, widen directory
access, change permissions or substitute another plugin. `--no-ask-user`
does not approve tools. Never use `az` or REST for ADO.

## Stage routing

After each skill returns, reread state. Continue to the next actionable stage
until it waits, finishes, fails or the same stage is encountered twice.
Do not repeat an unchanged stage or restart a completed implementation plan.

When auditPassId exists and ownership remains valid, record one observed
`stage-finished` after each router phase, before acknowledgement:

```text
asdf.ts automation-log -PassId <auditPassId> -Action stage-finished -Id <id> -Org <org> -Project "<project>" -From <before> -To <after> -Outcome <outcome> -Reason "<brief operational result>"
```

Choose the log outcome in this order: `blocked` when state is blocked;
`waiting` when it ends in an actual external-wait state (even after progress);
`completed` for other successful phase progress, including done; `no-progress`
when an actionable phase returned without progress. These are log outcomes,
not a replacement for the separate worker acknowledgement contract.
Include all observed changes in a short reason
when a phase's nested skills advanced several stages; do not reconstruct or
copy their session transcript. A preflight reassignment pause is also a
phase outcome after the state actually changes. Routine unchanged waiting
scans belong to the coordinator's one idle summary, not this router.

The coordinator owns tracking, sync transitions, selection, source failures,
overall operation failure/deferral, and the final pass summary. Do not emit
those again. Do not log each coding task, heartbeat, tool call, prompt, response,
raw error, ADO payload, source code, description, credential or internal reasoning.
Reasons must be at most 240 characters. Detailed evidence remains in item artifacts.

If automation-log cannot append or returns cleanup warnings, retain the result
for the caller's summary and continue only otherwise authorized work. A logging
format/I/O error is not a business blocker and never warrants replaying a
successful action. Do not recursively log logging errors or change permissions.
An ownership/worker-request validation error is different: stop under the
existing ownership rule, without further writes. A lost-lock worker does not
write its own failure event; the coordinator can record the returned failure.

| Stage | Skill/action |
|---|---|
| `pr-feedback` | `asdf:receiving-code-review` |
| `pr-ready` | `asdf:finishing-a-development-branch` (merge) |
| `merged` | `asdf:finishing-a-development-branch` (close out only) |
| `pbis-done` | `asdf:feature-breakdown` (close out Feature) |
| `implementing` | Parent or full Task: `asdf:subagent-driven-development`, from ledger; small Task: continue TDD from `asdf:intake` Task routing |
| `self-review` | `asdf:requesting-code-review` |
| `approved` | Feature: `asdf:feature-breakdown`; otherwise `asdf:writing-plans` |
| `answers-received` | Feature: `asdf:feature-breakdown`; otherwise `asdf:brainstorming` |
| `new` | Feature: `asdf:feature-breakdown`; parent: `asdf:brainstorming`; Task: Task routing in `asdf:intake` |

Retain the request owner across skill/subagent handoffs. Refresh execution
packets, load target-repo instructions and use explicit verified codeRoot
paths. No detached helpers or unawaited workers: finish all child work before
acknowledging the run. The runner does not create a second worktree.
Design stays read-only against recorded workspace revisions.

Heartbeat at entry, between long steps, and before mutations. On
`ASDF_LOCK_NOT_OWNER`, stop immediately without further writes or unlock.
Ordinary business failures use the existing blocker comment and
`stage -Id <id> -Stage blocked -Reason "<reason>"`. Infrastructure failures
do not change the business stage or become ADO blocker comments.
`ASDF_SESSION_STATUS_FAILED` with `operationApplied: true` means the state
change succeeded but its observation file failed: reread state, never replay
the successful mutation to repair its display.

## Persistent completion

Use a result file under this run's directory, then acknowledge with:

```text
node "<cli.script>" worker-complete -Id <id> -RunId <runId> -Owner <owner> -File "<result.json>"
```

Run that script through the request's `cli.executable`. The file contains:

```json
{"sessionId":"<current session UUID>","outcome":"waiting","summary":"HLD questions posted; waiting for ADO answers."}
```

Choose `waiting` for a non-actionable wait; `blocked` only when durable stage
is blocked; `progressed` when the stage changed (including done); `deferred`
when no further authorized work is appropriate. The command records actual
stage from state. Acknowledgement is not unlock and is not permission to make
more changes afterward.

For infrastructure failure, write `{"code":"ASDF_WORKER_MCP_UNAVAILABLE","message":"Sign-in needed for the configured ADO server"}` (or another truthful `ASDF_...` code)
and call `worker-fail` with the same Id/RunId/Owner/File arguments.
Do not acknowledge success as well. If even that command is unavailable,
report the error and exit; the runner records an incomplete operation.

End with what changed and what/where the item is waiting for. Do not start
the next item. Inline mode returns this summary to do-next without calling
worker-complete or worker-fail.
Live mode returns to live-continuation for the next wait or authorized Feature
child handoff, without persistent acknowledgement or closing the conversation.
