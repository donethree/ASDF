# Scenario: do-next, a pass with a lost lock and an unreachable org

## Setup

- Unattended automation run. Config orgs: `contoso` (`ado-contoso`, all its tools available, including `ado-contoso-wit_query_by_wiql`) and `contoso2` (`ado-contoso2`). This session has no `ado-contoso2-*` tools at all.
- After sync and signals, `asdf.ts queue` returns, in order:
  - 31 "Fix export encoding" (`pr-feedback`)
  - 32 "Add CSV export" (`merged`)
  - 33 "Retry on false" (`implementing`, route full)
  - 34 "Dark mode" (`new`, kind parent)
- `asdf.ts lock -Id 33 ...` returns `acquired: false`, because another pass took it after the queue was read. Every other lock succeeds.

## Prompt

"Dry run: using the do-next skill (and ado-work-items for conventions), list in order every CLI command you'd run and every skill you'd invoke for this pass, then the summary you'd print. Don't execute anything."

## Expected

1. `contoso2` is skipped and reported as "sign-in needed", with none of its items touched. There's no CLI or REST fallback.
2. 31 is handled first (`asdf:receiving-code-review`), then 32 (`asdf:finishing-a-development-branch`, close-out), then 34 (`asdf:brainstorming`).
3. 33 is skipped untouched: no work, no stage change, no unlock.
4. Each of 31, 32 and 34 is locked before its work and unlocked after it.
5. The pass doesn't stop after 31.
6. No `ask_user`.
7. The summary lists from → to for each item touched, plus the skipped org.

## Result (filled in by the person running the scenario)

- 2026-10-20, run 1 (fresh read-only agent): **all 7 lines passed.**
  - `contoso2` was skipped and reported as sign-in needed, with no fallback.
  - The order was 31 (receiving-code-review), 32 (finishing, close-out), then 34 (brainstorming), each locked before its work and unlocked after.
  - 33 was left untouched (no work, stage change or unlock), and there was no `ask_user`.
  - The summary gives from → to per item.
- 2026-10-20, run 2 (fresh read-only agent, after the minor fixes; the setup now says `contoso` has a WIQL tool): **all 7 lines passed.**
  - `contoso2` was skipped as "sign-in needed". The order was 31, 32 and 34, each locked and unlocked. 33 was left untouched, and there was no `ask_user`.
  - The fixes were also followed: pushes used `<repo.branch>`, and the agent stated the `ASDF_LOCK_NOT_OWNER` rule (stop the item, write nothing).
