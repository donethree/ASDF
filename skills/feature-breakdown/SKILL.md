---
name: feature-breakdown
description: Use when an ASDF Feature needs its breakdown, has new answers, was approved, or has every PBI finished - or when a PBI or User Story is being made into a Feature
---

# Feature breakdown: a Feature into PBIs

Large work is a Feature, built as one or more PBIs. ASDF works out the Feature and its requirements, and breaks it into PBIs that each ship on their own, in one reviewable PR. Each PBI then gets its own detailed HLD and goes through the normal flow. A Feature never gets an HLD, a Review task, implementation tasks or a PR.

Use the CLI (`asdf.ts`) for state, and `asdf:ado-work-items` for every ADO read, write and template. In the templates, `{design}` is `Breakdown`.

Acquire or reuse the item operation lock from `asdf:using-asdf` on every entry. Recheck the Feature's assignment before writes. Before revising or approving its design, check the Breakdown task's current owner and `ado.hldOwned`, even at `answers-received`. A shared Breakdown follows brainstorming's shared-design path: read replies and wait, never rewrite it. The fallback `ado.hldId == id` may be edited only while the Feature itself is assigned to you; it is not permission to close the Feature as a design task.

## Cases

| Stage, or situation | Sections |
|---|---|
| `new`: start the breakdown | 1 to 6 |
| `answers-received`: revise it. If `lastReason` is `breakdown reopened`, read section 9 first | 2 to 6 |
| `approved`: create the PBIs | 7 |
| `pbis-done`: every PBI is finished | 8 |
| `intake` or `asdf:brainstorming` is making a PBI into a Feature | 10 |

A Feature at `awaiting-pbis` needs nothing from this skill. Each `do-next` pass lists its PBIs that are ready for a person to start.

## 1. Set up

Run `asdf.ts item -Id <id>`. If `ado.hldId` is set, carry on. Otherwise look for an existing Breakdown task on the Feature (`asdf:ado-work-items`):

- **None:** create the Breakdown task, store its id with `"hldOwned":true`, and move it into the `InProgress` category.
- **One assigned to you, not Completed, and not driven by another independent item in this org:** it's yours to drive. Non-owning waiters and legacy managed children are not drivers (`asdf:brainstorming`). Store its id with `"hldOwned":true`.
- **One in the `Completed` category:** it's approved already. Store its id, copy its newest breakdown attachment into `breakdown.md` and `breakdown.v1.md`, write `{"hld":{"version":1,"approvedBy":"state","approvedAt":"<utc now>"}}`, run `asdf.ts stage -Id <id> -Stage approved`, and continue with section 7.
- **Anything else** (assigned to someone else, or another item's `ado.hldId`): never write over a breakdown that another person drives. Store its id, write `{"hld":{"approvalRequestedAt":"<utc now>"}}`, run `asdf.ts stage -Id <id> -Stage awaiting-approval`, and stop.

If the project's process doesn't allow a Task under a Feature (`add_child` fails), store the Feature's own id as `ado.hldId` with `"hldOwned":false`. Its comments then carry the rounds and the approval: only a comment starting with "approved" approves, and ASDF never closes the Feature as a design task.

## 2. Gather inputs (read-only)

- `item.md`, plus the Feature's links and attachments. Download the ones that matter into the item folder.
- Its existing child PBIs (`asdf:ado-work-items`, "Reading a Feature's PBIs"): titles, descriptions, states and assignees.
- **The workspaces it touches.** Match each package the Feature names to a workspace in `asdf.ts config`. Never search the disk for code.
- **The memory index** of each repo: resolve with `asdf.ts memory-path -Org <org> -Project <project> -Repo <repo>`. Read that qualified index and its linked specs. Follow brainstorming's identity checks before reusing any legacy name-only entry.
- **The code** in those workspaces, read-only. Do the deep dive from `asdf:brainstorming` step 2 at the Feature's breadth, and write it to the Feature's `deep-dive.md`. Cover each area the Feature touches, what depends on it, and what each step would break if it shipped alone. Each PBI's own deep dive starts from it.
- The current `breakdown.md`, `questions.md` and `decisions.md`, if they exist.

## 3. Draft or revise `breakdown.md`

Whoever designs a PBI must be able to write its HLD from the breakdown without going back to anyone. Cover:

- Intent and why. Goals, non-goals, anti-goals. Constraints.
- **The requirements:** what must be true when the whole Feature is done.
- **The decisions that span PBIs**, as `D` numbers from `decisions.md`. For example, which PBI owns a new table schema, or how readers switch from the old store to the new one.
- **The PBIs, in order.** For each:
  - its title;
  - its scope: what's in, and what's out;
  - the workspace (package) it changes;
  - which PBIs must be done before it starts;
  - what's true when it ships.

The rules for the list:

- **Each PBI ships on its own.** Once merged, it leaves the product working, and it fits in one reviewable PR. Work in more than one workspace is more than one PBI.
- **Existing child PBIs are mapped to entries,** never duplicated. One that has started, or is assigned to someone else, is listed as it is.
- **A Feature that needs only one phase** gets a single PBI.

Detailed design belongs in each PBI's HLD, not in the breakdown. Keep it simple: the fewest PBIs that keep every PR reviewable.

## 4. Questions and answers

Follow `asdf:brainstorming` steps 4 to 7 (questions, a live session, an unattended run, answers), reading:

- the Breakdown task for the HLD task;
- `breakdown.md` for `hld.md`;
- `Breakdown` for `{design}` in the templates.

Record every decision in `decisions.md` with how it was made, as `asdf:brainstorming` does. Then revise the breakdown (section 3), and ask the next round, or go on to section 5.

## 5. Builder check

Before requesting approval, once per version, dispatch a fresh subagent with [breakdown-check-prompt.md](./breakdown-check-prompt.md) and the paths to `breakdown.md` and the Feature's `deep-dive.md`. Sort what comes back as in `asdf:brainstorming` step 8.

## 6. Approval

Follow `asdf:brainstorming` steps 9 and 10, with:

- `breakdown.md` copied to `breakdown.v<N>.md`, uploaded and linked to the Breakdown task;
- the Breakdown task's description from the `breakdown-description` template;
- the `approval-request` and `session-approval` templates, with `{design}` set to `Breakdown`.

`asdf.ts signals` detects the approval, as for an HLD. After an approval in a live session, continue with section 7.

## 7. After approval: create the PBIs (stage `approved`)

1. **Close the Breakdown task** if `ado.hldOwned` is true: move it to the `Completed` category, and write `{"hld":{"closedAt":"<utc now>"}}` with `item-set`.
2. **Mark the assumptions approved** in `decisions.md`: `ASDF assumption, approved with breakdown v<N>`.
3. **Create the missing PBIs.** Create only the PBIs the approved breakdown lists. For each entry without a PBI, create one under the Feature (`asdf:ado-work-items`, "Creating a Feature's PBI"), with its description from `pbi-description`. A PBI that waits for another is created in the `Proposed` category. A Feature's PBIs never carry the asdf tag.
4. **Update the reused PBIs.** Re-read assignment first; leave any PBI no longer assigned to you untouched. Within that owned set, the PBI this Feature was split from gets its title and scope from the breakdown. You can tell it by its `size` (`phase`) and its `ado.parentId` (this Feature), both set in section 10. Its only round was the size question, so it counts as not started. Do the same for each other existing child PBI the breakdown reuses, if it hasn't started (in the `Proposed` category, with no HLD round posted). That means setting its title from the breakdown and appending `pbi-scope`. Never edit or remove a PBI that has started or is assigned to someone else.
5. **Track them.** For each of the Feature's PBIs assigned to you, run `asdf.ts item-new -Org <org> -Project <project> -Id <pbi id> -Kind parent -Type "<type>" -Title "<title>" -ParentId <feature id>`, then write `{"size":"phase"}` with `item-set`.
6. **Record them on the Feature** with `item-set`, in the breakdown's order: `{"ado":{"pbis":[{"id":<id>,"waitsFor":[<ids>]}]}}`, one entry per PBI.
7. **Start the PBIs that wait for nothing:** re-read each PBI and move it to the first `InProgress` state only if it is still assigned to you and still Proposed. Leave other people's and already-started PBIs untouched. The next `do-next` pass picks it up like any PBI. Never start a PBI that waits for another; a person starts it.
8. Run `asdf.ts stage -Id <feature id> -Stage awaiting-pbis`.

## 8. Close-out (stage `pbis-done`)

Every PBI of the Feature is in the `Completed` or `Removed` category.

1. Close the Feature only if it is assigned to you and every child is complete. Otherwise leave it as it is.
2. Post the `feature-summary` comment on the Feature, listing each PBI with its PR.
3. Run `asdf.ts stage -Id <feature id> -Stage done`.

The Feature writes no memory entry of its own; each PBI's entry names its Feature.

## 9. A reopened breakdown

Someone moved the Breakdown task out of `Completed`, so the Feature is back at `answers-received` with `lastReason` `breakdown reopened`.

- **PBIs that have started aren't touched.** Each has its own approved HLD, and changing one goes through that HLD.
- **PBIs that haven't started** stay as they are until the revised breakdown is approved.
- **Revise and ask again:** read the new comments (section 4), revise `breakdown.md`, and request approval (section 6). Fill in the approval request's line for a revised breakdown: the started PBIs whose scope this version changes, so their HLDs can be reopened, and the PBIs it drops, for a person to remove. ASDF never removes a PBI.
- **After approval,** section 7 runs for new PBIs, and for PBIs that haven't started.

## 10. Making a PBI into a Feature

`intake` (in a live session) and `asdf:brainstorming` (on an answer to the size question) call this once the person has agreed.

1. **The Feature.**
   - If the PBI is already under a Feature (a parent whose type is in `workItemTypes.feature`), check that Feature's assignment before changing it.
   - If that Feature is assigned to someone else, ASDF can't break it down. Say so: in a live session, tell the person; unattended, post the `blocker` comment on the PBI asking for the Feature to be assigned to you, and run `asdf.ts stage -Id <pbi id> -Stage blocked -Reason "Feature <feature id> is someone else's"`. Then stop.
   - Otherwise create a Feature with the PBI's title and description, and put the PBI under it (`asdf:ado-work-items`, "Creating a Feature"). If no tool can link existing work items, ask the person to put the PBI under the Feature, and stop.
   - Bootstrap its local folder with `item-new` if needed, then acquire the Feature's own operation lock before changing an existing Feature or writing its context; the PBI's lock is not sufficient. Move an existing Feature to In Progress only after confirming it is yours. If the lock is unavailable, defer the handoff without parking the PBI.
2. **Record the decision:** post the `feature-split` comment on the PBI.
3. **Park the PBI.** Move it to the first `Proposed` state, so nothing works on it as one piece. Write `{"size":"phase","ado":{"parentId":<feature id>}}` with `item-set`, and run `asdf.ts stage -Id <pbi id> -Stage tracked`. It starts again once the breakdown is approved (section 7).
4. **Track the Feature:** `asdf.ts item-new -Org <org> -Project <project> -Id <feature id> -Kind feature -Type "<type>" -Title "<title>"`, and write its `item.md` snapshot as `intake` does.
   - In a live session, run `asdf.ts stage -Id <feature id> -Stage new` and carry on with section 1 on the Feature, asking its questions with `ask_user`.
   - Unattended, stop here. The next `do-next` pass picks the Feature up.

## Never

- Never give a Feature an HLD, a Review task, implementation tasks or a PR.
- Never create a Feature without the person's OK, or a PBI the approved breakdown doesn't list.
- Never start a PBI that waits for another.
- Never edit or remove a PBI that has started or is assigned to someone else.
- Never call `ask_user` in a `do-next` pass.
