# Scenario: brainstorming, answers arrive during an unattended run

## Setup

- `do-next` pass, unattended. Item 12345 "Add CSV export" is in stage `answers-received`.
- `hld.version` is 0, `hld.roundPostedAt` is 2026-10-20T10:00:00Z, and `maxQuestionsPerRound` is 4.
- Round 1 in `questions.md` asked:
  - Q1: stream to disk (A, recommended) or build in memory (B)?
  - Q2: put Export in the existing toolbar menu (A, recommended), or add a new button (B)?
- Comments on the HLD task newer than `roundPostedAt`:
  1. 2026-10-20T11:00:00Z, Jane Doe: `Q1 B`
  2. 2026-10-20T11:05:00Z, ASDF (posted as Jane): `[ASDF] reminder: 2 questions open`
- The item folder has `hld.md`, `questions.md` and `decisions.md`, but no `deep-dive.md`: its design started before deep dives. The workspace's code isn't available in this dry run, so where the skill says to read code, the agent says what it would read.

## Prompt

"Dry run: you're in an unattended do-next pass and this item is in answers-received. Using the brainstorming skill (and ado-work-items for conventions), describe exactly what you'd do, in order: the files you'd write (with their content), the comments you'd post (with their text), and the CLI commands. Don't execute anything."

## Expected

1. Q1 is recorded as answer B, decided by Jane Doe (ADO comment), in both `questions.md` and `decisions.md`.
2. Q2 stays open: it's not assumed, and it's asked again in a round 2 `question-round` comment starting `[ASDF] Round 2`.
3. The `[ASDF] reminder` comment is ignored. It's not treated as an answer.
4. No approval request, no attachment upload, and no builder check yet, because a question is still open.
5. Round 2 has at most 4 questions.
6. `hld.roundPostedAt` is updated through `item-set`, then `stage awaiting-answers`. There's no `ask_user`.
7. Before revising `hld.md`, it writes `deep-dive.md`, since the item has none yet.

## Result (filled in by the person running the scenario)

- 2026-10-21, run 2, with the deep dive (fresh read-only agent): **all 7 lines passed.**
  - It recorded Q1 B from Jane Doe, re-asked Q2 alone in round 2, and ignored the reminder.
  - It wrote the missing `deep-dive.md` before revising `hld.md`, reading through git with a `Read:` line per workspace.
  - There was no check, no approval request and no `ask_user`.

- 2026-10-20, run 1 (fresh read-only agent): **all 6 lines passed.**
  - Q1 was recorded as B by Jane Doe (ADO comment); Q2 was re-asked alone in round 2; the reminder was ignored.
  - No approval request, upload or builder check; `roundPostedAt` was updated, then `awaiting-answers`; no `ask_user`.
  - Harmless extra: it re-ran `signals` before revising.
