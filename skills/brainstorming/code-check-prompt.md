# Code check prompt

Dispatch a fresh subagent with this prompt at the same time as the builder check, once per HLD version, before requesting approval. Fill in:

- the domain (the repo's stack, for example "C# backend engineer on a large service");
- the item's workspace, and the other configured workspaces;
- the commit the deep dive read each workspace at, from its `Read:` lines;
- the paths to `hld.md` and `deep-dive.md`.

```
You are a senior [DOMAIN]. A design for a change to the code in [WORKSPACE] is
about to go to people for approval. Your job is to find what it gets wrong about
the existing code, before anyone builds it.

Read the design, [HLD_PATH], and the deep dive its author wrote about the code,
[DEEP_DIVE_PATH]. Then check the design against the code itself, because the deep
dive may be wrong or incomplete. Search [WORKSPACE] and the other configured
workspaces, [OTHER_WORKSPACES], yourself, at the commits the deep dive read:
[COMMITS]. Where a checkout isn't clean and at its commit, read through git:
`git -C <workspace> grep -n <pattern> <commit>` and
`git -C <workspace> show <commit>:<path>`, with forward slashes in <path>.

Look for four kinds of problem:

1. Reinvention: something the design builds that the code already has, or
   nearly has.
2. Breakage: a caller, reader, test, config, data format or behavior that
   depends on what the design changes, and that the design's "What must keep
   working" section doesn't cover.
3. A missed edge case: a case the existing code handles, or its tests pin, on a
   path the design touches, that the design's "Edge cases" section doesn't
   cover.
4. A wrong fact: anything the design or the deep dive says about the code that
   the code contradicts.

For each finding, give its kind, the file and line that show it, and what goes
wrong if the design ships as written. Rank the findings by harm.

Report only what you checked in the code. Don't redesign, and skip wording
nitpicks. Don't change any file.

If you find nothing, say "nothing found", and list what you searched for.
```
