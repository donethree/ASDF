---
name: live-continuation
description: Use when a manually started interactive ASDF item waits for design answers, approval or PR activity, receives chat feedback, or its registered live check fires
---

# Continue the current interactive work

This controller stays in the originating conversation. It uses the host's
session scheduler, not do-next, another CLI process or a sleeping shell command.
Unattended do-next, persistent workers (`ASDF_WORKER_REQUEST`) and subagents
never enter it or create watches. A scheduled check for an existing live watch
retains its original **live** mode; it is not an unattended worker.

## Identity and ownership

Carry `threadId` (one generated UUID), `rootItemId` (original PBI/Task/Feature),
current item ID and `origin: live` through handoffs. Scheduled prompts also carry
the current watchId/generation. Use CLI paths from the session context and verify
the configured context/item identity on entry, not paths copied from old chat.
The item-local `live-watch.json` is authoritative; `live-info -Id <id>` reads it.

While live-protected, pass `-Owner <current operation owner>` to item-set,
item-repo, stage, signals, ledger-add and task-brief, as well as the existing
execution helpers. Refresh execution-context before code work and after a
handoff. A reservation is not an operation lock or permission to change ADO.
Never reuse an old owner from a scheduled prompt.

Lifecycle commands below use the session's `asdf.ts` CLI prefix:

```text
live-finish -Id <id> -WatchId <key> -Generation <n> -Owner <owner> -ReadsSucceeded true
live-finish -Id <id> -WatchId <key> -Generation <n> -Owner <owner> -ReadsSucceeded false
live-suspend -Id <id> -WatchId <key> -Generation <n> -Owner <owner>
live-stop -Id <id> -WatchId <key> -Generation <n> -Owner <owner>
```

The returned watch supplies the authoritative next key/generation. A live
controller sets `auditPassId = threadId` for shared router logging.

## Arm an external wait

Supported waits: awaiting-answers, awaiting-approval, pr-open and merging.
With the item's operation lock held:

1. Discover the host scheduler's actual schema. When `manage_schedule` supports
   create/list/stop, use it below. If unavailable or disallowed, say automatic
   checks are unavailable; release ownership and retain manual/do-next behavior.
   Do not enable experiments, change permissions or substitute a daemon.
2. `live-prepare -Id <id> -Owner <owner> -ThreadId <threadId> -RootId <rootId>`.
   Save the returned key and presented target. Reuse an already-armed matching
   schedule only after confirming it still exists in this host conversation.
3. Create one schedule with `action: "create"`, `interval: "5m"`, and a prompt
   of this shape (substitute actual returned values):

   ```text
   ASDF live check: item <id>, watch <watchId>, generation <generation>.
   Use asdf:live-continuation in this same originating interactive thread.
   Reload live-info and validate this exact key before acquiring an operation.
   Stop stale checks; do not run do-next, create workers or infer approval from chat history.
   CLI: <quoted executable/script from session context>; context: <context path>.
   ```

4. Bind the actual returned numeric ID:
   `live-bind -Id <id> -Owner <owner> -WatchId <key> -Generation <n> -ScheduleId <host id>`.
   Only after successful bind, announce five-minute checks while this session
   runs, release the operation lock, and end the turn without a blocking approval
   form. The user can approve or give feedback in chat or ADO.
5. If create/bind fails, stop only the schedule just created, call live-stop
   under still-valid ownership, and report the failure. If the outcome is
   uncertain, list schedules and reconcile the exact unique prompt marker.
   Never invent a schedule ID, assume a persisted file proves a live timer,
   or remove another thread's watch.

One unchanged wait reuses its generation/schedule. Do not create another timer
on every check. Timers may run late while the host is busy, asleep or stopped.
Normal interactive question forms may block processing; never promise active
polling while such a form remains pending.

## Scheduled check or chat reentry

1. Read live-info and current item state. A stopped/missing/mismatched key is stale: do no item work.
   Stop only the old schedule, identified by its own returned ID or an exact
   watchId/generation prompt match from the host's schedule list. Never stop
   the newer schedule now recorded on the item.
   A paused, blocked or done item also ends this monitor. Cancel this thread's
   matching host schedule even if another operation prevents local live-stop;
   leave that operation and item metadata alone rather than polling forever.
2. Generate a new operation UUID. Call
   `live-enter -Id <id> -WatchId <key> -Generation <n> -Owner <new owner>`.
   If acquired is false, another operation or persistent worker owns the work.
   Defer without writes, stealing ownership or duplicate dispatch.
   Reread item state; if now terminal, cancel only this thread's timer. A
   read-only ADO assignment check may also establish reassignment and end this
   timer without item mutations. Failed reads or lock contention alone never
   establish reassignment.
   Interrupted preparing/checking/working records can enter once their normal
   operation lock is free or stale; do not reject them merely for their phase.
   If the schedule is unbound, missing or entry reports schedule reconciliation,
   use the restore sequence below. Recovery clears retired working-generation
   timer bindings; do not renew against the old schedule ID.
3. Under this operation, reread item/config, current ADO assignment and parent
   roles, design owner/latest attachment-version/request, and required signals.
   Use the independent tracked-ID assignment recipe, never discovery membership.
   For designs read current task state/change timestamp and complete new comments;
   for PRs read review threads, votes, build/check/conflict state and status.
4. If required reads fail or are incomplete, do not apply signals. Call
   `live-finish ... -ReadsSucceeded false`; it releases the lock without
   extending the old reservation. Report the first changed error and normal
   init/MCP access guidance; suppress repeated identical chatter. Keep the
   schedule so access recovery is noticed without a manual continue prompt.
   If restoration found no host schedule, report that monitoring could not be
   restored; do not claim a timer exists or renew priority after failed reads.
5. Otherwise apply `signals -Id <id> -Owner <owner> -File "<fresh signals>"`,
   then reread the item. Approval/feedback is decided by shared signal rules.
   On reassignment, pause/block, abandonment or done, call live-stop under this
   ownership, cancel the exact retired schedule, and end monitoring. Do not
   route terminal state through live-finish or leave a recurring no-op check.
   If still at the same wait/target, `live-finish ... -ReadsSucceeded true`
   renews priority for 15 minutes and releases the operation; remain quiet.
6. On an actionable change or new chat input, `live-suspend` with the current
   key/owner. Use its **new** generation for subsequent commands, stop its
   retired schedule, and retain the operation lock while continuing. A queued
   old tick is now harmless. Failed schedule deletion is reported; never claim
   it stopped, and reconcile its exact old marker without blocking valid work.
7. If ownership is lost, stop immediately without further item/ADO writes or
   unlock. An expired reservation may already have been taken by do-next:
   reread actual state on a later successful acquisition, never replay old work.

If ADO shows a different design version than the presented target, do not apply
chat approval to it. Suspend/reconcile and present the current version before
asking for approval. Do not renew a stale target just to suppress automation.
Reassignment, paused/blocked state, abandoned PR, explicit stop or done ends
monitoring; completed PRs retain the existing ownership-checked close-out path.

## Chat approval or feedback

Owned HLD/Breakdown only: recheck current ADO owner and the presented/current
target first. Shared designs cannot be approved/revised by proxy. A conditional
or ambiguous "approval" is a question/change request, not authorization to build.
When several design targets are possible, clarify the target with ask_user.

After entering/suspending, save this input under the item and call live-interaction
with Id/Owner/WatchId/Generation/File:

```json
{"kind":"feedback","target":{"designId":43,"version":2,"requestedAt":"<current cutoff>","roundPostedAt":null},"author":"<actual person>","summary":"<concise feedback>"}
```

Use kind approval only for clear approval of that exact version. The returned
interactionId is a retry receipt. Feedback immediately marks a pending revision
and routes answers-received before any old approval can be reused.

Post the session-feedback or session-approval template with this receipt
reference. Before retrying a post, read comments and reuse the matching receipt;
do not duplicate it. Record local questions/decisions with session provenance.
Identical pending input reuses its receipt. If earlier feedback is still pending, reconcile, consume and publish/forward
it before accepting another receipt; retain the new message rather than
overwriting the pending feedback.
For approval, mark an ASDF-owned design task Completed before acknowledging;
never close the Feature itself in the self-ID fallback. Confirm these ADO
effects through MCP, then call:

```text
live-recorded -Id <id> -Owner <owner> -WatchId <key> -Generation <n> -InteractionId <receipt> -CommentId <confirmed ADO comment id>
```

This records provenance and applies current owned approval, then continue
immediately. Failed ADO writes are not approval. Retain pending receipts/feedback,
report the failure and reconcile before retry; do not implement the old design.
Revised requests follow brainstorming's pending-feedback and publication
preflight protocol. Fresh owners use design-feedback-info/recorded/consume,
not the retired live key. Publication clears only recorded, consumed feedback
after publishing a newer version/cutoff.

When scheduling is unavailable, these same helpers can serve a manual chat
turn: acquire the ordinary item lock, live-prepare then live-suspend without
creating/binding a timer. Do not advertise polling. Explicit stop retires the
local watch; manual rejoin starts fresh under ordinary ownership rules.

## Continue work, PRs and Feature children

Dispatch `asdf:work-item` with origin live, held owner, threadId and rootItemId.
Its shared stage table handles planning/implementation/review/merge in this
conversation. At the next supported wait return here once. Do not recurse into
intake, do-next or a persistent CLI worker.

PR chat "approved" never substitutes for votes or branch policies. Live PR
feedback may direct code changes with recorded provenance, but cannot fabricate
a PR thread, vote, green build or completed merge. Follow the existing review,
fresh merge checks and close-out exactly.

After Feature approval, create/reuse/start its no-prerequisite PBIs as today,
then refresh all recorded children with their actual type, parent, assignment
and state category. `live-child -Id <feature> -File "<complete child snapshot>"`
selects the first eligible tracked PBI in breakdown order. Use -Visited only
for children already attempted in this handoff; reread completed state rather
than relying on chat claims. Never start a prerequisite-gated Proposed child.

The child snapshot is a JSON array with one fresh entry for every recorded PBI:
`{"id":43,"parentId":50,"type":"User Story","assignedToMe":true,"stateCategory":"InProgress"}`.
Use actual type/state metadata and assignment evidence, not these example values.
Each post-bootstrap child mutation also acquires that child's separate lock;
the Feature's operation does not own child item files.

Release the parent's lock before acquiring the selected child's own lock.
Transfer threadId/rootItemId, not the old watch/owner. Run one child through its
next waits and PR lifecycle; after done, reread the Feature and choose the next.
Another owner is deferred, never displaced. Only the active child is reserved.
If none can proceed, stop this thread's monitor and report prerequisites/owners.
Feature close-out still requires its existing all-children-complete checks.

## Stop, restore and observe

On explicit stop, invalidate with live-stop under owned access, cancel the
matching host schedule and retain all artifacts. Stop is not deletion of work.
On a restored session:

1. Read live-info and list host schedules, matching this thread's exact
   watchId/generation prompt. A stopped or mismatched scheduled prompt exits;
   only an explicit manual rejoin may start a new watch.
   Retain the prior schedule ID for cleanup; before cancelling it, verify its
   listed prompt belongs to this watch/thread, even if its generation is older.
2. Use a new owner with live-enter for the persisted key, including an
   interrupted preparing/checking state. Normal stale-lock recovery applies;
   a fresh lock or persistent claim means defer, never remove it.
3. Under acquired ownership, reread ADO and item state. Terminal state stops
   monitoring. Failed reads follow the failed-read path without renewing.
4. If the recorded bound schedule still exists and target/wait are unchanged,
   finish the successful check and reuse it. Otherwise cancel only matching
   old schedules, including an orphan created before bind. Reconcile ambiguous
   cancellation before creating another. Call live-prepare with the same
   thread/root under the held owner; its new generation replaces the interrupted
   check. Create one five-minute schedule for that returned key, bind its
   actual ID, then release ownership. Do not bind the new ID to an old armed
   generation or treat a saved schedule ID as proof of a running timer.

Use live-info/session-info for current state. Log only meaningful transitions,
approval/feedback receipt status or changed failures through automation-log with
threadId as the correlation ID. Never log chat bodies or each unchanged poll.
Warnings from observation do not replay successful operations. Existing
permissions, business blockers, version/assignment gates and worker recovery
remain in force.
