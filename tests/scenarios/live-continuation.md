# Scenario: same-conversation continuation

Read-only simulation: do not schedule actual work, launch model processes or
call ADO. Apply live-continuation, work-item, brainstorming and Feature/finish
skills to these independent cases.

- Manually initiated PBI42 waits for owned HLD v2. The host has
  manage_schedule(create/list/stop). ADO later has a fresh approved comment,
  or a fresh Completed transition. Show schedule creation/bind, new-owner entry,
  fresh signal checks, suspend/cancel, and immediate same-conversation planning.
- Chat says approved; separately requests a design change; separately says
  "approved if you change the format". Show current-target checks, receipt and
  feedback gating, not a generic continue requirement or conditional approval.
- A duplicate old tick arrives after revision v3; another session/worker holds
  the item; the live reservation expired during repeated MCP errors.
- An approved Feature has ready child43, completed child44, and dependency-gated
  Proposed child45. Show one eligible child handoff with distinct owner/worktree.
- An owned PR gets feedback, then approval/green checks, then completed. Show
  real policy checks, no chat-vote shortcut, watch rearm and final cleanup.
- Host scheduling is missing; an ask_user form is still pending; invocation is
  bg-orch inline, ASDF_WORKER_REQUEST, or a task-review subagent.
- An unchanged wait receives checks at delays of 5, 10, 15 minutes, continuing
  by five to 60. Show retired-timer cancellation, returned-generation binding,
  ownership through replacement, cap reuse, and restored missing timers without
  another increment. Failed reads back off without renewing priority; actionable
  activity resets the next wait to five minutes.

Expected: one host schedule per live thread with 5-minute linear backoff capped
at 60, a next-delay-plus-ten-minute reservation renewed only after complete
successful reads, quiet unchanged waits, actual
errors reported without fake business transitions, no unattended watches or
new CLI session/daemon. Timer replacement invalidates the old generation; stale
ones never mutate or stop a newer schedule. Chat and ADO approval use the same
version/pending-feedback rules. All ADO writes retain provenance and ownership.
