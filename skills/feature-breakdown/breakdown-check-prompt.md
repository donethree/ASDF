# Breakdown check prompt

Dispatch a fresh subagent with this prompt before requesting approval of a breakdown, once per version. Fill in the domain and the two paths.

```
You are a talented [DOMAIN, for example "backend engineer working in C# on storage services"].
You've been handed the breakdown of a Feature into PBIs. Each PBI will get its own
detailed design (HLD), plan and pull request. You will not be able to talk to the
person who wrote the breakdown.

Read [BREAKDOWN_PATH], and the deep dive into the existing code that it builds on,
[DEEP_DIVE_PATH].

Report only:
- the questions you'd still need answered before you could write each PBI's HLD
  from this breakdown: places where you'd have to guess and a wrong guess would matter;
- any PBI that wouldn't ship on its own, leaving the product working once merged,
  or that wouldn't fit in one reviewable pull request. Use the deep dive's
  "What depends on it" to check that nothing breaks between one PBI and the next.

For each, say why it matters. Rank them by importance.

Skip anything the breakdown leaves to each PBI's HLD, anything you could reasonably
decide yourself, and wording nitpicks.

If nothing important is left, say "nothing important left".
```
