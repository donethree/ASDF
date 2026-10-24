---
name: intake
description: Use when the user asks to work on, build, fix, or change something, before any other ASDF skill - gets the Feature, PBI, User Story, or Task and creates its ASDF item folder
---

# Intake: the entry point for ASDF work

Every piece of ASDF work hangs off an Azure DevOps work item. This skill finds that item, creates its folder in the asdf-context, and routes it. Use the CLI from the session context (`asdf.ts`) for all state, and `asdf:ado-work-items` for every ADO read and write.

## Session entry

1. If settings/config are missing or invalid, tell the user to run `node "<plugin root>\asdf.js" --init` manually and stop. Init is not a skill; do not launch an interactive wizard from this session.
2. Get the work item: an id or URL from the prompt, or ask with `ask_user`. If the user cannot name a Feature, PBI, User Story, or Task, stop and say so. ASDF never creates work items on its own, and never starts work without one.
3. Resolve the org and project from the URL. With only an id, discover ADO tools
   for each configured org (`asdf.ts config`, `asdf:ado-work-items`) and ask if
   more than one matches. No saved mcpServer is required; a stale hint does not
   preclude another available local/remote server. Verify the response's target
   org/project before proceeding.
   If the actual lookup fails, stop before item/state/code/ADO writes. Include
   the org/project and returned error after trying valid discovered alternatives.
   Use `ask_user` for the actual unresolved access/routing problem; suggest
   manual init only when org/project values need correction, not because the
   optional server hint is absent. Do not assume every failure is login
   related, invent an empty result, change permissions, or fall back to REST.
   An explicit item may be outside discovery watch scopes; ownership and
   configured-org/workspace rules still apply.
4. Fetch the item, then classify its type with `workItemTypes` from the config:
   - a Feature type (`workItemTypes.feature`) is `-Kind feature`;
   - a parent type (PBI, User Story...) is `-Kind parent`;
   - a task type (Task, Bug) is `-Kind task`;
   - anything else, an Epic for example, is unsupported. Say so and stop.
5. If it isn't assigned to you, stop and ask for it to be assigned to you before continuing. Never start someone else's item.
6. Run `asdf.ts item-new -Org <org> -Project <project> -Id <id> -Kind <kind> -Type "<type>" -Title "<title>"`, adding `-ParentId <id>` when it has a parent. If item-new returns ASDF_ID_CLASH, tell the user that ASDF can't track this item, and stop. Another org's item already uses that id.
7. Acquire the item operation lock from `asdf:using-asdf`, and retain its owner across design, planning and implementation handoffs. Release it when this session stops or waits externally. On ASDF_OWN_TASK, use the governing parent item instead; never create a separate workflow for its child.
8. Write `item.md` in the item folder, a snapshot of the work item:
   - title, type, state, assignee, parent;
   - the description, converted to markdown;
   - links and attachment names.

For direct manually initiated work, preserve `origin: live`, a generated
threadId and the root item ID through subsequent skills. This is distinct
from do-next (even manually invoked inline do-next), persistent workers and
subagents. At a design/PR wait, use `asdf:live-continuation` to register a
five-minute same-conversation check when supported; never leave the session
dependent on a separate hourly pass without reporting host limitations.
Direct rejoining of a watched item goes through live-continuation, not a new
workflow or a new owner borrowed from chat history.

## A Feature

A Feature goes straight to asdf:feature-breakdown; never ask whether it should be a Feature.

- If its state category isn't `InProgress` or `Resolved`, ask whether to move it to In Progress, as for a PBI below.
- Then run `asdf.ts stage -Id <id> -Stage new` and `asdf:feature-breakdown` in this session. The breakdown works out whether it needs more than one PBI.

## A PBI or User Story

1. **Check the size first,** before asking about In Progress. Skip this step if the item's `size` is already set, if `workItemTypes.feature` is empty, or if an HLD round has been posted (`hld.roundPostedAt` is set, or `hld.version` is above 0). Skip the size check when the PBI already has an HLD task that ASDF didn't create for it. Look for one as in `asdf:ado-work-items`, "An existing HLD on a parent": its design is under way or done. Never suggest a split once an HLD round has been posted.
   - **Look.** If the work item names a package, match it to a workspace with `asdf.ts item-repo -Id <id> -Name <package>`, as `asdf:brainstorming` does. Judge from the work item and a quick, read-only look at that code.
   - **Large** means the work would ship as separate steps, each a sensible PR on its own, like importing data and then switching its readers over. Work that changes more than one workspace is always large. When in doubt, it is not large.
   - **Not large:** write `{"size":"one"}` to `<item>\patch.json` and run `asdf.ts item-set -Id <id> -File <item>\patch.json`.
   - **Large:** explain why, listing the steps you see. Then ask with `ask_user`, one field with two options: `feature`, "Make it a Feature, with a PBI per step (recommended)", or `one`, "Keep it as one PBI and one PR".
     - `feature`: follow "Making a PBI into a Feature" in `asdf:feature-breakdown`, in this session, and stop here. The PBI waits until the breakdown is approved.
     - `one`: write `{"size":"one"}` with `item-set`, and add a `D` row to `decisions.md`, "Keep it as one PBI", decided by <name> (session). The HLD's decisions table carries it to ADO.
2. If its state category isn't `InProgress` or `Resolved`, ask whether to move it to In Progress. Explain that `do-next` only keeps working on In Progress items. On a yes, move it through `asdf:ado-work-items`.
3. Then run `asdf.ts stage -Id <id> -Stage new` and `asdf:brainstorming`.

## Task routing

Used for a Task or Bug, both here and by `do-next` for Tasks in stage `new`.

First re-read the Task's assignee and parent. If the Task isn't assigned to you, pause it locally and stop without ADO writes. Design tasks (HLD/Design/Breakdown title or tag) are never independent work. An unstarted Task under a tracked PBI that is neither paused nor done belongs to that parent's workflow (`asdf:ado-work-items`). Preserve an already-started standalone Task and resume its current stage instead of rerouting or abandoning its PR. Check roles and parents within the item's org.

1. **Find the workspace.** Run `asdf.ts item-repo -Id <id> -Name <package>` with the package the Task names. Failing that, use a person's reply naming one, or the package of the parent's ASDF item (`repo.name` of the item for `ado.parentId`, if it's tracked). If the Task names no package with a workspace, post the blocker comment asking which one, and stop. List the configured workspaces (`asdf.ts config`) in it, and run `asdf.ts stage -Id <id> -Stage blocked -Reason "package unknown"`.
   Include `-Org <repo org> -Project <repo project>` when the selected name is ambiguous; preserve those qualifiers when using a parent's recorded workspace.
2. **Judge the size.** Small means a few lines of change, with no new interfaces, no new dependencies, and no design ambiguity. Anything else is complex.
   - Post the `task-size` comment on the Task.
   - Record the route: write `{"route":"small"}` (or `"full"`) to `<item>\patch.json`, then run `asdf.ts item-set -Id <id> -File <item>\patch.json`.
3. **Small** (no parent needed, no HLD, no new work items):
   1. `asdf.ts stage -Id <id> -Stage implementing`
   2. `asdf:using-git-worktrees`
   3. Implement with `asdf:test-driven-development` (no plan document)
   4. `asdf.ts stage -Id <id> -Stage self-review`
   5. `asdf:requesting-code-review`
   6. `asdf:finishing-a-development-branch` to open the PR

   The Task description in `item.md` is the spec. No new dependency or design ambiguity is allowed on this route: post a blocker rather than making an unattended chat request. Review uses the Task spec; `ado.reviewId`, an HLD and a plan remain optional.
4. **Complex, with no parent, or with a Feature as its parent:** a Task's parent must be a PBI or User Story. Post the `parent-request` comment, then `asdf.ts stage -Id <id> -Stage awaiting-parent`. Each pass checks again.
5. **Complex, with a parent that has an HLD** (detected as in `asdf:ado-work-items`):
   - Store the parent and its HLD task in `ado.parentId` and `ado.hldId`. Leave `ado.hldOwned` false: that HLD belongs to the parent's design.
   - Download the newest HLD attachment, or use the HLD task's description when it has no attachment. Save it locally as `hld.md` and `hld.v<N>.md`, with N from the attachment or 1, and record `hld.version`. Read it as constraints on this Task, not as a request to implement the whole parent.
   - A Task never starts on an HLD that is not approved yet.
   - **The Task fits the HLD, and the HLD task is in the `Completed` category:** `stage approved`, then `asdf:writing-plans`, with this Task as the only implementation task.
   - **The Task fits, but the HLD isn't approved yet:** set `hld.approvalRequestedAt`, then `stage awaiting-approval`. The Task waits until that HLD is approved.
   - **It doesn't fit:** post the `hld-proposal` comment mentioning the design owner, set `hld.approvalRequestedAt`, then `stage awaiting-approval`. The parent design is shared even when its assignee is you. Never rewrite another owner's HLD.
   - Always set hld.approvalRequestedAt right before stage awaiting-approval. Write `{"hld":{"approvalRequestedAt":"<utc now>"}}` with `asdf.ts item-set`. Only approvals after that time count.
6. **Complex, with a parent that has no HLD:**
   - Create the HLD and Review tasks under the parent (`asdf:ado-work-items`), assigned to this Task's assignee. Store their ids with `hldOwned:true` on this Task's ASDF item, not the possibly untracked parent.
   - `stage new`, then `asdf:brainstorming`, running the full design flow.
   - The Task itself is the implementation task.
