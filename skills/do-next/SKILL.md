---
name: do-next
description: Use when asked to make progress on ASDF work or run do-next, or when invoked by an automation - one pass through every tracked work item, most-finished work first
---

# do-next: one pass

One pass moves every ASDF item as far forward as it can go right now, then reports what happened. An automation in the Copilot app runs it hourly; a person can run it by hand. It behaves the same either way.

## Execution mode

Bare `/asdf:do-next` or the single argument `inline` keeps work in this
conversation. `/asdf:do-next sessions` uses one persistent CLI conversation
per independently managed item, whether scheduled from the app or CLI.
Reject unknown or conflicting arguments. Do not infer mode from the host.
If this is already an item worker (`ASDF_WORKER_REQUEST` was supplied),
stop rather than recursively running the coordinator.

The rules for a pass:

- **Most-finished work first.** Fixing PR feedback beats merging, which beats implementing, which beats designing.
- **Do not stop after one item.** Keep going until the queue has nothing left that can move.
- **Never call `ask_user` in `do-next`.** Questions go to ADO as question rounds.

## Compact decision log

After preconditions provide the context and pass owner, use that owner as
`auditPassId` for this entire pass. Record operational decisions with the CLI,
not by appending files yourself. For example:

```text
asdf.ts automation-log -PassId <auditPassId> -Action item-selected -Id <id> -Org <org> -Project "<project>" -Stage <stage> -Reason "Selected by actionable queue priority"
```

The CLI writes UTC daily plain-text files at the context root and prunes old
daily logs. It does not capture session content. Reasons are short operational
explanations (at most 240 characters), not copied messages, transcripts, raw
errors/tool output, queries, code, descriptions, credentials or internal reasoning.
Use an optional short `-ErrorCode` rather than a raw error payload. Never pass a
CLI session ID as the pass ID.

Only the coordinator emits these events, after observing the stated condition:

| Action | When / fields |
|---|---|
| `item-tracked` | Successful tracking decision for a new candidate: Id, Org, Project. Say tracking was ensured, not that this pass necessarily created it in a race. |
| `state-changed` | Sync actually changed state: Id, Org, Project, From, To and brief Reason. No unchanged-signal entries. |
| `item-selected` | Candidate selected for a work attempt: Id, Org, Project, Stage and Reason. Selection does not claim successful execution. |
| `item-deferred` | A selected attempt was deferred, or an unresolved ownership problem needs attention: Id and Reason. Routine already-busy scan results are not individually logged. |
| `source-skipped` | An org/source/query could not be used: Org, known Project/Team, short Reason/ErrorCode. Never log its raw response. |
| `item-failed` | A selected operation failed/incomplete/recovery-needed: Id, Outcome and short Reason/ErrorCode. Not for a log-write failure. |
| `pass-finished` | Once at the end: Outcome and optional short counts/summary in Reason. |

Do not log each read, query page, waiting item, managed child, heartbeat, code
edit or tool call. No pass-start entry is required. A fully checked pass with
no tracking, state changes or work attempts emits exactly one
`pass-finished -Outcome no-actionable-work`; no Reason is needed. If required
reads failed, a selected worker failed/returned incomplete/recovery-needed, or
ownership was lost during work, use `incomplete`, not a claim that no actionable
work exists or all selected work was verified. Ordinary lock-acquisition
deferral is not ownership loss during work. Otherwise use `completed`, with a
concise operational summary if useful; a known business blocker may be included
in that summary without pretending the item itself completed.

Pass auditPassId to inline `asdf:work-item` handoffs. Persistent workers already
receive it as request.passId. That router owns `stage-finished` events; do not
duplicate those phase outcomes from its returned result. Coordinator failure/
deferral records describe the overall attempted operation, not another phase.

An automation-log result with `written: false`, warnings, or an event-format
error is an observation problem: report it in the normal pass summary, then
continue otherwise authorized work. Do not mark an item blocked, replay an
action, repeatedly retry logging, expand permissions or recursively log that
warning. Actual operation-ownership errors still obey the normal stop rule;
logging never makes a lost/invalid worker request safe to continue.

## 1. Preconditions

- Run `asdf.ts settings`. If settings or config are missing/invalid, report the actual error and tell the user to run `node "<plugin root>\asdf.js" --init` manually, then stop. Do not invoke a setup skill or launch the wizard unattended.
- Run `asdf.ts config` to get the orgs, projects, MCP servers and work item types.
- Make one owner id for this pass with `node -e "console.log(crypto.randomUUID())"`, and use it for every lock.

## 2. Which orgs can be reached

For each org, check that its `<mcpServer>-wit_work_item` tool is available in this session. Skip any org whose Azure DevOps MCP server is unavailable, and report it.

- The org's items stay untouched.
- The summary names the org/server and says to confirm the values with `node "<plugin root>\asdf.js" --init` and verify the MCP has access to ADO. Include the actual error rather than assuming every failure is a sign-in issue.
- Never fall back to the `az` CLI or REST calls.

Skip any org without a WIQL tool, and report it. The tool is `<mcpServer>-wit_query_by_wiql`, or `wit_query` with a `wiql` action on older local servers. The org's items stay untouched; report the missing capability with the manual setup/MCP access guidance above.

## 3. Sync

Use `asdf:ado-work-items` for per-source discovery and independent tracked-ID
assignment batches. A repository registration is not a watch source. Complete
all pages for a source/batch before relying on its membership; errors remain
unknown, not empty. Never broaden a failed team's scope.

For each reachable org and project needed by a watch source or tracked item:

1. **Find new items.** Union completed discovery results (`asdf:ado-work-items`) and read parents, titles and tags before tracking. Process Features and PBIs before Tasks. Exclude design tasks and managed children using its role and unstarted-Task rules, scoped to the same org; report them as managed by their parent. Preserve already-started standalone child workflows even if their parent is tracked later. For each remaining id that isn't tracked yet, run `asdf.ts item-new` with its org, project, kind (from `workItemTypes`), type, title, and parent if there is one. If item-new returns ASDF_OWN_TASK, skip that id. If item-new returns ASDF_ID_CLASH, skip that id and report it in the summary. Another org's item already uses that id, so ASDF can't track it. Include newly tracked IDs in the independent assignment check.
2. **Lock before refreshing.** Only IDs with a complete assignment batch and successful necessary reads can be refreshed. For each, acquire `asdf.ts lock -Id <id> -Owner <pass owner>` before writing its snapshot or signals file. If acquisition fails, skip all its files and writes. Re-read state after acquiring. Refresh `item.md` while holding the lock. Items that aren't In Progress get no ADO writes, except the approved breakdown's permitted writes to PBIs still assigned to you.
3. **Apply signals.** For every item of the org that isn't `done`:
   - Build its signals file with the recipe in `asdf:ado-work-items`, including only what its stage needs:

     | Section | Include it for |
     |---|---|
     | `workItem`, and `parent` when it has one | Always |
     | `hld`, from the item's design task (an HLD task, or a Feature's Breakdown task) | `awaiting-answers`, `awaiting-approval`, and the build stages and `awaiting-pbis` (for the reopen check) |
     | `pbis` | A Feature at `awaiting-pbis` ("Reading a Feature's PBIs" in `asdf:ado-work-items`) |
     | `pr` | Every item with `ado.prId`, including feedback, ready, blocked, paused and design-revision stages |
     | `blocker` | `blocked` |

   - Set `assignedToMe` from its completed tracked-ID assignment batch, never discovery. A failed/incomplete assignment read leaves that item untouched and deferred from this pass's work queue as well.
   - Write `<item>\signals.json` and run `asdf.ts signals -Id <id> -File <item>\signals.json -Owner <pass owner>`.
   - For a Feature waiting on its PBIs, the result also has `ready`: the PBIs that a person can start now. Keep them for the summary. Never move a waiting PBI to In Progress; list it as ready to start.
   - When signals move an item to blocked, post the blocker comment with that reason. That happens when a PR is abandoned.
   - Release the sync lock before taking another item. If ownership is lost, write nothing further and do not unlock. The queue phase reacquires its item's lock.

## 4. Work the queue

Exclude items whose necessary refresh/assignment reads failed or remain
incomplete this pass, regardless of their previously stored actionable stage.
Do not run a worker on stale state merely because the local queue lists it.

### Persistent mode (`sessions`)

Sync releases its short lock before this phase. Do not acquire a working lock
yourself: the Node runner owns its acquisition, renewal and release.

1. Run `asdf.ts queue-report`. Report `deferred` ownership/recovery problems;
   leave those items untouched and process its healthy `items` in order.
2. Take the first item/stage not already attempted and run:
   `node "<plugin root>\scripts\asdf-worker.ts" -Id <id> -PassId <pass owner>`.
   The runner creates or resumes its exact session ID and calls `asdf:work-item`.
3. Await the existing shell invocation. A background handle or shell timeout
   is not a terminal result: track that handle, never launch the item again.
   Stay sequential within this pass, including while a runner is active.
4. Read the structured result and current state. `completed` requires validated
   worker acknowledgement, not merely exit 0. `deferred` means another operation
   or a now-ineligible item; `incomplete`, `failed` and `recovery-needed` are
   reported with their errors. Do not create an ADO blocker, modify its stage,
   recreate its conversation, or fall back inline on a runner/transport failure.
5. Use `asdf.ts session-info -Id <id>` for inspection paths and waiting status.
   Report `observationError` separately; real progress is not rolled back by a
   failed export/status file. Mark the item's dispatched and returned stages
   attempted for this pass, then move on to other items.

Do not stop after one item. Keep going until no unattempted item/stage can move.
No polling model call is needed for an unchanged waiting item. Signals refresh
its status during sync. Never resume its CLI merely to inspect it.

### Inline mode

Repeat until the queue has nothing you can still move:

1. **Pick.** Run `asdf.ts queue`, and take the first item you haven't already handled at its current stage in this pass.
2. **Lock.** Run `asdf.ts lock -Id <id> -Owner <pass owner>`. If `acquired` is false, another pass has the item: leave it untouched and take the next one.
3. **Work.** Hand the item ID and held pass owner to `asdf:work-item` in inline
   mode. It performs the shared eligibility checks and stage routing, using
   the item's verified execution packet for code work, not the launch directory.

4. **Heartbeat.** Run `asdf.ts heartbeat -Id <id> -Owner <pass owner>` between long steps: every plan task, and every review. If heartbeat fails with ASDF_LOCK_NOT_OWNER, stop working on that item at once and write nothing more. Another pass has taken it over, so don't comment on it, change its stage or unlock it. This isn't a failure for step 6; take the next item.
5. **Unlock.** Run `asdf.ts unlock -Id <id> -Owner <pass owner>` when you're done with the item for now. Always unlock, even after a failure.
6. **If something fails:**
   - An infrastructure failure or `ASDF_SESSION_STATUS_FAILED` with
     `operationApplied: true` is reported locally; do not post an ADO business
     blocker or replay an applied operation. Unlock when owned and continue.
   - For an ordinary business failure:
   - post the `blocker` comment;
   - run `asdf.ts stage -Id <id> -Stage blocked -Reason "<short reason>"`;
   - unlock, and carry on with the next item.
7. **Once per stage.** Never handle the same item at the same stage twice in one pass. If its stage didn't move, it's waiting on something.

## 5. Summary

End the pass with a short summary covering:

- every item touched: id, title, from-stage → to-stage, and what was done;
- in session mode: session ID, status/transcript paths, last export freshness,
  active-run events path and infrastructure/observation errors;
- blocked items, and why;
- skipped orgs (sign-in needed, or no WIQL tool), and ids skipped because of ASDF_ID_CLASH;
- Features waiting on their PBIs, and every PBI that's ready for you to start: "move <id> to In Progress to start it";
- items waiting on people (`awaiting-answers`, `awaiting-approval`, `pr-open`, `awaiting-parent`, `awaiting-pbis`), and what they're waiting for.

## Never

- Never call `ask_user`.
- Never stop after one item while the queue still has work.
- Never work on, or unlock, an item whose lock you don't hold.
- Never use the `az` CLI or REST calls for ADO.
