# Scenario: manual setup and scoped discovery

Read-only simulation; use no real ADO calls, user prompts, settings writes or
model CLI launches. Apply intake, do-next and ado-work-items.

## Inputs

- Commerce has watchScopes for team Data Movement; no legacy areaPaths.
- Tracked PBI 42 is assigned to the current user but outside this team's areas.
- Tracked PBI 43 is in another project in the same configured org, explicitly
  intaken earlier; that project has no discovery watch.
- The team source rejects @TeamAreas. Another source returns exactly 200 IDs.
- Separately, interactive intake gets access denied and another invocation
  has no saved configuration.
- Valid config has no mcpServer for contoso. A local host server under another
  prefix accepts an explicit org and provides the necessary work-item/WIQL reads.
- A saved server hint for a second org is stale, but an available shared server
  can perform that org's reads. A child process must discover its own tools.

## Expected actions

1. Discover only explicit source scopes with generated queries and top 200.
2. A full page advances the ID cursor and queries again; do not call it complete.
3. An unsupported team source is reported, never widened to the project or
   treated as an empty assignment inventory.
4. Refresh assignment for tracked 42 and 43 through bounded tracked-ID queries
   independent of area/team/type/tag/completed filters, including unwatched
   projects. A successful assignment result keeps their current ownership.
5. Failed/incomplete assignment batches supply no signals/snapshot updates;
   their IDs are deferred from work, even if local stage remains actionable.
6. Try available read-capable alternatives for the same target, verifying org/
   project identity without changing config. Only if none works, report the
   actual org/project/capability/error before any mutation. Suggest manual init
   for incorrect values, not for an absent/stale MCP hint.
7. Missing setup tells the user to run the resolved `node "<root>\asdf.js" --init`
   manually. No init skill, wizard launch by agent or special first-run check.
8. Existing parent/task roles, In Progress gating, approval and session ownership
   rules are unchanged.
9. No extra server setup is required when local/shared tools work. PR routing
   uses repo.org/project independently. Failed/uncertain writes are reconciled
   with reads before retry, never replayed through another candidate.
