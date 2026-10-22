---
name: ado-work-items
description: Use when reading or writing Azure DevOps work items, comments, attachments, or pull requests for ASDF - the conventions every ASDF ADO write must follow
---

# ADO work items: ASDF conventions

Every ASDF read or write in Azure DevOps (ADO) follows this skill. ADO is reached only through the Azure DevOps MCP server: never the `az` CLI, never REST calls. Code moves with `git`; everything else goes through MCP.

## The MCP server for each org

- `asdf.config.json` (`asdf.ts config`) lists each org with its `mcpServer`. That server's tools are named `<mcpServer>-<tool>`, for example `ado-contoso-wit_work_item`.
- **Pull requests live in the item's repo.** Every pull request call uses the item's repo: repo.org, repo.project and repo.name. Use the MCP server of `repo.org`; the repo's project can differ from the work item's.
- Match tools by capability, not exact name. Server versions differ, so use whichever available tool does the job.
- If an org's tools are missing (the server isn't configured, or it needs an interactive sign-in), say so and skip that org. Never fall back to the CLI or REST.

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

## Items assigned to you

Discovery and assignment are separate. Discovery chooses new items to track;
it never proves that a missing tracked item was reassigned.

### Discover new work from configured sources

1. Run `asdf.ts discovery-sources`. An empty project's `watchScopes` means
   no discovery there, even when it contains a registered code repository.
2. For each source, read metadata with `get_type` for the configured types and
   their Completed/Removed states. Report types the project explicitly says
   do not exist; do not mistake access errors for missing types. If no configured
   types are available, report the configuration problem and skip that source.
3. Save `{"expectedSource":<the returned source>,"types":[...],"completedStates":[...]}`
   under `<context>\discovery\<pass owner>\`. Run
   `asdf.ts discovery-query -Index <index> -File "<filters.json>" -AfterId 0`.
4. Call the org's WIQL MCP tool with exactly the returned query and
   `top: <pageSize>` (200). For a team scope also supply the returned team
   where the tool supports it. Save returned work-item IDs, in order, to a
   JSON array file and run `asdf.ts query-page -File "<ids.json>" -AfterId <cursor> -PageSize 200`.
   If `afterId` is not null, generate the next query with that cursor and repeat.
   A full page is not a complete inventory. Truncation warnings, unsupported
   paging, invalid/nonadvancing pages or failed calls invalidate that source.
5. Only after all pages succeed, union its IDs with other successful sources.
   Never remove a scope clause, change a failed team scope into the whole project,
   or treat failure as an empty result. Report failed sources with the real
   org/project/team error and guidance to check manual init values and MCP access.

Team queries use the qualified `@TeamAreas('[<project>]\<team>')` capability.
The team name is not an area path; browser backlog levels and display parameters
are not discovery filters. If the server does not support this query capability,
skip/report the source rather than guessing its areas or widening it.
Project sources use their explicit area paths; empty area paths means whole project.

- The tag filter leaves out the tasks ASDF creates. ASDF's own HLD, Review and implementation tasks are never items of their own.
- Before tracking results, classify parent and Feature items first. Exclude child HLD/Design/Breakdown tasks by the title/tag conventions below, including untagged hand-made tasks. An independent Task is absorbed by its tracked PBI only before work starts, and only while that PBI is neither paused nor done. Unstarted means tracked/new/awaiting-parent with no posted HLD round, approval request/version, worktree or PR. Preserve already-started standalone workflows, including their feedback and close-out; never silently hide them when the parent is tracked later. Explicitly recorded HLD/Review/implementation roles remain managed children.
- If an org has no WIQL tool, skip that org and report it; never mark its items unassigned. Direct the user to check `node "<plugin root>\asdf.js" --init` and verify that the configured MCP has ADO/WIQL access.

### Refresh assignment for tracked work

Group tracked, not-done items by their recorded org/project, including projects
with no watch scopes and explicitly intaken projects outside those scopes.
Their org must still have a configured MCP; missing orgs are reported and left
untouched.

For each group, batch at most 200 tracked IDs in a JSON array file. Run
`asdf.ts assignment-query -Org <org> -Project <project> -File "<tracked-ids.json>" -AfterId 0`,
execute the returned query through MCP with `top: 200`, and page using
`query-page` exactly as above until complete. This query uses `@Me` but no
team, area, type, tag, completed or removed-state discovery exclusions.

Only a successfully completed assignment batch defines true/false assignment
for its tracked IDs. A missing ID in that complete batch is false; a failed or
incomplete batch is unknown and permits no signals or snapshot writes for
those IDs. Read actual work-item state/parent and PR information as usual;
completed items still need close-out. A failed discovery source does not block
independently successful tracked-item refresh.

For newly discovered candidates, obtain the same current tracked assignment
check after item-new before writing signals. Removing a watch stops new
discovery; it does not abandon already-tracked workflows.

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
- **Create with** `wit_work_item_write add_child` under the ADO parent. Then store the ids: write `{"ado":{"hldId":<id>,"hldOwned":true,"reviewId":<id>}}` to `<item>\patch.json` and run `asdf.ts item-set -Id <item id> -File <item>\patch.json`. The ASDF item id is the Task id on the standalone Task path, not its untracked parent. Implementation task ids go in `ado.implIds` the same way. Reuse already recorded HLD/Review tasks on retries.
- **An existing HLD on a parent:** a child Task tagged `asdf-hld`, or one whose title starts with `HLD` or `Design` (case-insensitive). Its owner is that Task's assignee. `asdf:brainstorming` decides whether to drive it or wait for it.
- **A Feature** gets only a Breakdown task, created when ASDF picks the Feature up: title `Breakdown: <feature title>`, tags `asdf; asdf-breakdown`, assigned and placed like the tasks above. Store it as the Feature's design task: `{"ado":{"hldId":<id>,"hldOwned":true}}`. A Feature never gets an HLD task, a Review task or implementation tasks.
- **An existing Breakdown task on a Feature:** a child Task tagged `asdf-breakdown`, or one whose title starts with `Breakdown` (case-insensitive). `asdf:feature-breakdown` decides whether to drive it or wait for it.

## Features and their PBIs

- **Creating a Feature.** Create a Feature only with the person's OK. That's a yes in a session, or their answer to the size question. Use `wit_work_item_write create` with the first type in `workItemTypes.feature`, copying the PBI's title, description, area path, iteration and assignee. Link the PBI under it with `wit_work_item_link_write link`, the Feature being the parent, then move the Feature to the first state in the `InProgress` category. If no tool can link existing work items, ask the person to put the PBI under the Feature, and stop.
- **Creating a Feature's PBI.** Use `wit_work_item_write add_child` under the Feature. The type is the first type in `workItemTypes.parent` that the project has (check with `get_type`). Copy the area path and iteration from the Feature, assign it to the Feature's assignee, and set the description from the `pbi-description` template. A PBI that waits for another is created in the first `Proposed` state. A Feature's PBIs never carry the asdf tag. They're ordinary PBIs, and the assigned-items query leaves out anything tagged `asdf`.
- **Reusing a PBI.** For an existing child PBI that the breakdown reuses, set its title from the breakdown and append the `pbi-scope` template below its description, keeping the text that's there. Only for a PBI assigned to you that hasn't started.
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
  - A real mention is `<a href="#" data-vss-mention="version:2.0,<identity id>">@<Display Name></a>`. Take the identity id from the work item's `System.AssignedTo` (its `id`), or from `core_get_identity_ids` where the server has it.
  - If you can't resolve it, write `@<Display Name>` as plain text.
- Comments are HTML. Use `<p>`, `<br>` and `<ul>`. The `[ASDF]` marker must be the first visible text.

## The HLD on the HLD task

Before changing a design's description, attachments or state, verify this item drives it and its current assignee is you. A non-owned shared HLD is read-only; proposals may be posted but never applied on behalf of its owner. For the Feature-as-design fallback, the Feature itself must still be assigned to you.

Upload a new HLD version only when you request approval (`asdf:brainstorming` decides when). Question rounds never upload, so the task doesn't fill up with drafts.

1. Copy `hld.md` to `hld.v<N>.md` in the item folder, where N is `hld.version`.
2. Upload it with `wit_work_item_attachment_upload`, then link it to the HLD task with `wit_work_item_attachment_link`.
3. Set the HLD task's `System.Description` from the `hld-description` template: one line pointing at the latest attachment, then the key-decisions table, one line per decision with how it was made.

A Feature's breakdown goes to its Breakdown task the same way: `breakdown.md` is copied to `breakdown.v<N>.md`, and the description comes from the `breakdown-description` template.

## Approval and answers: never judge them in prose

Build the item's signals file under its held operation lock, then run `asdf.ts signals -Id <id> -File <item>\signals.json -Owner <operation owner>`. The CLI applies the rules:

- `[ASDF]` comments never count.
- Only comments newer than the latest round or approval request count.
- Approval by state counts only when the HLD task moved to Completed after the approval request. Otherwise, an approval is the latest human comment after the request, starting with "approved".

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
