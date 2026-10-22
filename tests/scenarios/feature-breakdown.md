# Scenario: feature-breakdown, creating a Feature's PBIs

## Setup

- `do-next` pass, unattended. Org `contoso`, MCP server `ado-contoso`, project `Commerce`. `workItemTypes.parent` is `["Product Backlog Item", "User Story"]`, and the project's process has `Product Backlog Item`.
- Feature 4120, "Move subscription files into the database", is assigned to you and In Progress, at stage `approved`. `ado.hldId` is 4122, its Breakdown task, with `hldOwned` true. Breakdown v1 was approved by Jane Doe in a comment.
- The approved breakdown lists three PBIs, in this order:
  1. existing PBI 4100, "Import existing subscription data": assigned to you. It was the original PBI, split in the hourly run: ASDF parked it (Proposed, `size` `phase`, `ado.parentId` 4120), and its HLD task carries one round, the size question, which Jane Doe answered "Q1 A". Workspace `Payments`. Waits for nothing.
  2. a new PBI, "Move readers to the SQL tables". Workspace `Payments`. Waits for PBI 1.
  3. existing PBI 4130, "Inventory: read the subscription tier from the database": assigned to Sam Lee, already Active. Workspace `Inventory`. Waits for PBI 1.
- Every lock and MCP call succeeds. The new PBI gets id 4121.

## Prompt

"Dry run: using the feature-breakdown skill (and ado-work-items for conventions and templates), describe exactly what you'd do for Feature 4120 in this pass, in order: the CLI commands, MCP calls, and work item changes. Don't execute anything."

## Expected

1. Breakdown task 4122 is moved to Completed, `hld.closedAt` is written, and the assumptions in `decisions.md` are marked approved with breakdown v1.
2. Exactly one PBI, 4121, is created, under 4120 with `add_child`:
   - type `Product Backlog Item`, the Feature's area path and iteration, assigned to you;
   - its description from `pbi-description`;
   - in the Proposed state, with no tags at all (no `asdf`).
3. 4100 gets its title from the breakdown, and `pbi-scope` is appended to its description, keeping its text, even though its HLD task carries the size round: it's the PBI this Feature was split from.
4. 4130, Sam Lee's and already Active, is left untouched: no title, description or state change.
5. The PBIs assigned to you are tracked: `item-new ... -Kind parent -ParentId 4120` for 4100 and 4121, then `item-set` `{"size":"phase"}` for each.
6. `ado.pbis` is written on 4120 in order: 4100 waiting for nothing, 4121 and 4130 each waiting for 4100.
7. 4100 is moved to InProgress, because it waits for nothing. 4121 and 4130 are never moved.
8. The pass ends with `stage -Id 4120 -Stage awaiting-pbis`. The Feature gets no HLD, Review or implementation task, and no PR.

## Result (filled in by the person running the scenario)
- 2026-10-20, run 1 (fresh read-only agent): **all 8 lines passed.**
  - It closed 4122 and wrote `hld.closedAt`, marked the assumptions approved, created only 4121 (`add_child`, `Product Backlog Item`, the Feature's area path, iteration and assignee, `pbi-description`, Proposed, no tags), and retitled 4100 with `pbi-scope` appended.
  - It left Sam Lee's 4130 untouched, tracked 4100 and 4121 with `size` `phase`, wrote `ado.pbis` in order, started only 4100, and ended at `awaiting-pbis`.
  - Follow-up: the run noticed that `do-next`'s "no ADO writes for items not In Progress" read as conflicting with the breakdown updating Proposed PBIs; `do-next` now names that exception, and section 7 says the next pass picks a started PBI up.
- 2026-10-20, run 2, after the final review, with 4100 split in the hourly run as above (fresh read-only agent): **all 8 lines passed.** 4100 was retitled and got `pbi-scope` under the rule for the PBI a Feature was split from, even though its HLD task carries the size round. Everything else matched run 1.
