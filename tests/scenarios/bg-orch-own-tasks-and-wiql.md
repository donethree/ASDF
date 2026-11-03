# Scenario: bg-orch, ASDF's own tasks, a missing WIQL tool, and an abandoned PR

## Setup

- Unattended automation run. Config orgs:
  - `contoso` (`ado-contoso`): its tools include `ado-contoso-wit_work_item` and `ado-contoso-wit_query_by_wiql`. Project `Storage`. Work item types: parent `Product Backlog Item`; task `Task`, `Bug`.
  - `fabrikam` (`ado-fabrikam`): `ado-fabrikam-wit_work_item` is available, but there's no `wit_query_by_wiql` tool, and `wit_query` has no `wiql` action.
- `get_type` for `Product Backlog Item`, `Task` and `Bug` gives these Completed or Removed states: `Done`, `Closed`, `Removed`.
- The tracked-ID assignment WIQL returns tracked ids 500, 77 and 40.
  - 500 is an intake-tracked Feature. Its verified child 501 is an untracked
    HLD task; it is managed, not an independent workflow. A defensive
    `item-new` would return `ASDF_OWN_TASK`.
  - 77 is an intake-tracked Task, "Fix typo in export header", with no parent.
  - 900 is a new unrelated assigned Feature; it is not queried or tracked.
- fabrikam also has an intake-tracked item; its missing WIQL blocks refresh.
- Tracked item 40 "Add CSV export" is in stage `pr-open`, and its PR was abandoned. `asdf.ts signals -Id 40 ...` returns `{"from":"pr-open","to":"blocked","reason":"PR abandoned"}`.
- After sync and signals, `asdf.ts queue` returns only 77 (`new`, kind task). Every lock succeeds.

## Prompt

"Dry run: using the bg-orch skill (and ado-work-items for conventions), list in order every MCP call, CLI command and skill you'd use for this pass, with the WIQL text you'd send, then the summary you'd print. Don't execute anything."

## Expected

1. The assignment WIQL is bounded to tracked IDs 40, 77 and 500, with no
   state/type/tag/watch exclusions. It runs through the available contoso
   WIQL tool. No project-wide search is sent; 900 stays untouched.
2. `fabrikam` is skipped and reported as "WIQL tool missing" only after runtime
   discovery finds no available candidate able to query that org. No mandatory
   init association is requested. None of its items are touched, and there's
   no substitute query, CLI or REST fallback.
3. 501 is skipped as managed: no folder, signals, independent routing or comment.
4. For 40, a `blocker` comment (`[ASDF] Blocked: PR abandoned...`) is posted on the item. It isn't moved to another stage.
5. 77's existing `new` stage goes through only Task routing in `asdf:intake`,
   locked before and unlocked after; no new root is admitted.
6. No `ask_user`.
7. The summary lists 40 as blocked (PR abandoned), 77's from → to, and fabrikam's missing WIQL tool.

## Result

The former broad-discovery scenario results do not validate this narrowed
scope; rerun the simulation against bg-orch.
