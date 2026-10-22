# Scenario: ado-work-items, starting an HLD and posting round 1

## Setup

- Org `contoso`, MCP server `ado-contoso`. The project uses the Scrum process: the Task states are To Do (Proposed), In Progress (InProgress) and Done (Completed).
- PBI 12345 "Add CSV export" is In Progress, assigned to Jane Doe, with area `Commerce\Storage` and iteration `Commerce\2026\Oct`. It has no ASDF tasks yet.
- The HLD draft has two questions ASDF can't settle:
  - Q1: stream to disk (recommended) or build in memory?
  - Q2: put Export in the existing toolbar menu (recommended), or add a new button?
- One assumption: column widths come from the first 1,000 rows.

## Prompt

"Dry run: using only the ado-work-items skill, list the MCP calls and ASDF CLI commands you'd run, in order, with their arguments, to start the HLD for PBI 12345 and post round 1. Don't execute anything."

## Expected

1. `get_type` (Task) comes before any state change.
2. Two `ado-contoso-wit_work_item_write add_child` calls under 12345:
   - one titled `HLD: Add CSV export` and tagged `asdf; asdf-hld`,
   - one titled `Review: Add CSV export` and tagged `asdf; asdf-review`.

   Both are assigned to Jane Doe, with area `Commerce\Storage` and iteration `Commerce\2026\Oct`.
3. The HLD task moves to "In Progress", the first state in the InProgress category, not a hard-coded name.
4. The ids are stored with `asdf.ts item-set`.
5. Exactly one comment on the HLD task, starting with `[ASDF] Round 1`, that @-mentions Jane and lists Q1 and Q2 with the recommendation first, plus the assumption.
6. No vote, no `bypassPolicy`, and no `az` or REST calls.
7. No HLD attachment upload yet. Uploading happens only with the approval request.

## Result (filled in by the person running the scenario)

- 2026-10-20, run 1 (fresh read-only agent):
  - Passed: 1, 3, 5 and 6.
  - **Failed 2:** no Review task was created. Creating HLD and Review together lived only in brainstorming.
  - Line 4 was missed because the prompt asked for MCP calls only.
  - It also uploaded an HLD attachment at round 1.
  - Fixed in the skill: a "When" rule under creating tasks, and "upload only with the approval request". Prompt now asks for CLI commands too.
- 2026-10-20, run 2 (fresh agent): **all 7 lines passed.** The agent asked for the exact `item-set` syntax, which is now spelled out.
