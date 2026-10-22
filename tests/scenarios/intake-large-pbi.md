# Scenario: intake, a large PBI, a small PBI and a Feature

## Setup

- A live Copilot session. ASDF is initialized. Org `contoso`, MCP server `ado-contoso`, project `Commerce`.
- `asdf.ts config` lists two workspaces:
  - `C:\src\Payments`, holding repo `Payments` in `contoso/Commerce`;
  - `C:\src\Inventory`, holding repo `Inventory` in `contoso/Commerce`.
- `workItemTypes`: feature `["Feature"]`, parent `["Product Backlog Item", "User Story"]`, task `["Task", "Bug"]`.
- PBI 4100, "Move subscription files into the database", is assigned to you, in state New (Proposed), with no parent, and isn't tracked yet. Its description: "Today the Payments service reads subscriptions from JSON files. Import the existing files into new SQL tables, then switch every reader in Payments to the tables."
- PBI 4200, "Round invoice totals to cents", is assigned to you, in state New, with no parent. Its description names a one-line change in the rounding helper of Payments.
- Feature 4300, "Inventory audit trail", is assigned to you, in state Active.

## Prompt

"Dry run: you're in a live session. The user says, one after another: 'work on PBI 4100', then 'work on PBI 4200', then 'work on Feature 4300'. Using the intake skill (and the skills it sends you to), describe exactly what you'd do for each, in order, up to the point where each one is handed to brainstorming, waits, or reaches the first question of a breakdown: the CLI commands, MCP calls, ask_user forms and comments. For 4100, the user answers the size question with 'feature'. Don't execute anything."

## Expected

1. For 4100, after `item-new -Kind parent`, the size check comes before any question about In Progress. It matches the workspace with `item-repo -Id 4100 -Name Payments`, looks at the code read-only, judges 4100 large (import, then switch the readers), and explains why, listing the two steps.
2. One `ask_user` form offers `feature` (recommended) and `one`.
3. On `feature`:
   - a Feature is created (`wit_work_item_write create`, type `Feature`, with 4100's title, description, area path, iteration and assignee);
   - 4100 is linked under it (`wit_work_item_link_write link`), and the Feature is moved to InProgress;
   - `feature-split` is posted on 4100, and 4100 is moved to Proposed;
   - `item-set` gives 4100 `{"size":"phase","ado":{"parentId":<feature id>}}`, then `stage -Id 4100 -Stage tracked`;
   - the Feature is tracked with `item-new ... -Kind feature`, then `stage new`, and `feature-breakdown` starts on it: a Breakdown task tagged `asdf; asdf-breakdown`, with questions asked through `ask_user`.
4. 4100 gets no HLD task, no Review task, and no `brainstorming`.
5. For 4200, the size check finds it not large: `item-set` `{"size":"one"}` and no size question. Then the In Progress question, `stage new`, and `brainstorming`.
6. For 4300, `item-new -Kind feature`, no size question, `stage new`, then `feature-breakdown`: a Breakdown task, and no HLD, Review or implementation tasks.
7. Nothing is created without the user's OK, and the disk is never searched for code.

## Result (filled in by the person running the scenario)
- 2026-10-20, run 1 (fresh read-only agent): **all 7 lines passed.**
  - 4100: the size check came before any In Progress question (`item-repo -Id 4100 -Name Payments`, a read-only look), it was judged large with the two steps listed, and one `ask_user` form offered `feature` (recommended) and `one`.
  - On `feature`: the Feature was created and linked, `feature-split` was posted, 4100 was moved to Proposed with `size` `phase` and stage `tracked`, and the Feature was tracked with `-Kind feature` and started its breakdown (Breakdown task, live questions). 4100 got no HLD, Review or `brainstorming`.
  - 4200 got `size` `one` and no size question; 4300 went straight to `feature-breakdown` with no size question.
  - Follow-up: the run noticed the created Feature's `item.md` snapshot wasn't spelled out; `feature-breakdown` section 10 now says to write it.
