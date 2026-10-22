# Scenario: ownership, live handoff and Task lifecycle

Run this as a read-only dry run with a fresh agent. It reads the current skills,
not this file's Expected or Result sections. No ADO calls, shell commands or file
writes are performed. Existing workspace and configuration lookups succeed.

## Prompt

Follow the current ASDF skills literally. For each case, list the ordered
actions, mutating targets, state transitions and any missing inputs. The org is
contoso and the project Commerce. Do not repair instructions while answering.

1. Unattended item at answers-received has HLD 51, hldOwned false, owned by
   another engineer. The latest human comment is "Change to option B".
2. Live intake of a PBI reaches immediate approval and two implementation
   tasks. An hourly run may overlap. Include lock owner, heartbeat and release.
   Also cover a direct live answer session and inline implementation.
3. Sync sees PBI 100 and its untagged HLD Task 101 and manual implementation
   Task 102, all assigned to the user; no roles have been recorded yet.
4. A small standalone Task reaches self-review without hldId, reviewId, HLD or
   plan. Describe review, PR links and close-out. A complex Task 200 belongs to
   untracked PBI 150 assigned to someone else and needs a new HLD: describe
   assignment of the new tasks and which ASDF item stores their IDs.
5. A pr-feedback or pr-ready item has a completed PR and deleted source branch,
   with no local follow-up commits. What gets pushed or updated?
6. Every plan task is complete, but finishing's full suite fails repeatedly.
   Include the recovery limit and the no-plan small-Task case.
7. An approved Feature reuses another person's Proposed PBI with waitsFor [].
   A Task waiting for a parent was reassigned. A merged Task is now someone else's.

## Expected

1. A shared HLD is read-only: no revised upload, description/state overwrite or
   approval by proxy. Consume the reply once, then await a fresh owner approval.
2. Live and unattended operations use a lock and explicit owner, reused through
   handoffs; heartbeat before mutation and after user waits; no second owner is
   acquired by a nested skill. Lock loss stops writes. Signals can use the owner.
3. Sync classifies parents before children, excludes design tasks regardless of
   tags, and does not build a tracked PBI's manual tasks independently.
4. A Task is reviewed against its own scope. Missing optional artifacts/Review
   tasks are not dereferenced; summary goes in the PR. A Task-owned new design
   stores IDs on 200, not 150, and assigns tasks to the Task's assignee.
5. Completed PRs go to close-out without pushing or recreating branches; abandoned
   PRs block rather than re-enter feedback.
6. Finishing repairs the failure directly, with two attempts recorded across
   passes, then blocks. It never redispatches a completed implementation plan.
7. Other people's PBIs and Tasks are neither started nor closed. Reassignment
   pauses active work; an already completed PR instead permits safe local
   close-out without a final comment or state change on the reassigned item.

## Result

- Baseline before fixes: a fresh read-only agent followed the current skill paths.
  It identified violations in all seven cases: shared HLD rewrite after the
  hldId short-circuit; no live lock but mandatory heartbeat; child items tracked
  before adoption; missing Task review artifacts and parent-targeted state;
  completed PR feedback still pushing; completed-plan/full-suite loop; and
  unguarded PBI activation/Task closure. It explicitly reported contradictions
  rather than inventing missing actions. The runtime reassignment branch was
  covered separately by an executable regression test.
- First post-change run: cases 1-6 followed the intended paths. Case 7 exposed
  a conflict between the common reassignment pause and completed-PR close-out.
  The same run identified a missing standalone Task implIds mapping and an
  inline-review fix fallback. The instructions now explicitly select local
  terminal close-out, map plan tasks to the standalone Task id, and permit
  inline TDD fixes when subagents are unavailable.
- Follow-up fresh read-only run of direct/shared/live entry, standalone Task
  planning and inline review, repeated red-suite repair, and reassigned merged
  close-out followed the corrected paths. It preserved the same operation owner,
  used Task 200 for implIds and left shared HLD 51 and parent 150 unchanged.
  Completed reassigned Task 200 reached local done without an ADO final comment.
- Final review found two runtime boundaries not represented by the original
  scenarios: close-out blockers must remain blocked after PR completion, and
  already-started standalone child workflows must survive later parent tracking.
  Executable regression cases cover those boundaries in review-regressions.test.ts.
