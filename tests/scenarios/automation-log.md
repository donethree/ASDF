# Scenario: lightweight loop decision logging

Read-only simulation using do-next and work-item. No real tool/model/MCP calls
or user configuration writes.

## Inputs

1. All reads succeed; twenty tracked items remain in external waiting states.
2. One source fails; a new PBI 42 is tracked and selected as approved. Router
   phases return approved -> implementing, then implementing -> pr-open.
3. The persistent request has passId `pass-a`, owner `worker-b` and a distinct
   native CLI session ID.
4. An audit call reports `written:false` and a log append warning. Separately,
   an audit invocation is rejected with ASDF_LOCK_NOT_OWNER.
5. A selected operation is deferred; another worker is incomplete without a
   validated acknowledgement. An assignment scan fails and leaves stale
   actionable item state.

## Expected

- Case 1: exactly one automation-log call, action pass-finished, outcome
  no-actionable-work. No pass-start or per-waiting-item entries.
- Case 2: source-skipped, item-tracked, item-selected; router-owned
  stage-finished entries with actual From/To; one pass-finished with outcome
  incomplete because source coverage is incomplete. No raw source payload.
- Every worker event uses pass-a, not worker-b or the native session ID.
- The coordinator does not duplicate the router's phase entries.
- Logging I/O/format warnings appear in the normal summary but do not block
  work, retry successful mutations, widen permissions or recursively log.
- Actual lost ownership stops the worker despite occurring during an audit
  call; it writes nothing further. The coordinator can record its failure.
- Deferred/incomplete operations are not logged as successful work. An
  unsuccessful scan does not establish no-actionable-work or permit stale work.
- Pass outcome is incomplete for failed reads, incomplete/failed workers or
  ownership lost during work. A phase ending in an external wait is logged
  waiting even if it made progress before reaching that wait.
- No conversations, prompts, internal reasoning, responses, tool/code/ADO
  bodies, credentials, CLI session IDs or heartbeat chatter enter the log.
