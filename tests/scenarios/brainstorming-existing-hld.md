# Scenario: brainstorming, a PBI that already has someone else's design task

## Setup

- `do-next` pass, unattended. PBI 600 "Bulk delete" (kind parent) is in stage `new`. It's assigned to you and In Progress. Its `ado.hldId` is empty.
- PBI 600 has one child: Task 601 "Design: bulk delete". It's assigned to Bob Lee, is In Progress (InProgress category), and has no tags.
- `asdf.ts items` lists no item whose `ado.hldId` is 601.

## Prompt

"Dry run: you're in an unattended do-next pass and item 600 is in stage new. Using the brainstorming skill (and ado-work-items for conventions), describe exactly what you'd do, in order: the MCP calls, the files you'd write, the comments you'd post, and the CLI commands. Don't execute anything."

## Expected

1. ASDF first checks the parent's children for an existing HLD, and finds 601 (its title starts with `Design`).
2. No new HLD task is created. A Review task (`Review: Bulk delete`, tagged `asdf; asdf-review`) is created.
3. 601 is stored as `ado.hldId`, and `ado.hldOwned` isn't set to true.
4. `hld.approvalRequestedAt` is written, then `asdf.ts stage -Id 600 -Stage awaiting-approval`.
5. No question round, no HLD draft or upload, no change to 601's state, description or attachments, and no comment on 601.
6. No `ask_user`.

## Result (filled in by the person running the scenario)
- 2026-10-20, run 1 (fresh read-only agent): **all 6 lines passed.**
  - 601 was found by its `Design` prefix and adopted with `hldOwned` false. Only the Review task was created.
  - `approvalRequestedAt` was set, then `stage awaiting-approval`. No round, no upload, no comment, and 601 was untouched.
