# Scenario: intake, finding a Task's workspace

## Setup

- `do-next` pass, unattended. Org `contoso`, MCP server `ado-contoso`.
- `asdf.ts config` lists two workspaces:
  - `C:\src\Payments`, holding repo `Payments` in `contoso/Commerce`;
  - `C:\src\Inventory`, holding repo `Inventory` in `contoso/Commerce`.
- Task 801, "Payments: round totals to cents", is in stage `new` and has no parent. Its description says the fix is in the Payments service's rounding helper.
- Task 802, "Fix the flaky nightly export", is in stage `new` and has no parent. Its description doesn't name a package.
- Every lock succeeds.

## Prompt

"Dry run: using the Task routing in the intake skill (and ado-work-items for conventions), describe exactly what you'd do for Tasks 801 and 802, in order, up to the point where each one's route is decided or it stops: the CLI commands, MCP calls and comments. Don't execute anything."

## Expected

1. For 801, `asdf.ts item-repo -Id 801 -Name Payments` runs before the size is judged.
2. 801 then gets its `task-size` comment and its route, as usual.
3. For 802:
   - a `blocker` comment asks which package the Task is in, listing `Payments` and `Inventory` (with their paths);
   - then `asdf.ts stage -Id 802 -Stage blocked -Reason "package unknown"`, and it stops: no size judgment, no route.
4. No searching the disk for code (no listing of `C:\src`, no scanning git remotes), and no cloning.
5. No `ask_user`.

## Result (filled in by the person running the scenario)
- 2026-10-20, run 1 (fresh read-only agent): **all 5 lines passed.**
  - 801 ran `item-repo -Id 801 -Name Payments` before judging its size, then got its `task-size` comment and route.
  - 802 got a blocker comment listing `Payments` and `Inventory` with their paths, then `stage blocked -Reason "package unknown"`, and stopped before sizing.
  - No disk search, no cloning, no guessing a package, and no `ask_user`.
