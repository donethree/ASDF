---
name: ado-work-items
description: Use when reading or writing Azure DevOps work items, comments, attachments, or pull requests for ASDF - the conventions every ASDF ADO write must follow
---

# ADO work items: ASDF conventions

Every ASDF read or write in Azure DevOps (ADO) follows this skill. ADO is reached only through the Azure DevOps MCP server: never the `az` CLI, never REST calls. Code moves with `git`; everything else goes through MCP.

## Discover ADO access at runtime

Manual init stages a dedicated `asdf-ado-<org>` remote MCP entry per org with
`X-MCP-Toolsets: wit,repos,pipelines` and `X-MCP-Insiders: true` for WIQL.
Name collisions or explicit restrictions on that entry block Save; report
the problem for manual review rather than overwriting or removing restrictions.
It preserves local entries,
writes only on final Save, and never starts a server, authenticates or checks
connectivity. Reload/authenticate through the host's normal controls afterward.
`asdf.config.json` lists orgs/projects; `mcpServer` remains a preference hint,
not proof of access or a required runtime prefix. Older configurations without
a hint may keep using working local/shared tools; do not force re-init.

1. When an ADO operation is needed, discover the current host's available tools
   and load their descriptions/schemas. Match the required capability, not a
   guessed tool name. Local stdio, remote and host-provided ADO servers work.
   Try a saved hint first if available; a missing/stale hint is not an error.
2. Establish the target org/project from the work item or repository. For tools
   accepting an org, pass it explicitly. For fixed-org servers, use their
   declared binding and a successful relevant read whose identity/URLs match
   the intended org/project. Never infer org access from a prefix alone.
   Keep this routing only for the current process/session; rediscover in each
   persistent child and after a server disappears or returns an access error.
   Keep the authenticated principal consistent too. When combining or switching
   servers for reads, `@Me` queries or writes, verify they act as the same user
   through returned identity metadata or a discovered current-identity read.
   Refresh assignment after a routing change; do not reuse another principal's
   `@Me` result. If identity cannot be established, defer affected mutations.
3. Use the read already needed by the step to verify access; no separate init
   or first-run connection test. If a hint/candidate is unavailable, lacks the
   capability or fails a read, try other already-available candidates that can
   target the same org. Verify their identity too. Never retry an uncertain
   write through another server: read/reconcile its effects before any retry.
4. If no candidate can perform the required operation, report the actual
   org/project, attempted server/capability and returned error (or missing
   capability). Leave affected items untouched; do not infer empty results,
   reassignment or approval. In live work ask for routing clarification when
   identity is ambiguous; unattended work reports/defer without a chat question.
   Valid ASDF setup needs no re-init just because
   no server hint is saved. Never enable servers, alter permissions or rewrite
   MCP configuration automatically; never fall back to CLI or REST.

**Pull requests live in the item's repo.** Every pull request call uses the item's repo: repo.org, repo.project and repo.name. Discover access for `repo.org` independently; the repo's org/project may differ from the work item's.

| Capability | Tool | Actions |
|---|---|---|
| Read work items and comments; "my" items; type metadata | `wit_work_item` | `get`, `get_batch`, `list_comments`, `my`, `get_type` |
| WIQL queries | `wit_query_by_wiql`. The remote server offers it only with the `X-MCP-Insiders: true` header. Older local servers: `wit_query` with `wiql` | |
| Create, update, add child items | `wit_work_item_write` | `create`, `update`, `add_child` |
| Comments | `wit_work_item_comment_write` | `add`, `update` |
| Attachments | `wit_work_item_attachment_upload`, then `wit_work_item_attachment_link`; download one with `wit_work_item_attachment` | |
| Link work items to each other, or to a PR | `wit_work_item_link_write` | `link`, `link_to_pull_request` |
| Pull requests | `repo_pull_request`, `repo_pull_request_write` | `get`, `create`, `update` |
| PR threads | `repo_pull_request_thread`, `repo_pull_request_thread_write` | `list`, `reply`, `update_status` |
| Builds and logs | `pipelines_build`, `pipelines_build_log` | |
| Repositories | `repo_repository` | |
| Identities (for @-mentions) | The work item's `System.AssignedTo` identity; `core_get_identity_ids` where the server has it | |

Tool/action names in the table and recipes are capability examples. Use the
actual discovered schema's equivalent operations and argument names, never a
guessed prefix or action. Required query scope, ownership and paging remain
unchanged across server implementations.

## Background scope and assignment

`bg-orch` starts with locally tracked items, enrolled through intake, and their
verified descendants. Existing records are grandfathered. A new unrelated
Feature, PBI or Task requires intake even when assigned to you and In Progress.
Configured project/team watches do not authorize background enrollment.

### Read descendants of tracked work

1. Read `asdf.ts items`. Empty roots mean no background ADO work. Use only
   each root's recorded org/project/ID and verified downward hierarchy links
   to establish scope, never an assigned-items search or watch query.
2. Read each root with child relations using a discovered MCP work-item read.
   Follow only hierarchy child links, recursively, deduplicating org/project/ID.
   Read each child's current identity and parent to verify the edge. A
   Related link or ancestor read does not authorize enrollment or sibling
   traversal. Do not follow a moved child outside the rooted hierarchy.
   If the server cannot return complete child relations, report/defer the
   affected branch; do not substitute a project/team discovery scan.
3. Read metadata for encountered configured types to map state categories.
   Track only supported, not-Completed/Removed descendants currently assigned
   to you. Traverse other owners' containers read-only; never change their
   assignments or state. Unknown reads remain unknown, not empty or completed.
4. Classify Features and PBIs before Tasks. Exclude child HLD/Design/Breakdown
   tasks by the title/tag conventions below, including untagged hand-made
   tasks.
   ASDF's own HLD, Review and implementation tasks are never items of their own.
   An independent Task is absorbed by its tracked PBI only before
   work starts, and only while that PBI is neither paused nor done. Unstarted
   means tracked/new/awaiting-parent with no posted HLD round, approval
   request/version, worktree or PR. Preserve already-started standalone
   workflows, including feedback and close-out; explicitly recorded roles
   remain managed children.
5. Before `item-new`, re-read assignment and verify the current parent/path.
   After enrollment, include the child in the normal tracked-ID assignment
   check. Acquire its own lock before writing its snapshot/signals; a root's
   lock never grants ownership of its child.

- If an org has no WIQL tool, skip that org and report it; never mark its items unassigned. This means no discovered candidate can run the required query for that org, not that a saved prefix is absent. Report the actual capability/access problem; suggest manual init only for incorrect org/project/team values, not for a missing hint.

### Refresh assignment for tracked work

Group tracked, not-done items by their recorded org/project, including projects
with no watch scopes and explicitly intaken projects outside those scopes.
Their org must still be configured in ASDF and accessible through a discovered
MCP tool; unknown or inaccessible orgs are reported and left untouched.

For each group, batch at most 200 in-scope tracked IDs in a JSON array file. Run
`asdf.ts assignment-query -Org <org> -Project <project> -File "<tracked-ids.json>" -AfterId 0`,
execute the returned query through MCP with `top: 200`, and page using
`query-page -File "<ids.json>" -AfterId <cursor> -PageSize 200` until complete.
Save each returned ordered ID page; when `afterId` is not null, regenerate
`assignment-query` with that cursor and repeat. Truncation warnings, failed
calls or invalid/nonadvancing pages invalidate the batch. This query uses `@Me` but no
team, area, type, tag, completed or removed-state discovery exclusions.

Only a successfully completed assignment batch defines true/false assignment
for its tracked IDs. A missing ID in that complete batch is false; a failed or
incomplete batch is unknown and permits no signals or snapshot writes for
those IDs. Read actual work-item state/parent and PR information as usual;
completed items still need close-out. A failed child read does not block an
independently refreshed branch; it defers items whose necessary reads failed.

For newly enrolled descendants, obtain the same current tracked assignment
check after item-new before writing signals. Watch settings do not expand or
abandon these tracked workflows.

## States

Never hard-code state names. Processes differ (Active, Committed, In Progress, Done, Closed...).

- Read the type's states and their categories with `wit_work_item get_type`. The categories are `Proposed`, `InProgress`, `Resolved`, `Completed` and `Removed`.
- To move an item into a category, set `System.State` to the first state in that category.

## Creating ASDF's tasks under a parent

- **When:** when ASDF picks up a parent, it creates the HLD task and the Review task together, in one go. Implementation tasks come only after the HLD is approved (`asdf:writing-plans`).
- **Type:** the first entry of `workItemTypes.task` (normally `Task`).
- **Titles:** `HLD: <parent title>`, `Review: <parent title>`, `Impl <n>: <step>`.
- **Tags** (`System.Tags`, `;`-separated): `asdf; asdf-hld`, `asdf; asdf-review`, `asdf; asdf-impl`.
- **Assigned to:** the governing ASDF work item's assignee (the Task's assignee on the standalone Task path). **Area and iteration:** the parent's.
- **Create with** `wit_work_item_write add_child` under the ADO parent, with any description in Markdown (see "Descriptions"). Then store the ids: write `{"ado":{"hldId":<id>,"hldOwned":true,"reviewId":<id>}}` to `<item>\patch.json` and run `asdf.ts item-set -Id <item id> -File <item>\patch.json`. The ASDF item id is the Task id on the standalone Task path, not its untracked parent. Implementation task ids go in `ado.implIds` the same way. Reuse already recorded HLD/Review tasks on retries.
- **An existing HLD on a parent:** a child Task tagged `asdf-hld`, or one whose title starts with `HLD` or `Design` (case-insensitive). Its owner is that Task's assignee. `asdf:brainstorming` decides whether to drive it or wait for it.
- **A Feature** gets only a Breakdown task, created when ASDF picks the Feature up: title `Breakdown: <feature title>`, tags `asdf; asdf-breakdown`, assigned and placed like the tasks above. Store it as the Feature's design task: `{"ado":{"hldId":<id>,"hldOwned":true}}`. A Feature never gets an HLD task, a Review task or implementation tasks.
- **An existing Breakdown task on a Feature:** a child Task tagged `asdf-breakdown`, or one whose title starts with `Breakdown` (case-insensitive). `asdf:feature-breakdown` decides whether to drive it or wait for it.

## Features and their PBIs

- **Creating a Feature.** Create a Feature only with the person's OK. That's a yes in a session, or their answer to the size question. Use `wit_work_item_write create` with the first type in `workItemTypes.feature`, copying the PBI's title, description (in its existing format), area path, iteration and assignee. Link the PBI under it with `wit_work_item_link_write link`, the Feature being the parent, then move the Feature to the first state in the `InProgress` category. If no tool can link existing work items, ask the person to put the PBI under the Feature, and stop.
- **Creating a Feature's PBI.** Use `wit_work_item_write add_child` under the Feature. The type is the first type in `workItemTypes.parent` that the project has (check with `get_type`). Copy the area path and iteration from the Feature, assign it to the Feature's assignee, and set the description from the `pbi-description` template in Markdown. A PBI that waits for another is created in the first `Proposed` state. A Feature's PBIs never carry the asdf tag. They are tracked by the approved breakdown and remain in the Feature's background scope.
- **Reusing a PBI.** For an existing child PBI that the breakdown reuses, set its title from the breakdown and append the `pbi-scope` template below its description, keeping the text that's there and its format. Only for a PBI assigned to you that hasn't started.
- **Reading a Feature's PBIs.** Run this with the org's WIQL tool, then `get_batch` for their states, mapped to categories through `get_type`:

  ```
  SELECT [System.Id] FROM WorkItems
  WHERE [System.Parent] = <feature id> AND [System.WorkItemType] IN (<workItemTypes.parent, quoted>)
  ```

  Never count the Breakdown task as one of a Feature's PBIs.

## Comments

- Every ASDF comment starts with [ASDF]. ASDF posts as you, so the marker is how ASDF tells its own comments apart. The CLI's approval and answer detection depends on it.
- Use a template from [templates.md](./templates.md) for every comment; nothing else gets posted.
- Post one comment per question round. Never one comment per question.
- ASDF comments only for question rounds, approval requests, blockers, task-size and parent requests, Feature splits, HLD updates and proposals, session summaries, and the final and Feature summaries. Never progress updates.
- After a blocker comment, run stage blocked with -Reason, so that a reply unblocks the item. The full command is `asdf.ts stage -Id <id> -Stage blocked -Reason "<reason>"`. Add `-WorkItemId <id>` when the comment went on a different work item than the item's own.
- @-mention the assignee (or the HLD owner) in question rounds, approval requests, blockers, parent requests and HLD updates, so ADO sends an email.
  - In Markdown a mention is `@<identity id>`. Take the identity id from the work item's `System.AssignedTo` (its `id`), or from `core_get_identity_ids` where the server has it.
  - If you can't resolve it, write `@Display Name` as plain text.
- **Comments are Markdown.** Select the comment tool's Markdown format explicitly (for example `format: "Markdown"`); don't rely on the server's default. Write Markdown only: servers escape raw HTML in a Markdown comment, so `<p>`, `<br>` or `<a>` would show up as text.
  - `[ASDF]` is the first text of the comment, written literally: not bold, escaped, or inside a heading or table.
  - Put a blank line before and after every list and table. Keep each table row on one line, with no line break inside a cell, and escape `|` in cell text as `\|`.
  - **If the discovered comment tool has no format option** (older servers post HTML), write the same template as HTML instead: `<p>`, `<ul><li>`, and `<table>` with `<th>`/`<td>` for tables. Mentions are then `<a href="#" data-vss-mention="version:2.0,<identity id>">@<Display Name></a>`, and `[ASDF]` is still the first visible text.

## Descriptions

ADO stores each large text field (Description, Repro Steps, Acceptance Criteria) as HTML or Markdown, per work item. Switching a field to Markdown is permanent for that work item.

- **Descriptions ASDF writes in full use Markdown:** `hld-description` on the HLD task it drives, `breakdown-description` on the Breakdown task it drives, `pbi-description` on the PBIs it creates, and the HLD, Review, Breakdown and implementation tasks it creates. Set the format in the same write:
  - create and `add_child`: the field's or item's `format: "Markdown"`;
  - a JSON Patch update: add `{"op":"add","path":"/multilineFieldsFormat/System.Description","value":"Markdown"}` next to the `/fields/System.Description` operation.
- **Never convert a description someone else wrote.** When ASDF adds to a description it doesn't write in full (`pbi-scope` on a reused PBI, a copied description, or a Feature that is its own design item), read the work item's `multilineFieldsFormat`: no entry for the field means HTML. Write the addition in that format (`<p>`, `<ul><li>`, `<table>` for HTML), and leave out the `multilineFieldsFormat` operation.
- If a server's write tool has no format option and no JSON Patch update, write HTML as above, rendering tables as `<table>`.

## The HLD on the HLD task

Before changing a design's description, attachments or state, verify this item drives it and its current assignee is you. A non-owned shared HLD is read-only; proposals may be posted but never applied on behalf of its owner. For the Feature-as-design fallback, the Feature itself must still be assigned to you.

Upload a new HLD version only when you request approval (`asdf:brainstorming` decides when). Question rounds never upload, so the task doesn't fill up with drafts.

1. Copy `hld.md` to `hld.v<N>.md` in the item folder, where N is `hld.version`.
2. Upload it with `wit_work_item_attachment_upload`, then link it to the HLD task with `wit_work_item_attachment_link`.
3. Set the HLD task's `System.Description` from the `hld-description` template, in Markdown (see "Descriptions"): one line pointing at the latest attachment, then the key-decisions table, one row per decision with how it was made.

A Feature's breakdown goes to its Breakdown task the same way: `breakdown.md` is copied to `breakdown.v<N>.md`, and the description comes from the `breakdown-description` template.

## Approval and answers: never judge them in prose

Build the item's signals file under its held operation lock, then run `asdf.ts signals -Id <id> -File <item>\signals.json -Owner <operation owner>`. The CLI applies the rules:

- `[ASDF]` comments never count.
- Only comments newer than the latest round or approval request count.
- Approval by state counts only when the HLD task moved to Completed after the approval request.
  Later human feedback supersedes that Done transition. A plain unconditional
  `approved` or `approved, ship it` comment (case-insensitive, optional terminal
  punctuation) can approve the current request; mixed conditions/changes are
  feedback. Accepted pending revisions must be recorded and published as a newer
  request before approval can advance work. Shared waiters do not publish an
  owner's revision, and Feature self-ID fallback never treats Feature Done as
  design approval. Use the shared signals/receipt helpers, not prose guesses.

Use what it reports. For a Feature, its Breakdown task plays the part of the HLD task.

## Signals recipe

Write `<item>\signals.json` with only the sections you checked this pass. The `hld` fields come from the item's design task (`ado.hldId`): the HLD task, or a Feature's Breakdown task.

| Field | How to get it |
|---|---|
| `workItem.assignedToMe` | Membership in the successfully completed tracked-ID assignment batch, never the discovery result. A failed/incomplete batch supplies no signal |
| `workItem.stateCategory` | The item's `System.State`, mapped through `get_type` |
| `workItem.parentId` | The item's parent link, or `null`. For a Task, also `null` when the parent is a Feature (its type is in `workItemTypes.feature`): a Task's parent must be a PBI or User Story |
| `parent.stateCategory` | The parent from `get_batch`, mapped through `get_type` |
| `hld.stateCategory` | The design task's state, mapped through `get_type` |
| `hld.stateChangedAt` | The design task's `Microsoft.VSTS.Common.StateChangeDate` |
| `hld.comments` | `list_comments` on the design task, mapped to `{createdAt: createdDate, author: createdBy.displayName, text}` |
| `pbis` | For a Feature: each of its PBIs ("Reading a Feature's PBIs"), as `{id, stateCategory}` |
| `blocker.comments` | The same, on `blocker.workItemId` |
| `pr.status` | `active`, `completed` or `abandoned`, from `repo_pull_request get` |
| `pr.approved` | Some reviewer voted 5 or 10, and nobody voted below 0 |
| `pr.mergeConflicts` | `mergeStatus` is `conflicts` |
| `pr.build` | The latest `pipelines_build` result for `refs/pull/<id>/merge` (`succeeded`, `failed`, `inProgress`), or `none` if there are no builds |
| `pr.threads` | Non-system threads, each `{status, lastCommentIsAsdf}`. `lastCommentIsAsdf` means the last comment starts with `[ASDF]` |

## Closing items

- Re-read each target's assignee before changing its state, description or links. Close ASDF's own tasks only while they are still assigned to you. The standalone Task itself follows this same rule.
- Close or reopen an HLD task only when ado.hldOwned is true. An HLD that ASDF adopted belongs to its owner.
- Close a parent only when it's assigned to you and every child task is in `Completed`. Otherwise leave it alone; it may belong to someone else, or other developers' tasks may still be open.
- Close a Feature the same way: only when it's assigned to you and every child is complete (`asdf:feature-breakdown`).

## Never

- Never vote on a pull request.
- Never set bypassPolicy.
- Never use the `az` CLI or REST calls for ADO.
- Never rewrite another owner's HLD on your own; post the `hld-proposal` template instead.
- Never post conversation transcripts to ADO.
