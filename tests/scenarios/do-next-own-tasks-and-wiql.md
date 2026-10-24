# Scenario: do-next, ASDF's own tasks, a missing WIQL tool, and an abandoned PR

## Setup

- Unattended automation run. Config orgs:
  - `contoso` (`ado-contoso`): its tools include `ado-contoso-wit_work_item` and `ado-contoso-wit_query_by_wiql`. Project `Storage`. Work item types: parent `Product Backlog Item`; task `Task`, `Bug`.
  - `fabrikam` (`ado-fabrikam`): `ado-fabrikam-wit_work_item` is available, but there's no `wit_query_by_wiql` tool, and `wit_query` has no `wiql` action.
- `get_type` for `Product Backlog Item`, `Task` and `Bug` gives these Completed or Removed states: `Done`, `Closed`, `Removed`.
- The contoso WIQL returns ids 501, 77 and 40.
  - 501 is untracked. `asdf.ts item-new` for it returns `{"error":"ASDF_OWN_TASK","message":"501 is the HLD task of item 500; ASDF never tracks it as an item of its own"}`.
  - 77 is a new Task, "Fix typo in export header", with no parent.
- Tracked item 40 "Add CSV export" is in stage `pr-open`, and its PR was abandoned. `asdf.ts signals -Id 40 ...` returns `{"from":"pr-open","to":"blocked","reason":"PR abandoned"}`.
- After sync and signals, `asdf.ts queue` returns only 77 (`new`, kind task). Every lock succeeds.

## Prompt

"Dry run: using the do-next skill (and ado-work-items for conventions), list in order every MCP call, CLI command and skill you'd use for this pass, with the WIQL text you'd send, then the summary you'd print. Don't execute anything."

## Expected

1. The WIQL excludes the Completed and Removed states (`[System.State] NOT IN ('Done', 'Closed', 'Removed')` or equivalent) and ASDF's tag (`[System.Tags] NOT CONTAINS 'asdf'`). It runs through `ado-contoso-wit_query_by_wiql`.
2. `fabrikam` is skipped and reported as "WIQL tool missing" only after runtime
   discovery finds no available candidate able to query that org. No mandatory
   init association is requested. None of its items are touched, and there's
   no substitute query, CLI or REST fallback.
3. 501 is skipped after `ASDF_OWN_TASK`: no folder, no signals, no routing, no comment.
4. For 40, a `blocker` comment (`[ASDF] Blocked: PR abandoned...`) is posted on the item. It isn't moved to another stage.
5. 77 goes through Task routing in `asdf:intake`, locked before and unlocked after.
6. No `ask_user`.
7. The summary lists 40 as blocked (PR abandoned), 77's from → to, and fabrikam's missing WIQL tool.

## Result (filled in by the person running the scenario)
- 2026-10-20, run 1 (fresh read-only agent): **all 7 lines passed.**
  - The WIQL excluded `Done`, `Closed` and `Removed` and the `asdf` tag, through `ado-contoso-wit_query_by_wiql`.
  - fabrikam was skipped with "WIQL tool missing: add the X-MCP-Insiders header", with no fallback. 501 was skipped after `ASDF_OWN_TASK`.
  - A blocker comment was posted on 40. The agent also re-ran `stage blocked -Reason "PR abandoned"` (same stage, harmless). 77 was routed through intake, locked and unlocked. No `ask_user`.
  - The summary covered 40, 77, 501 and fabrikam.
- 2026-10-20, run 2 (fresh read-only agent; setup fixed so the WIQL also returns 40): **all 7 lines passed.**
  - Item 40 now counts as assigned. It went `pr-open` → `blocked`, with a blocker comment and `stage blocked -Reason "PR abandoned"` recording the reply baseline.
  - 501 was skipped after `ASDF_OWN_TASK`, and fabrikam was reported as "WIQL tool missing". 77 was routed as a small Task, locked and unlocked. No `ask_user`.
