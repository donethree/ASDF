import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { checkConfig, validateContextPath } from './settings.ts';
import { parseOrganization, parseProject, parseWatchSource, prepareRepository, sameSource } from './setupInputs.ts';
import { addMcpEntry, findMcpMatches, loadSetup, prepareSetupSave, saveSetup, selectContext, sameSetupPath, type LoadedSetup, type SetupPaths, type SetupWritePlan } from './setupState.ts';
import { EXAMPLES, SetupBack, SetupCancelled, type SetupIO } from './setupPrompt.ts';
import { configRecord, configText, type OrgConfig, type ProjectIdentity, type ProjectConfig, type WatchSource } from './watchScopes.ts';
import { AsdfError, fail, same } from './util.ts';
import { normalizeWorktreeRoot, type Workspace } from './workspaces.ts';

export type SetupResult = { status: 'saved' | 'cancelled'; paths: string[] };

export async function runSetup(io: SetupIO, paths?: SetupPaths): Promise<SetupResult> {
  let loaded: LoadedSetup;
  try {
    if (process.env.ASDF_WORKER_REQUEST) fail('ASDF_SETUP_MANUAL_ONLY', 'run node asdf.js --init manually in a separate terminal');
    loaded = loadSetup(paths);
  } catch (error) { io.close?.(); throw error; }
  const config = () => loaded.draft.config;
  const line = async (prompt: string, fallback?: string) => {
    io.write(`\n${prompt}${fallback !== undefined ? ` [${fallback}]` : ''}\n> `);
    const answer = await io.readLine();
    if (answer === null || answer.trim() === ':cancel') throw new SetupCancelled();
    if (answer.trim() === ':back') throw new SetupBack();
    return answer.trim() || fallback || '';
  };
  const validated = async <T>(prompt: string, parse: (input: string) => T, fallback?: string): Promise<T> => {
    for (;;) {
      try { return parse(await line(prompt, fallback)); }
      catch (error) {
        if (!(error instanceof AsdfError)) throw error;
        io.write(`Error: ${error.message}\n`);
      }
    }
  };
  const yes = (prompt: string, defaultYes = false) => validated(`${prompt} (${defaultYes ? 'Y/n' : 'y/N'})`, input => {
    if (/^(y|yes)$/i.test(input)) return true;
    if (/^(n|no)$/i.test(input)) return false;
    fail('ASDF_SETUP_INPUT_INVALID', 'enter y or n');
  }, defaultYes ? 'y' : 'n');
  const number = (prompt: string, max: number) => validated(prompt, input => {
    if (!/^\d+$/.test(input) || Number(input) > max) fail('ASDF_SETUP_INPUT_INVALID', `choose a number from 0 to ${max}`);
    return Number(input);
  });
  const select = async (labels: string[]) => {
    io.write(labels.map((label, i) => `  ${i + 1}. ${label}`).join('\n') + '\n');
    return (await number('Select an entry (0 = back)', labels.length)) - 1;
  };
  const plain = (value: string) => configText(value, 'entry');
  const context = async () => {
    for (;;) {
      const input = await line('Context folder: designs, plans, questions, sessions and logs.\nExample: C:\\asdf-context (outside every Git repository).\nEnter the full folder path:', loaded.draft.contextPath || undefined);
      try {
        const path = validateContextPath(input);
        const changed = !loaded.draft.contextPath || !sameSetupPath(path, loaded.draft.contextPath);
        if (changed && existsSync(join(path, 'asdf.config.json'))) {
          if (!await yes('This folder already has an ASDF config. Load it for editing?')) continue;
        }
        if (loaded.originalContext && !sameSetupPath(path, loaded.originalContext)) io.write('Existing item history is not moved. Unfinished work prevents switching contexts.\n');
        loaded = selectContext(loaded, path);
        return;
      } catch (error) {
        if (!(error instanceof AsdfError)) throw error;
        io.write(`Error: ${error.message}\n`);
      }
    }
  };
  const ensureOrg = async (org: string): Promise<OrgConfig> => {
    const existing = config().orgs.find(o => same(o.org, org));
    if (existing) return existing;
    if (!await yes(`The URL identifies organization "${org}". Add it?`)) throw new SetupBack();
    const entry = { org, mcpServer: '', projects: [] };
    config().orgs.push(entry);
    return entry;
  };
  const ensureProject = async (identity: ProjectIdentity): Promise<ProjectConfig> => {
    const org = await ensureOrg(identity.org);
    let project = org.projects.find(p => same(p.project, identity.project));
    if (!project) {
      if (!await yes(`The URL identifies project "${identity.org}/${identity.project}". Add it?`)) throw new SetupBack();
      project = { project: identity.project, watchScopes: [] };
      org.projects.push(project);
    }
    return project;
  };
  const projects = () => config().orgs.flatMap(org => org.projects.map(project => ({ org, project })));
  const watches = (): WatchSource[] => config().orgs.flatMap(o => o.projects.flatMap(p =>
    p.watchScopes.map(scope => ({ org: o.org, project: p.project, scope }))));
  const watchLabel = (s: WatchSource) => `${s.org}/${s.project}: ${s.scope.kind === 'team' ? `team ${s.scope.team} (all supported types)` : `project ${s.scope.areaPaths.length ? s.scope.areaPaths.join('; ') : '(all areas)'}`}`;
  const collection = async (title: string, noun: string, labels: () => string[], add: () => Promise<void>,
    edit: (index: number) => Promise<void>, remove: (index: number) => void) => {
    for (;;) {
      io.write(`\n${title}\n${labels().map((s, i) => `  ${i + 1}. ${s}`).join('\n') || '  No entries yet'}\n`);
      const choice = await number('1) Add\n2) Edit\n3) Remove\n4) Continue\n0) Cancel setup', 4);
      if (choice === 0) throw new SetupCancelled();
      if (choice === 4) return;
      let before = structuredClone(loaded.draft);
      try {
        if (choice === 1) {
          for (;;) {
            await add();
            before = structuredClone(loaded.draft);
            if (!await yes(`Add another ${noun}?`)) return;
          }
        } else {
          if (!labels().length) { io.write('Add an entry first.\n'); continue; }
          const index = await select(labels());
          if (index < 0) continue;
          if (choice === 2) await edit(index);
          else if (await yes(`Remove "${labels()[index]}" from configuration only?`)) remove(index);
        }
      } catch (error) {
        loaded.draft = before;
        if (error instanceof SetupBack) { io.write('Returned without changing that entry.\n'); continue; }
        if (!(error instanceof AsdfError)) throw error;
        io.write(`Error: ${error.message}\n`);
      }
    }
  };
  const organizations = async () => {
    const enter = () => validated(EXAMPLES.organization, parseOrganization);
    await collection('Organizations', 'organization', () => config().orgs.map(o => o.org),
      async () => {
        const { org } = await enter();
        if (config().orgs.some(o => same(o.org, org))) fail('ASDF_SETUP_DUPLICATE', 'organization already exists; use Edit');
        config().orgs.push({ org, mcpServer: '', projects: [] });
        io.write(`Added organization ${org}.\n`);
      },
      async index => {
        const old = config().orgs[index];
        if (old.projects.length || config().workspaces.some(w => same(w.org, old.org))) fail('ASDF_SETUP_IN_USE', 'edit/remove this organization\'s projects and repositories before renaming it; MCP selection has its own step');
        const { org } = await enter();
        if (config().orgs.some((o, i) => i !== index && same(o.org, org))) fail('ASDF_SETUP_DUPLICATE', 'organization already exists');
        config().orgs[index] = { org, mcpServer: '', projects: [] };
      },
      index => {
        const org = config().orgs[index];
        if (config().workspaces.some(w => same(w.org, org.org))) fail('ASDF_SETUP_IN_USE', 'remove its repository registrations first');
        config().orgs.splice(index, 1);
      });
  };
  const projectSection = async () => {
    const enter = () => validated(EXAMPLES.project, value => parseProject(value, config().orgs.length === 1 ? config().orgs[0].org : undefined));
    const add = async () => {
      const identity = await enter();
      const org = await ensureOrg(identity.org);
      if (org.projects.some(p => same(p.project, identity.project))) fail('ASDF_SETUP_DUPLICATE', 'project already registered');
      org.projects.push({ project: identity.project, watchScopes: [] });
      io.write(`Registered ${identity.org}/${identity.project}; this does not start a project-wide watch.\n`);
    };
    const remove = (index: number) => {
      const { org, project } = projects()[index];
      if (config().workspaces.some(w => same(w.org, org.org) && same(w.project, project.project))) fail('ASDF_SETUP_IN_USE', 'remove its repository registrations first');
      org.projects.splice(org.projects.indexOf(project), 1);
    };
    await collection('Projects (connections; choose watches separately)', 'project', () => projects().map(p => `${p.org.org}/${p.project.project} (${p.project.watchScopes.length} watches)`),
      add, async i => {
        const old = projects()[i];
        if (old.project.watchScopes.length) fail('ASDF_SETUP_IN_USE', 'edit its watch sources first; a project with watches cannot be renamed implicitly');
        remove(i);
        await add();
      }, remove);
  };
  const repositories = async () => {
    const enter = async (existing?: Workspace) => {
      const savedUrl = existing ? `https://dev.azure.com/${encodeURIComponent(existing.org)}/${encodeURIComponent(existing.project)}/_git/${encodeURIComponent(existing.repo)}` : undefined;
      const raw = await line(EXAMPLES.repository, savedUrl);
      let workspace;
      try { workspace = prepareRepository(raw); }
      catch (error) {
        if (!(error instanceof AsdfError) || error.code !== 'ASDF_SETUP_CHECKOUT_REQUIRED') throw error;
        workspace = await validated(EXAMPLES.checkout, path => prepareRepository(raw, path), existing?.path);
      }
      await ensureProject(workspace);
      io.write(`Resolved ${workspace.org}/${workspace.project}/${workspace.repo}\nLocal checkout: ${workspace.path}\n`);
      return workspace;
    };
    const put = async (index?: number) => {
      const workspace = await enter(index === undefined ? undefined : config().workspaces[index]);
      if (config().workspaces.some((w, i) => i !== index && same(w.org, workspace.org) && same(w.project, workspace.project) && same(w.repo, workspace.repo))) fail('ASDF_SETUP_DUPLICATE', 'that repository is already registered');
      if (index === undefined) config().workspaces.push(workspace);
      else config().workspaces[index] = workspace;
    };
    await collection('Code repositories', 'repository', () => config().workspaces.map(w => `${w.org}/${w.project}/${w.repo} - ${w.path}`),
      () => put(), put, i => { config().workspaces.splice(i, 1); });
  };
  const watchSection = async () => {
    const remove = (source: WatchSource) => {
      const project = config().orgs.find(o => same(o.org, source.org))!.projects.find(p => same(p.project, source.project))!;
      project.watchScopes = project.watchScopes.filter(scope => !sameSource({ ...source, scope }, source));
    };
    const add = async () => {
      const source = await validated(EXAMPLES.backlog, value => parseWatchSource(value, config().orgs.length === 1 ? config().orgs[0].org : undefined));
      const project = await ensureProject(source);
      if (source.scope.kind === 'project' && await yes('Restrict this project to specific Area Paths?')) {
        for (;;) {
          const path = await validated(`Area Path example: ${source.project}\\Payments\nEnter one exact path; this is not a repo or team name.`, plain);
          if (source.scope.areaPaths.some(p => same(p, path))) fail('ASDF_SETUP_DUPLICATE', 'area path already added');
          source.scope.areaPaths.push(path);
          if (!await yes('Add another area path?')) break;
        }
      }
      if (watches().some(s => sameSource(s, source))) fail('ASDF_SETUP_DUPLICATE', 'this watch already exists, regardless of browser level/display settings');
      const whole = project.watchScopes.some(s => s.kind === 'project' && s.areaPaths.length === 0);
      if (whole || (source.scope.kind === 'project' && source.scope.areaPaths.length === 0 && project.watchScopes.length)) {
        if (!await yes('A whole-project watch overlaps these scopes. Replace the current scopes with this selection?')) throw new SetupBack();
        project.watchScopes = [];
      }
      project.watchScopes.push(source.scope);
      io.write(`Added ${watchLabel(source)}. Only supported work assigned to you is discovered.\n`);
    };
    await collection('Backlogs and project watches', 'backlog/watch source', () => watches().map(watchLabel),
      add, async i => { remove(watches()[i]); await add(); }, i => remove(watches()[i]));
  };
  const types = async () => {
    const groups = ['feature', 'parent', 'task'] as const;
    for (;;) {
      io.write(`\nWork item types (exact ADO names; not checked online)\n${groups.map((g, i) => `${i + 1}) ${g}: ${config().workItemTypes[g].join(', ') || '(disabled)'}`).join('\n')}\n`);
      const choice = await number('Choose a group to edit, 4) Continue, 0) Cancel', 4);
      if (choice === 0) throw new SetupCancelled();
      if (choice === 4) return;
      const group = groups[choice - 1];
      for (;;) {
        const action = await number(`${group}: ${config().workItemTypes[group].join(', ') || '(empty)'}\n1) Add type\n2) Remove type\n3) Back\n0) Cancel`, 3);
        if (action === 0) throw new SetupCancelled();
        if (action === 3) break;
        if (action === 1) {
          const value = await validated('Example type: Feature, Product Backlog Item, User Story, Task or Bug.\nEnter ONE type name, including spaces:', plain);
          if (Object.values(config().workItemTypes).flat().some(v => same(v, value))) { io.write('That type already belongs to a list.\n'); continue; }
          config().workItemTypes[group].push(value);
        } else {
          const index = await select(config().workItemTypes[group]);
          if (index >= 0 && await yes('Remove this type? An empty Feature list disables Feature discovery.')) config().workItemTypes[group].splice(index, 1);
        }
      }
    }
  };
  const username = async () => {
    config().userName = await validated('Branch user name; example jdoe gives user/jdoe/12345-add-export.\nThe ASDF guard blocks pushes outside that prefix in enabled sessions.', value => {
      const error = checkConfig({ ...config(), userName: value }).find(e => e.startsWith('userName'));
      if (error) fail('ASDF_SETUP_INPUT_INVALID', error);
      return value;
    }, config().userName);
  };
  const mcp = async () => {
    io.write('\nMCP entries are configured locally only. No server, login or connectivity check will run.\n');
    for (const org of config().orgs) {
      const matches = findMcpMatches(loaded.draft.mcp, org.org);
      let name: string;
      if (!matches.length) {
        name = await validated(`MCP server entry name for ${org.org}:`, plain, `ado-${org.org}`);
        io.write(`Proposed entry: ${name}\n${JSON.stringify({ type: 'http', url: `https://mcp.dev.azure.com/${encodeURIComponent(org.org)}`, headers: { 'X-MCP-Insiders': 'true' }, tools: ['*'] }, null, 2)}\n`);
        if (!await yes('Add this local MCP entry when you save?')) { io.write('Entry not added; return to MCP setup before Save.\n'); continue; }
      } else if (matches.length === 1) {
        name = matches[0];
        io.write(`Using existing ${name} for ${org.org}.\n`);
      } else {
        io.write(`Choose the existing MCP server for ${org.org}:\n`);
        const index = await select(matches);
        if (index < 0) continue;
        name = matches[index];
      }
      const servers = configRecord(loaded.draft.mcp.mcpServers, 'mcpServers');
      if (Object.hasOwn(servers, name)) {
        const server = configRecord(servers[name], name);
        if (typeof server.url === 'string') {
          const headers = configRecord(server.headers ?? {}, 'headers');
          const key = Object.keys(headers).find(k => k.toLowerCase() === 'x-mcp-insiders');
          if ((!key || headers[key] !== 'true') && !await yes(`Set X-MCP-Insiders: true on ${name} at Save? Other headers will be preserved.`)) continue;
        }
      }
      addMcpEntry(loaded.draft, org.org, name);
    }
  };
  const worktrees = async () => {
    config().worktreeRoot = await validated(
      'Short worktree parent folder, separate from the context/artifact folder.\nExample: Q:\\w gives Q:\\w\\a1b2c3 (11 characters).\nEnter the parent folder for new worktrees. Full worktree paths must be at most 13 characters (fewer than 14).\nExisting recorded worktrees are not moved. Directory/tool permissions are not granted by setup.',
      value => validateContextPath(normalizeWorktreeRoot(value)), config().worktreeRoot);
  };
  const sections = [context, organizations, projectSection, repositories, watchSection, types, username, mcp, worktrees];
  const section = async (index: number) => {
    try { await sections[index](); }
    catch (error) {
      if (error instanceof SetupBack) return;
      if (!(error instanceof AsdfError)) throw error;
      io.write(`Error: ${error.message}\nReturn to this section to correct it before saving.\n`);
    }
  };
  try {
    io.write('ASDF guided local setup\nNo model, ADO call or login is used. Examples are not saved defaults.\nType :back to return, :cancel or Ctrl+C to cancel. Nothing is written before Save.\n');
    for (const warning of loaded.pluginWarnings) io.write(`Warning: ${warning}\n`);
    await section(0);
    await section(8);
    for (let i = 1; i < 8; i++) await section(i);
    for (;;) {
      let preview: SetupWritePlan | undefined;
      try {
        if (!config().worktreeRoot) fail('ASDF_WORKTREE_ROOT_REQUIRED', 'choose a short worktree parent folder before saving');
        preview = prepareSetupSave(loaded);
        loaded = preview.loaded;
      } catch (error) {
        if (!(error instanceof AsdfError)) throw error;
        io.write(`Draft is not ready to save: ${error.message}\n`);
      }
      io.write(`\nReview draft\nContext: ${loaded.draft.contextPath || '(required)'}\nWorktree parent: ${config().worktreeRoot || '(required)'}\nUser: ${config().userName}\n`);
      for (const org of config().orgs) {
        io.write(`Organization: ${org.org}; MCP: ${org.mcpServer || '(not selected)'}\n`);
        for (const project of org.projects) io.write(`  Project: ${project.project}; watches: ${project.watchScopes.length}\n`);
      }
      for (const workspace of config().workspaces) io.write(`Repository: ${workspace.org}/${workspace.project}/${workspace.repo} - ${workspace.path}\n`);
      for (const watch of watches()) io.write(`Watch: ${watchLabel(watch)}\n`);
      io.write(`Types: ${JSON.stringify(config().workItemTypes)}\nFiles: ${loaded.paths.settingsFile}; ${join(loaded.draft.contextPath, 'asdf.config.json')}; ${loaded.paths.mcpFile}\n`);
      const choice = await number('1) Save configuration\n2) Context\n3) Organizations\n4) Projects\n5) Repositories\n6) Backlogs/watches\n7) Types\n8) Branch user name\n9) MCP entries\n10) Worktree parent\n0) Cancel setup', 10);
      if (choice === 0) throw new SetupCancelled();
      if (choice !== 1) { await section(choice - 2); continue; }
      if (!preview) { io.write('Correct the draft before saving.\n'); continue; }
      try {
        const result = saveSetup(preview);
        io.write(`\nConfiguration saved.\n${result.written.join('\n') || 'No file changes were needed.'}\nADO was not contacted. Use normal ASDF intake/do-next; failures will identify configuration or MCP access to check.\n`);
        if (result.written.includes(loaded.paths.mcpFile)) io.write('An already-running Copilot session may need its usual MCP reload to see this local change.\n');
        io.write('See the README hourly automation section for scheduling.\n');
        return { status: 'saved', paths: result.written };
      } catch (error) {
        if (!(error instanceof AsdfError)) throw error;
        if (['ASDF_SETUP_CONFLICT', 'ASDF_SETUP_SAVE_FAILED'].includes(error.code)) throw error;
        io.write(`Cannot save: ${error.message}\nCorrect the draft using the menu; existing configuration is unchanged.\n`);
      }
    }
  } catch (error) {
    if (!(error instanceof SetupCancelled)) throw error;
    io.write('\nSetup cancelled. No configuration was saved.\n');
    return { status: 'cancelled', paths: [] };
  } finally { io.close?.(); }
}
