---
name: brainstorming
description: Use when an ASDF item needs a design (HLD) or has new answers - drafts the HLD from the work item, asks batched question rounds, records decisions with provenance, and requests approval
---

# Brainstorming: the HLD

ASDF designs before it builds. The HLD is the approved description of what gets built. After approval ASDF works on its own, so every question a person must answer gets asked here, before approval.

Ask only what you can't settle yourself, in batched rounds. Record every decision with where it came from.

This skill handles three cases:

- stage `new`: start a design;
- stage `answers-received`: revise it;
- a live session such as "let's go through the open questions for 12345".

Use the CLI (`asdf.ts`) for state and `asdf:ado-work-items` for every ADO read, write and template.

Acquire or reuse the item operation lock from `asdf:using-asdf`, including direct live answer sessions. Carry its owner through handoffs; heartbeat immediately after each user answer, before recording it.

Preserve an explicitly supplied origin live/thread/root context. If returning
from an external live wait, reacquire through `asdf:live-continuation` first;
the old operation owner was released while waiting. All live-protected CLI
mutations carry the current Owner. Unattended/background entry never creates
a live schedule.

## What people said vs. what you guessed

Keep them apart everywhere. What a person chose is a decision by that person. What you chose is an ASDF assumption until the HLD is approved. Never present a guess as something someone said.

## 1. Set up

Run `asdf.ts item -Id <id>`. If `ado.hldId` is set, carry on. Otherwise look for an existing HLD on the parent first (`asdf:ado-work-items`). Never create a second HLD for a parent that already has one.

**Existing design: recheck ownership on every entry.** Before drafting, revising, requesting approval or recording live approval, read the design task's current assignee and check other tracked items in this org. This item may drive it only when `ado.hldOwned` is true, it is still assigned to you, and no other item drives it. Otherwise follow the shared-design path below, not steps 3 to 10. Reassignment suspends writes, not the recorded ownership relationship; if reassigned back, perform the same current-owner check before resuming.

A driver is an independent item with `hldOwned:true`. Non-owning waiters and legacy child items excluded by sync/queue do not own a design merely because they reference its id.

For a newly tracked PBI, check whether a standalone child already has design or implementation work in progress. Preserve that child workflow. Before planning overlapping parent work, post a blocker on the parent and wait for the child to finish or for the scopes to be explicitly separated. On resumption, account for its shipped changes instead of rebuilding them.

**Pending feedback, in every mode.** Before revising, changing design roles or
publishing, run `asdf.ts design-feedback-info -Id <id> -Owner <owner>`.
It returns the pending marker and, for session feedback, the receipt with its
author/summary; it also repairs a receipt-only interrupted write. Read that
content even when ADO has no new non-ASDF comments. If `recordedAt` is absent,
read complete ADO comments and reuse the comment referencing this interactionId,
or post `session-feedback` once and confirm its ID. Then run
`design-feedback-recorded -Id <id> -Owner <owner> -InteractionId <receipt> -CommentId <confirmed id>`.
These commands work under a fresh background owner after the live watch stops;
do not reuse the retired watch key or create a timer. Failed reconciliation
stops publication, not feedback retention.

**Shared-design path.** Read the owner's latest design and replies, but never
upload a revision, replace its description, close/reopen its task or approve it
by proxy. Record replies and any pending receipt locally with their actual
provenance. Forward this item's unresolved proposal using `hld-proposal` once,
reusing a prior matching comment on retry. After confirming that the owner has
the pending feedback, acknowledge its forwarding with
`design-feedback-consume -Id <id> -Owner <owner> -FeedbackId <pending.feedbackId> -Summary "<what was forwarded and where>"`.
Set the cutoff to the latest consumed human reply, preserving any later existing
cutoff; initialize it to now only if absent. Then run
`design-role -Id <id> -Owner <owner> -Mode shared`. This preserves historical
`hldOwned` and the feedback receipt, marks delegation, and binds approval to a
cutoff no earlier than the recorded feedback. Return to `awaiting-approval`.
No new version is published; only fresh owner approval through signals can
continue. In live mode return to live-continuation to monitor the shared task.

For an existing design this item may currently drive, run
`design-role -Id <id> -Owner <owner> -Mode owned` after the ownership check and
receipt reconciliation. Reassignment back to you requires this fresh check;
historical `hldOwned` alone is not current authority.

- **No HLD yet:** create the HLD and Review tasks together (`asdf:ado-work-items`), store their ids with `"hldOwned":true`, and move the HLD task into the `InProgress` category.
- **An HLD task assigned to you, not Completed, and not driven by another independent item in this org:** it's yours to drive. Store its id with `"hldOwned":true`, create the Review task only if this item has none, and design as below.
- **An HLD task in the `Completed` category:** it's approved already. Store its id and create the Review task. Copy its design (the newest HLD attachment, or the task's description) into `hld.md` and `hld.v1.md`. Write `{"hld":{"version":1,"approvedBy":"state","approvedAt":"<utc now>"}}`, run `asdf.ts stage -Id <id> -Stage approved`, and stop.
- **Anything else** (assigned to someone else, or another item's `ado.hldId`): Never design over an HLD that another person or another ASDF item drives. Store its id, create the Review task, write `{"hld":{"approvalRequestedAt":"<utc now>"}}`, run `asdf.ts stage -Id <id> -Stage awaiting-approval`, and stop. The item waits for that HLD's approval.

## 2. Gather inputs (read-only)

- `item.md`, plus the work item's links and attachments. Download the ones that matter into the item folder.
- **The workspace.** Match the package the work item names (title, description, tags) to a workspace: `asdf.ts item-repo -Id <id> -Name <package>`. Never search the disk for code: an item's code is in one of the configured workspaces. If the work item names no package, or one with no workspace (`ASDF_NO_WORKSPACE`), that's question 1, with the configured workspaces (`asdf.ts config`) as the options. When it's answered, run `item-repo` with the answer.
  If names collide, include the selected workspace's `-Org <org> -Project <project>`; selection is by full repository identity, not the work item's project.
- **The code**, read-only, from the workspace (`repo.clonePath`). Never change its files or branches while designing. Study it in the deep dive (below), once the size check is done.
- **The memory index**, plus the specs it points to. Resolve it with `asdf.ts memory-path -Org <repo.org> -Project <repo.project> -Repo <repo.name>` and read the returned path. Reuse settled decisions and cite them as `per <id> D<n>`. Ask about one only when the new design would contradict it. Legacy name-only indexes are not authoritative: verify every reused entry's linked item has this full repository identity; otherwise leave it out and report the ambiguity.
- The current `hld.md`, `questions.md` and `decisions.md`, if they exist.
- **One of a Feature's PBIs** (its `size` is `phase`): its breakdown is an input too.
  - Read the Feature's approved `breakdown.md` and `decisions.md` from the Feature's item folder (`asdf.ts item -Id <feature id>` gives its `path`). If ASDF doesn't track the Feature, read the newest breakdown attachment on the Feature's Breakdown task.
  - Take the workspace from this PBI's entry in the breakdown, and record it with `item-repo`.
  - Cite the Feature's decisions as `per <feature id> D<n>`. Never ask again what the Feature's breakdown settled.
  - If the Feature's breakdown isn't approved yet, post the `blocker` comment saying the PBI waits for the breakdown of Feature <feature id> to be approved. Run `asdf.ts stage -Id <id> -Stage blocked -Reason "waiting for the breakdown of Feature <feature id>"`, and stop.
  - If a PBI this one waits for isn't done yet (someone started this one early), note that in the HLD's constraints, and design against the code as it is.

### The size check

Check the size of a PBI or User Story at stage `new` before drafting anything. Skip the check if its `size` is already set, if `workItemTypes.feature` is empty, or if a round has been posted (`hld.roundPostedAt` is set, or `hld.version` is above 0). Skip the size check when step 1 adopted an existing HLD task. Its design is already under way. Never ask the size question for one of a Feature's PBIs. Its `size` is `phase`, because the breakdown already sized it.

- **Judge** as `intake` does. Large means the work would ship as separate steps, each a sensible PR on its own, or it changes more than one workspace. When in doubt, it isn't large.
- **Not large:** write `{"size":"one"}` with `item-set`, and carry on with the deep dive.
- **Large:** draft nothing yet, since designing the whole thing would be wasted if the answer is yes. Ask the size question alone in its round. Unattended, post the round (step 6) with only this question, and stop at `awaiting-answers`. In a live session, ask the same with one `ask_user` field (step 5).

  ```
  Q1. This looks like {count} steps that would each ship as their own PR: {steps}. Make it a Feature, with one PBI per step?
    A. Yes, make it a Feature (recommended): {reason}
    B. No, keep it as one PBI and one PR
  ```

### The deep dive

Study the existing code before drafting, so the design reuses what exists, keeps everything that works today working, and handles the edge cases the code already handles. Never draft or revise the HLD before `deep-dive.md` is written. It lives in the item folder. The HLD is built on it, and the code check (step 8) checks both against the code.

Answer four questions from the code:

1. **How does it work today?** Trace each path the work item touches, from its entry points (endpoints, jobs, handlers, commands) to where its data is stored. Read the code itself, not just names and signatures. Note the config, feature flags, telemetry and error handling on the way.
2. **What can we reuse?** For each thing the design might add, search for code that already does it, or nearly does: helpers, base classes, patterns and similar features. Read what the repo says about that code: its README, `docs\`, `.github\copilot-instructions.md` and `AGENTS.md`.
3. **What depends on it?** For each thing the design might change (a function, type, endpoint, schema, file format, config key or flag), find every caller and reader, and what each one expects. Search every configured workspace for callers and readers, not only this one. Search for the name, and for the strings that identify it, such as paths, headers, routes and table names.
4. **What edge cases does it handle?** List the special cases on those paths: guard clauses, errors, retries, limits, empty or missing data, data written by older versions, concurrency and ordering. Read the tests that cover them, and the recent history of those files (`git log`).

How:

- **Which code.** Read the code the implementation will build on: `origin/<default branch>`. This goes for every workspace you search, not just the item's. In each, run `git -C "<workspace>" fetch origin`, and find the default branch as `asdf:using-git-worktrees` does. If the checkout is at that commit with no local changes, read it directly. Otherwise read through git, never from the checkout. Use `git -C "<workspace>" grep -n <pattern> origin/<default branch>`, and `git -C "<workspace>" show origin/<default branch>:<path>` with forward slashes in `<path>`. If the fetch fails, read the last fetched `origin/<default branch>` through git, and say so in that workspace's `Read:` line.
- **Every statement about existing code cites the file and line.** A claim you can't cite is a guess: check it, or put it under Unknowns.
- **Unknowns.** What the code can't tell you, such as a consumer outside the configured workspaces, becomes a question or an ASDF assumption (step 4).
- **Start from what's known.** Earlier deep dives sit next to the HLDs the memory index points to. For one of a Feature's PBIs, start from the Feature's `deep-dive.md` if it has one. Check what you take from them against the code, since it may have changed.
- **A large codebase.** Split the four questions across read-only subagents, run them in parallel, and merge what they find. Read the code the design will change yourself, and check what they report before you rely on it.
- **Later passes** reuse `deep-dive.md`, and an item designed before deep dives gets one now. In each workspace, re-read the files it cites that changed since that workspace's commit (`git -C "<workspace>" diff --name-only <commit> origin/<default branch>`). Extend it when the design touches code it doesn't cover yet, and update the `Read:` lines.

`deep-dive.md`:

```
# Deep dive: <id> <title>
Read: <workspace> at <commit> (<the checkout, or "through git">), <date>
Read: <each other workspace searched, the same way>

## How it works today
- <path>:<line>: <what it does>

## What we can reuse
- <path>:<line>: <what it does>. <Use it as is / extend it / why it doesn't fit>

## What depends on it
| What may change | Who uses it (path:line) | What they expect |
|---|---|---|

## Edge cases
- <case>: <how the code handles it today> (<path>:<line>; test: <path>:<line>, or none)

## Unknowns
- <what the code can't tell you>: <Q<n> or D<n>>
```

## 3. Draft or revise `hld.md`

A builder must be able to plan from it without going back to anyone. Cover:

- Intent and why. Goals, non-goals, anti-goals. Constraints.
- The design, with mermaid diagrams wherever a picture helps.
- The package (repo) it changes.
- **Reuse:** what the design builds on, from the deep dive. Reuse what the code already has. If the design builds something new instead, the HLD says why the existing code doesn't fit.
- **What must keep working:** each caller, reader and behavior from the deep dive that the change touches, and how it keeps working.
- **Edge cases:** each one from the deep dive, and what the design does with it.
- **New dependencies.** List every new dependency in the HLD. Approving the HLD approves them; anything not listed needs a person's OK later.
- **Key decisions**, from `decisions.md`: the D-number, the decision, and how it was made.
- What's left to the builder.

Give Reuse, What must keep working and Edge cases a section each, under those headings. The plan, the code check and the self-review look for them there.

Keep it simple: the smallest design that delivers the work item (YAGNI). Cut anything nobody asked for.

For one of a Feature's PBIs, the HLD stays within this PBI's scope from the breakdown. Work that belongs to another of the Feature's PBIs goes there. If the design shows that this PBI is too big for one PR, or that the split itself is wrong, say so as a question in its round. The fix is to reopen the Feature's Breakdown task.

## 4. Questions

- **Ask only what you can't settle** from the work item, the code, the memory index, or earlier answers.
- **Everything else becomes an assumption.** Add it to `decisions.md` as `ASDF assumption`, and list it in the round so people see it.
- **A break is a person's call.** Breaking something that works today is never an ASDF assumption. If the design can't keep a caller, reader or behavior working, ask in the round: say what breaks, and offer ways to keep it working.
- **Round size:** at most `maxQuestionsPerRound` (from `asdf.ts config`; the default is 4).
- **Format:** multiple choice where possible, with the recommended answer first and a one-line reason.
- **Record the round** by appending it to `questions.md`:

  ```
  ## Round <n> (HLD v<version>, <date>)
  Q1. <question>
    A. <recommended> (recommended): <reason>
    B. <option>
    Answer: (open)
  ```

## 5. Live session

This also covers a session started just to answer an open round.

1. Show the round as one `ask_user` form. Give each question an enum field defaulting to the recommendation, and add one free-text field for anything else.
2. Record each answer in two places:
   - `questions.md` (`Answer: B, Jane Doe, session`);
   - `decisions.md` (`Decided by Jane Doe (session)`).
3. Post the `session-answers` comment on the HLD task, so ADO keeps the record.
4. Continue: recheck design ownership, revise the HLD (step 3), then ask the next round or run the checks (step 8). Retain the same operation owner through approval and implementation; the top-level entry releases it when the operation ends.

If the person elects to answer later/in ADO, post the question round with its
cutoff, enter awaiting-answers and return to live-continuation to arm the wait.
Cancelling a question form is not permission to start an unattended flow.
Do not use a blocking ask_user form just to await an approval already requested.
Feedback/approval arriving after an external wait uses live-continuation's
version-bound receipt path rather than directly applying the old chat snapshot.

## 6. Unattended run (`do-next`)

- Post the `question-round` comment on the HLD task. Post one comment per round.
- Write `{"hld":{"roundPostedAt":"<utc now>"}}` to `<item>\patch.json` and run `asdf.ts item-set -Id <id> -File <item>\patch.json`.
- Run `asdf.ts stage -Id <id> -Stage awaiting-answers`, then stop. A later pass picks up the answers.
- Never use `ask_user` in an unattended run.

## 7. Answers arrived (stage `answers-received`)

1. **Read the replies.** First reconcile and read pending feedback as in step 1,
   including the session receipt's author/summary. Also take human comments on
   the HLD task, meaning those not starting with `[ASDF]`, newer than
   `hld.roundPostedAt` (or `hld.approvalRequestedAt` after an approval request).
   The `[ASDF]` filter does not discard receipt-backed session feedback.
2. **Map them to questions:**
   - `Q1 A, Q2 B` answers those questions.
   - "go with your recommendations" accepts every recommendation still open in that round.
   - Free text answers the question it addresses.
3. **Record each answer** in `questions.md` and in `decisions.md` (`Decided by <name> (ADO comment)`).
4. **The size question.** If it was answered: A means follow "Making a PBI into a Feature" in `asdf:feature-breakdown`, then stop. B means write `{"size":"one"}` with `item-set`, record "Keep it as one PBI" as a `D` row, and carry on with the deep dive (step 2), then step 3. In a live session, do the same with the session's provenance.
5. **Never assume an answer.** An unanswered question stays open. Never quietly assume an answer to a question you asked; ask it again in the next round.
6. **A change request after an approval request** counts as answers. Revise and carry on.
7. **Next step.** Revise `hld.md` (step 3). Once the pending feedback is reflected
   in the draft and questions/decisions, run
   `design-feedback-consume -Id <id> -Owner <owner> -FeedbackId <pending.feedbackId> -Summary "<changes or explicit open questions recorded>"`.
   A recorded ADO comment alone is not consumption. If anything is still open,
   go to step 4 for the next round; otherwise go to step 8.

## 8. Builder check and code check

Run the builder check before requesting approval. Run the code check with the builder check, once per HLD version.

- **The builder check** asks what a builder would still need answered. Dispatch a fresh subagent with [builder-check-prompt.md](./builder-check-prompt.md). Give it the domain (the repo's stack) and the path to `hld.md`.
- **The code check** tests the design against the code: what it reinvents, what it breaks, the edge cases it misses, and what it gets wrong about the code. Dispatch a second fresh subagent with [code-check-prompt.md](./code-check-prompt.md) at the same time. Give it the domain, each workspace with the commit the deep dive read it at, and the paths to `hld.md` and `deep-dive.md`.
- Sort what comes back from both:

  | Kind | What to do |
  |---|---|
  | **Answered already** by the work item, the code or earlier answers | Put the answer in the HLD |
  | **Minor**: a sensible builder could settle it without changing what gets built | Settle it, and record it as an ASDF assumption |
  | **Needs a person**: only they can answer, and the answer changes what gets built | Put it in the next question round (step 4) |
  | **A code check finding** | Fix the HLD and `deep-dive.md`. A break the design can't avoid goes in the next round as a question (step 4) |

## 9. Nothing open: request approval

1. Recheck current design ownership and reconcile/consume pending feedback.
   Before any upload, description change or approval comment, capture the
   current design target from item state as
   `{"designId":<ado.hldId>,"version":<old version>,"requestedAt":<old approvalRequestedAt or null>,"roundPostedAt":<round cutoff or null>}`.
   Run `asdf.ts design-request-check -Id <id> -Owner <owner> -File "<old-target.json>" -Version <N> -RequestedAt "<candidate utc cutoff>"`.
   A failed preflight means no external publication; resolve its reported cause.
2. Before requesting approval, move a Completed HLD task back to InProgress.
   Bump the version: copy `hld.md`
   to `hld.v<N>.md`, upload/link it, and set the `hld-description`. On retry,
   reconcile already completed uploads/comments instead of duplicating them.
3. Post the `approval-request` comment. It counts human decisions and ASDF
   assumptions, giving the assumptions' D-numbers. Confirm its timestamp.
4. Publish with `asdf.ts design-request -Id <id> -Owner <owner> -File "<old-target.json>" -Version <N> -RequestedAt "<confirmed approval-request timestamp>"`.
   This rechecks the target, atomically enters awaiting-approval and clears
   only recorded, consumed feedback superseded by this version. Never clear
   pendingFeedback by hand.
5. In live mode return to `asdf:live-continuation` to arm a five-minute check
   and release the operation lock. Unattended entry returns to its caller as
   before, without creating a schedule.

Approval itself is detected by `asdf.ts signals`: a fresh design-task Done
transition or an unconditional approval comment. Plain `approved` (optional
terminal punctuation) and `approved, ship it` are accepted; conditional or
mixed change requests are feedback. Later feedback supersedes an earlier Done.
Pending revision blocks old approval in every mode. Never judge it yourself.

## 10. Approval in a live session

Use `asdf:live-continuation` for current-target chat approval and feedback:
acquire fresh ownership, suspend the old scheduled generation, create a receipt,
record its ADO session template and verified comment ID, then immediately
continue `asdf:writing-plans` for an HLD. A failed post is not approval.
Never approve shared/nonowned designs by proxy or apply a chat approval to a
newer version than the one presented. No separate "continue" prompt is needed.

## `decisions.md`

```
| ID | Decision | How it was made | When | Source |
|---|---|---|---|---|
| D1 | Stream rows to disk | Decided by Jane Doe (ADO comment) | 2026-10-20 | HLD task 12346 |
| D2 | Column widths from the first 1,000 rows | ASDF assumption | 2026-10-20 | hld.md |
```

Once the HLD is approved, `asdf:writing-plans` changes each `ASDF assumption` to `ASDF assumption, approved with HLD v<N>`.

## Never

- Never post conversation transcripts to ADO; post only the templates.
- Never ask what the work item, the code or the memory already answers.
- Never request approval while a question is open.
