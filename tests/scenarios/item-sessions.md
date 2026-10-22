# Scenario: persistent item sessions

Use synthetic data and read-only simulated tool outputs. Never execute real ADO
calls, launch a model session or change user settings while running this scenario.

## Inputs

- Invocation: `/asdf:do-next sessions`, from either a desktop or CLI schedule.
- Completed sync; queue includes PBI 42 `pr-feedback`, PBI 43 `approved`,
  Feature 50 `approved`. PBI 44 has another worker; HLD Task 45 belongs to it.
- Runner 42 reports `failed`, `ASDF_WORKER_MCP_UNAVAILABLE`.
- Runner 43's shell initially returns a still-running handle, then completed.
- A resumed worker's old chat says owner `old` and Task 1 unfinished; the
  current request says owner `new` and the durable ledger says Task 1 complete.

## Prompt

Apply do-next, work-item and using-asdf. Show the actual dispatch, ownership,
failure handling and inspection references, then the resumed worker actions.
Separately explain bare do-next, an unknown mode, a disabled required skill,
and a status-export failure after real workflow progress.

## Expected

1. Sessions mode dispatches the runner, not inline stage work; runner owns locks.
2. 44 and its managed Task 45 are not independently dispatched or mutated.
3. 42 is reported without an ADO blocker, stage rewrite, history replacement or
   fallback inline. It is attempted once for that stage in this pass.
4. Track 43's existing shell handle; do not start a duplicate worker or report
   completion before a terminal result. Next item waits for that run.
5. Feature 50 gets a breakdown conversation, not an implementation worktree.
6. Current request is validated, current state/ADO/ledger reread, owner `new`
   retained, Task 1 not repeated. Code uses verified execution context.
7. Work-item acknowledges with worker-complete or reports infrastructure via
   worker-fail, never both, never unlocks the governing runner-owned item.
8. Summary includes session ID, status/transcript paths and freshness; viewing
   files does not intervene in automation or imply a native desktop session.
9. Bare do-next stays inline; unknown/conflicting modes are reported.
10. Disabled skills/permissions are not enabled or bypassed. Observation errors
    do not undo or replay already-applied business changes.
