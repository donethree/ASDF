# ADO comment and description templates

Placeholders are in `{braces}`. Every comment starts with `[ASDF]`. Use these exactly; don't post comments without a template.

Every template is Markdown (see "Comments" and "Descriptions" in [SKILL.md](./SKILL.md)). Keep the blank lines: Markdown needs them around lists and tables. Repeat a table row once per entry, keep each row on one line, and escape `|` in cell text as `\|`.

`{mention}` is the assignee's (or HLD owner's) mention: `@<identity id>`, or `@Display Name` when the id can't be resolved.

`{design}` is `HLD`, or `Breakdown` on a Feature's Breakdown task.

## question-round
[ASDF] Round {n} for {design} v{version}: {count} question(s) I can't settle from the work item or the code. {mention}

| Q | Question | Recommended | Other options |
|---|---|---|---|
| Q{i} | {question} | A. {recommended}: {reason} | B. {option} · C. {option} |

Assumptions I made (you'll see them again at approval):

- {assumption}

Reply like "Q1 A, Q2 B" or "go with your recommendations", or answer in a Copilot session.

## approval-request
[ASDF] {design} v{version} is ready for approval: {people} decision(s) by people, {assumptions} assumption(s) by ASDF. Full design: {attachment}. {mention}

| # | Decision | How it was made |
|---|---|---|
| D{n} | {decision} | {Decided by NAME (session or ADO comment) / ASDF assumption} |

Reply with "approved", or mark this design task Done. Conditional approval or requested changes require revision.

{Only for a revised breakdown: PBIs that have started and whose scope this version changes: {ids}. PBIs this version drops, for you to remove: {ids}.}

## session-answers
[ASDF] Answers to round {n}, given by {name} in a Copilot session: {Q1 answer; Q2 answer}.

## session-approval
[ASDF] {design} v{version} approved by {name} in a Copilot session.

Reference: {interactionId}.

## session-feedback
[ASDF] Feedback on {design} v{version}, given by {name} in a Copilot session: {summary}.

Reference: {interactionId}.

## blocker
[ASDF] Blocked: {reason}. What I need: {ask}. Reply here and I'll pick it up on the next run. {mention}

## task-size
[ASDF] Treating this as a {small|complex} task: {reason}.

## parent-request
[ASDF] This task needs a parent PBI before I can start (it's complex: {reason}). Please parent it to the right PBI. {mention}

## hld-update
[ASDF] Updated the HLD to v{version} for task {taskId}: {why}. Reply "approved" to accept the update, or explain what needs revision. {mention}

## hld-proposal
[ASDF] Task {taskId} needs a change to this HLD that I won't make on my own: {proposal}. Reply "approved" to accept it, or tell me what to change. {mention}

## final-summary
[ASDF] Merged in PR {prId}.

| Work item | Title | Result |
|---|---|---|
| {id} | {title} | {Closed / Left open: reassigned to NAME / Left open: {reason}} |

As-built notes: {notes}

## feature-split
[ASDF] Making this a Feature: {reason}. Feature {featureId} now holds this work, and this PBI becomes one of its PBIs once the breakdown is approved. Decided by {name} ({session|ADO comment}).

## feature-summary
[ASDF] Every PBI of this Feature is finished.

| PBI | Title | PR | State |
|---|---|---|---|
| {id} | {title} | {prId, or "none"} | {Completed / Removed} |

Closed: {closedIds}.

## hld-description
Design for {type} {parentId}. Full spec, design and diagrams: {attachment} (attached).

| # | Decision | How it was made |
|---|---|---|
| D{n} | {decision} | {Decided by NAME (session or ADO comment) / ASDF assumption, approved with HLD vN} |

## breakdown-description
Breakdown of Feature {featureId}. Full breakdown: {attachment} (attached).

| PBI | Scope | Waits for |
|---|---|---|
| {id, or "new"}: {title} | {scope} | {ids, or "nothing"} |

| # | Decision | How it was made |
|---|---|---|
| D{n} | {decision} | {Decided by NAME (session or ADO comment) / ASDF assumption, approved with breakdown vN} |

## pbi-description
Part of Feature {featureId}, from its approved breakdown v{version} ({attachment}).

- **Scope:** {scope}
- **Not in scope:** {outOfScope}
- **Workspace:** {package}
- **Waits for:** {ids, or "nothing"}
- **Done when:** {doneWhen}

## pbi-scope
Appended below the existing description of a PBI the breakdown reuses, in that description's format. In an HTML description, write the same content as a `<p>` and a `<ul>` with one `<li>` per line.

ASDF scope, from the breakdown of Feature {featureId} v{version} ({attachment}):

- **Scope:** {scope}
- **Not in scope:** {outOfScope}
- **Workspace:** {package}
- **Waits for:** {ids, or "nothing"}
- **Done when:** {doneWhen}
