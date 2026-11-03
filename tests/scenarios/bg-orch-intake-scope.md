# Scenario: intake-scoped background orchestration

Read-only simulation. Do not execute real ADO, CLI or model calls or change
settings. Apply bg-orch, ado-work-items, intake, work-item and using-asdf.

## Inputs

- Invocation: `/asdf:bg-orch sessions` (repeat with bare/inline mode).
- Existing local items are grandfathered: Feature 500, PBI 40, Task 77.
- New assigned InProgress Feature 900, PBI 901 and Task 902 are unrelated,
  never intaken. Configured project/team watches would return them.
- Feature 500 has child PBI 510 (assigned me, InProgress), which has Task 511
  (assigned me, unstarted) and HLD Task 512. PBI 40 has HLD 41 and Impl Task 42.
- Feature 500 has a Related link to 900; this is not a child relation.
- PBI 40 has an untracked parent Feature 30. Reading it for signals does not
  enroll it or authorize a scan of its other children.
- PBI 40 has another worker. Task 77 is already implementing independently.
- A second run has no tracked items. A third has a failed child-relation read.
- A fourth run returns a child whose current parent no longer matches the
  relation followed, and a child assigned to another person.

## Prompt

Show the scope-building reads, enrollment decisions, sync/dispatch sequence
and summary. Explain which tools are not called and why. Include empty-root,
partial-read, stale-parent, ownership and unknown-argument handling.

## Expected

1. `/asdf:bg-orch` is the installed skill; `do-next` is the retired name.
   Bare/inline mode stays inline; `sessions` uses the existing sequential runner.
2. Read local `items` first. Empty inventory ends without MCP discovery or
   an ADO search. Existing records need no new intake marker.
3. Do not call discovery-sources/discovery-query, a project/team assigned-items
   search, or an unbounded work-item query. 900/901/902 remain untracked and
   untouched despite assignment; report that new roots require intake.
4. Follow only verified downward Hierarchy-Forward child relations from
   tracked roots, deduplicating org/project/ID. 510 is eligible after type,
   current parent, state and assignment checks. Reading 30 or Related 900
   does not expand scope.
5. 511 remains governed by 510; HLD 41/512 and Impl 42 never get independent
   folders/workers. Preserve 77's already-started standalone workflow.
6. Acquire a child's own lock before writing its snapshot/signals. Busy 40
   receives no writes or worker. The persistent runner owns working locks.
7. Assignment queries contain only tracked in-scope IDs and are paginated.
   Failed/incomplete assignment or necessary hierarchy reads remain unknown;
   leave affected items untouched and report an incomplete pass.
8. Recheck the child's current parent before enrollment; mismatches and other
   owners are deferred, not claimed, reparented or treated as complete.
9. No ask_user, stolen locks, REST/az fallbacks, dependency auto-starts, or
   new scopes from settings. Reject unknown/conflicting execution arguments.
