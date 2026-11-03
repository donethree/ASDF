---
name: sessions
description: Use when asked to list or inspect tracked ASDF sessions, their Feature and PBI associations, or what work each session is doing
---

# Sessions

Show a read-only snapshot of recorded ASDF sessions from the configured
asdf-context. This inspection needs no tracking work item.

Run `asdf.ts sessions` using the ASDF CLI path from session context:

```text
node "<plugin root>\scripts\asdf.ts" sessions
```

Render the returned rows as a Markdown table with exactly these columns:

| Session | Feature | PBI | Stage | Current work/status |
|---|---|---|---|---|

- **Session:** session ID and mode (`persistent` or `interactive`).
- **Feature / PBI:** recorded ID and title; `-` when not locally known.
- **Stage:** the recorded work-item stage.
- **Current work/status:** the returned `status` and `work`, including waits/errors.

Use one row per returned session/work-item association, including stopped,
completed and failed records. Escape pipes and flatten newlines in table cells.
An interactive thread can appear against several items; do not merge those rows.
Items without a binding or live-watch record are not sessions. Replaced binding
history is not included. Empty results mean "No ASDF sessions recorded."

This is local recorded state, not proof that a terminal is open or that a
process is alive. Missing hierarchy stays unknown; do not query ADO to fill it.
Report CLI errors explicitly. Do not initialize settings, acquire locks,
refresh/sync state, run bg-orch, recover, select, resume or launch sessions.
