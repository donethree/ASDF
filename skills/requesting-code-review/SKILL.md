---
name: requesting-code-review
description: Use when an ASDF item's implementation is complete, before opening the PR - runs the self-review (ASDF reviewer plus every repo review skill) and fixes findings
---

# Requesting Code Review (the Review task)

The Review task is ASDF's own review of its work, before anyone else sees a PR. A standalone Task can have no separate Review task. Reviewers receive the review package and the item's requirements, never your session's history.

**Core principle:** Find it before the reviewers do. Fix what's real, give a reason for what you decline, and keep it simple.

## 1. Start

- Reuse the operation owner from `asdf:using-asdf`. The item is in stage `self-review`.
- Refresh and save its execution context. Give the packet to every reviewer, including repo-provided skills/agents; require explicit codeRoot cwd, applicable target-repo instructions, read-only code and item-local reports.
- If `ado.reviewId` is set and still assigned to you, move that Review task to `InProgress`. Otherwise keep the report local for the PR; never invent an id or overwrite the governing Task's description.
- Build the whole-branch package in the worktree:

  1. `git -C "<worktree>" merge-base "origin/<default branch>" HEAD` prints the base commit.
  2. `asdf.ts review-package -Id <id> -Owner <operation owner> -RepoPath "<worktree>" -Base <base commit> -Head HEAD`

## 2. Reviewers

Run every review skill the repo provides. ASDF's own reviewer runs too, and each is a separate subagent with the same package.

1. **The ASDF reviewer.** Dispatch a subagent with [code-reviewer.md](./code-reviewer.md), filled with:
   - the package path, `[EXECUTION_CONTEXT_FILE]`, worktree path, base commit and HEAD,
   - requirements: the approved `hld.v<N>.md` for a PBI; `item.md` for a standalone Task, plus the approved HLD as constraints when it has one,
   - `plan.md` when it exists (small Tasks have no plan),
   - the `P<n>` rows from `decisions.md`, or none,
   - `deep-dive.md`, if the item folder has one.

   Fill `[DESCRIPTION]` with this item's change, `[PLAN_OR_REQUIREMENTS]` with those actual inputs and its scope, and `[BASE_SHA]`/`[HEAD_SHA]` with the package refs. Do not send paths to nonexistent artifacts. Without an HLD, new dependencies are not approved.
2. **The repo's reviewers.** Run `asdf.ts repo-skills -RepoPath "<worktree>" -Kind review`. For each result, dispatch its own subagent:
   - **a skill:** "Use the `<name>` skill to review the change in `<package path>`; report findings as Critical / Important / Minor with file and line";
   - **an agent:** dispatch that agent with the same request.

Check for over-engineering and bloat, not just bugs. The ASDF reviewer's rubric covers it: the smallest change that delivers the HLD, readable and not verbose, no abstraction nobody asked for, and no dependency the HLD didn't list.

The ASDF reviewer checks that everything that worked before still works, including callers and readers the HLD doesn't list. It searches the worktree for every caller and reader of what the change modifies, and checks the change against the HLD's What must keep working and Edge cases sections.

If subagents can't be dispatched in this session (the `asdf:executing-plans` fallback), run each review yourself, one after another, and say so in the local report and PR summary (also on the Review task when present).

## 3. Act on the findings

- **Sort first.** Grade each finding by what a person using the software would get, not by its label.
- **Fix** every Critical and Important finding through implementer subagents (`asdf:subagent-driven-development`'s prompts), with TDD: a failing test first. If subagents are unavailable, make the fixes inline under the same TDD gate. Then run a scoped re-review on the fix range (`review-package` from the fix base).
- **Decline with a reason.** A finding you won't fix is a decision: record it as a `P<n>` row in `decisions.md`, with the reason.
- **Unlisted dependency.** A finding that the change needs a dependency the HLD didn't list is a blocker. Post the `blocker` comment, then run `asdf.ts stage -Id <id> -Stage blocked -Reason "<short reason>"`.
- Minor findings go in the report. They don't block.

## 4. Record and hand off

- **Reports:** write each reviewer's findings to `<item>\reviews\<reviewer>.md`.
- **The summary** goes in the local report and PR description. If a Review task exists and is still assigned to you, its description also gets:
  - the reviews that ran,
  - findings fixed,
  - findings declined, with reasons.
- **Hand off:** run `asdf:finishing-a-development-branch` with the same operation owner to open the PR. That skill completes an existing Review task only while it is still assigned to you.

## Common rationalizations

| Excuse | Reality |
|---|---|
| "I'll review the diff myself" | Same author, same blind spots. Dispatch fresh reviewers. |
| "The repo's review skills are optional" | They encode the team's rules. Run every one. |
| "It works, so the extra layer is fine" | Bloat is a finding. Smallest change that delivers the HLD. |
| "This finding is wrong, I'll drop it" | Decline with a reason, as a P-row. Silent drops are decisions made in secret. |
