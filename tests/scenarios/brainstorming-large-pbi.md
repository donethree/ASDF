# Scenario: brainstorming, a large PBI and one of a Feature's PBIs

## Setup

- `do-next` pass, unattended. Org `contoso`, MCP server `ado-contoso`, project `Commerce`.
- `asdf.ts config` lists the workspaces `C:\src\Payments` (repo `Payments`) and `C:\src\Inventory` (repo `Inventory`), both in `contoso/Commerce`. `workItemTypes.feature` is `["Feature"]`.
- PBI 4400, "Move subscription files into the database", is assigned to you and In Progress, at stage `new`. Its `size` is empty, `hld.version` is 0, and no round has been posted. Its description: "Today the Payments service reads subscriptions from JSON files. Import the existing files into new SQL tables, then switch every reader in Payments to the tables."
- PBI 4121, "Move readers to the SQL tables", is In Progress at stage `new`, with `size` `phase`. Its parent is Feature 4120, which ASDF tracks at `awaiting-pbis`, with breakdown v1 approved.
  - `<asdf-context>\4120-move-subscription-files\breakdown.md` lists 4121: workspace `Payments`, waits for 4100 (Completed).
  - The Feature's `decisions.md` has `D1`: "Subscriptions live in the table dbo.Subscriptions, which PBI 4100 creates", decided by Jane Doe (ADO comment).
- PBI 4410, "Move order history into the archive store", is assigned to you and In Progress, at stage `new`. Its `size` is empty, `hld.version` is 0, and no round is recorded locally. Its description: "Copy the existing order history into the archive store, then switch the order history page in Payments to read from it." In ADO it already has an HLD task, "HLD: Move order history into the archive store", which you created by hand: assigned to you, InProgress, not tagged, with one comment from Sam Lee discussing the archive format. No other tracked item uses it.
- Every lock succeeds.

## Prompt

"Dry run: using the brainstorming skill (and ado-work-items for conventions), describe exactly what you'd do for PBIs 4400, 4121 and 4410 in this unattended pass, up to the point where each one waits, or drafts its HLD and posts its first question round: the CLI commands, MCP calls and comments. Don't execute anything."

## Expected

1. For 4400, the HLD and Review tasks are created as usual, the inputs are gathered, and then the size check judges it large.
2. 4400's round 1 is one `question-round` comment on its HLD task, with only the size question: A, make it a Feature (recommended); B, keep it as one PBI. No other questions, and no HLD drafted.
3. Then `hld.roundPostedAt` is written and `stage -Stage awaiting-answers` runs. No `ask_user`.
4. For 4121, no size question. Its inputs include Feature 4120's `breakdown.md` and `decisions.md`; its workspace comes from its breakdown entry (`item-repo` with `Payments`); its HLD cites `per 4120 D1`, and no question asks again where subscriptions live.
5. No Feature or PBI is created in this pass.
6. For 4410, step 1 adopts the existing HLD task (`hldOwned` true) and creates only the Review task. No size question is asked, since its design is already under way, and the design carries on from Sam Lee's comment.

## Result (filled in by the person running the scenario)
- 2026-10-20, run 1 (fresh read-only agent): **all 5 lines passed.**
  - 4400: HLD and Review tasks, inputs, then the size check; round 1 held only the size question, with no HLD drafted; then `roundPostedAt` and `awaiting-answers`, with no `ask_user`.
  - 4121: no size question; it read the Feature's breakdown and decisions, took `Payments` from its entry, and cited `per 4120 D1` without asking again.
  - Nothing created a Feature or a PBI.
- 2026-10-20, run 2, after the final review, with 4410 added (fresh read-only agent): **all 6 lines passed.** 4400 and 4121 matched run 1. 4410's hand-made HLD task was adopted (`hldOwned` true), only a Review task was created, and no size question was asked, under the rule for an adopted HLD task.
- 2026-10-21, run 3, with the deep dive in brainstorming step 2 (fresh read-only agent): **all 6 lines passed.**
  - 4400 asked the size question alone, with no deep dive and no HLD drafted.
  - 4121 and 4410 each planned `deep-dive.md` before `hld.md`, and read the Feature's `deep-dive.md` if present.
