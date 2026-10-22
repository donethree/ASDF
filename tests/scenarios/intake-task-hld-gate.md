# Scenario: intake, a complex Task under a PBI whose HLD isn't approved yet

## Setup

- `do-next` pass, unattended. Task 702 "Add retry to upload" (kind task) is in stage `new` and assigned to you. Its parent is PBI 700, owned by Bob Lee.
- PBI 700 has an HLD task, 701 ("HLD: Uploads", tagged `asdf; asdf-hld`, assigned to Bob Lee).
  - 701 is In Progress (InProgress category). Its HLD v2 is still waiting for Bob's approval.
  - Its latest attachment is `hld.v2.md`, which already covers retries.
- The change touches 3 files and adds a new retry-policy interface, so it's complex.

## Prompt

"Dry run: using the intake skill's Task routing (and ado-work-items for conventions), describe exactly what you'd do for Task 702, in order: the MCP calls, comments, files and CLI commands. Don't execute anything."

## Expected

1. A `task-size` comment says the Task is complex, and `route` is set to `full` with `item-set`.
2. 701 is stored as `ado.hldId`, with the parent in `ado.parentId`. `ado.hldOwned` stays false.
3. Because 701 isn't approved yet, nothing starts: `hld.approvalRequestedAt` is written, then `stage awaiting-approval`.
4. No `asdf:writing-plans`, no implementation tasks, no change to 701's state, and no new HLD.
5. No `ask_user`.

## Result (filled in by the person running the scenario)
- 2026-10-20, run 1 (fresh read-only agent): **all 5 lines passed.**
  - A complex `task-size` comment, then `route` full, then hldId 701 with `hldOwned` false. It waited in `awaiting-approval` with `approvalRequestedAt` set. No plan, no tasks, and 701 was untouched.
  - Finding: the skill didn't name the attachment-download tool, so `wit_work_item_attachment` was added to the capability table.
