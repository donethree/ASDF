# Scenario: do-next with Features waiting on their PBIs

## Setup

- `do-next` pass, unattended. Org `contoso`, MCP server `ado-contoso`, project `Commerce`. `workItemTypes.parent` is `["Product Backlog Item", "User Story"]`.
- Feature 4120 is assigned to you and In Progress, at stage `awaiting-pbis`.
  - `ado.pbis`: 4100 waiting for nothing, and 4121 waiting for 4100.
  - `ado.hldId` is 4122, its Breakdown task, which ASDF closed (Completed, `hld.closedAt` set).
  - In ADO, 4100 is Completed (merged and closed in an earlier pass), and 4121 is Proposed. The Feature's children are 4100, 4121 and the Breakdown task 4122.
- Feature 4500 is assigned to you and In Progress, at stage `awaiting-pbis`, with `ado.pbis` 4501 and 4502. In ADO, 4501 and 4502 are Completed, and so is its Breakdown task 4503: every child is complete. Both PBIs merged through PRs 9101 and 9102.
- Every lock succeeds.

## Prompt

"Dry run: using the do-next skill (and the skills it sends you to), describe exactly what this pass does for Features 4120 and 4500: the signals files you'd write, with their sections; the CLI commands, with the results the CLI's rules would give; the work done; and the lines the summary would contain. Don't execute anything."

## Expected

1. 4120's signals file has `workItem`, `hld` (from Breakdown task 4122), and `pbis` with 4100 Completed and 4121 Proposed. 4122 isn't in `pbis`.
2. `signals` keeps 4120 at `awaiting-pbis` and returns `ready` with 4121.
3. Nothing moves 4121 to In Progress. The summary lists 4121 as ready to start ("move 4121 to In Progress to start it"), and 4120 as waiting on its PBIs.
4. 4500's `pbis` has 4501 and 4502, both Completed, so `signals` moves it to `pbis-done`.
5. From the queue, 4500 at `pbis-done` gets the `feature-breakdown` close-out: Feature 4500 is closed (it's assigned to you, and every child is complete), `feature-summary` is posted listing each PBI with its PR, and then `stage done`.
6. No `ask_user`.

## Result (filled in by the person running the scenario)
- 2026-10-20, run 1 (fresh read-only agent): **all 6 lines passed.**
  - 4120's signals held `workItem`, `hld` and `pbis` (4100 Completed, 4121 Proposed, no 4122); `signals` kept it at `awaiting-pbis` with `ready` 4121, nothing moved 4121, and the summary said "move 4121 to In Progress to start it".
  - 4500 went to `pbis-done`, and its close-out closed the Feature, posted `feature-summary` with PRs 9101 and 9102, and ran `stage done`. No `ask_user`.
