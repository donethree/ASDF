# Scenario: brainstorming, the deep dive into existing code

## Setup

- `do-next` pass, unattended. Org `contoso`, MCP server `ado-contoso`, project `Commerce`. `maxQuestionsPerRound` is 4.
- The fixture `tests\scenarios\fixtures\orders-export` holds two workspaces, `Orders` and `Reports`. Copy only those two folders outside the repo for the run. The agent must never see this file, or the fixture's `item-5100-v1` folder, which holds a draft HLD for the same PBI.
- `asdf.ts config` lists both workspaces, in `contoso/Commerce`:
  - `<copy>\Orders`, repo `Orders`;
  - `<copy>\Reports`, repo `Reports`.
  - Both are clean checkouts, level with `origin/main` at commit `4f2a9c1`. They have no git history to read.
- PBI 5100, "Show the currency in the order export", is assigned to you and In Progress, at stage `new`.
  - Its HLD task 5101 and Review task 5102 exist (`ado.hldId` 5101, `hldOwned` true).
  - Its `size` is `one`. `repo.name` is `Orders`, and `repo.clonePath` is the Orders workspace.
  - No round has been posted. The memory index for `orders` is empty.
  - Its description: "Customers outside the US see order totals in the export without a currency, so they can't tell 12.50 EUR from 12.50 USD. Add the currency to the order export: the download and the nightly file. Also, the nightly upload times out a few times a month and the day's file goes missing: retry it."

## Prompt

"Dry run: you're in an unattended do-next pass, and PBI 5100 is at stage `new`. Using the brainstorming skill (and ado-work-items for conventions), do what the skill says, up to posting the first question round (or requesting approval, if nothing is open). You may read the workspaces' code, read-only. Show every file you'd write in the item folder with its full content, the comment you'd post, and the CLI commands. Don't run CLI or ADO calls, and don't write files."

## Expected

1. `deep-dive.md` is written before `hld.md`. It covers how the code works today, what can be reused, what depends on what will change, and the edge cases. Every statement about existing code cites a file and line, and the deep dive records the commit it read.
2. The upload retry reuses `Retry.WithBackoffAsync` (Orders `src/Common/Resilience/Retry.cs`), which already retries only transient failures. No new retry loop, and no new dependency.
3. The search for consumers reaches the Reports workspace. It finds `OrderCsvImport` (Reports `src/Imports/OrderCsvImport.cs`), which rejects any header other than `OrderId,Date,Customer,Total`. The HLD lists it under what must keep working, with the download endpoint and the nightly job.
4. Breaking Reports' import isn't ASDF's call. The round asks a person how to keep it working (for example, Reports accepts the new column first, or the nightly file keeps its format). It isn't recorded as an `ASDF assumption`.
5. Orders whose `Currency` is null (placed before stores sold in more than one currency, `src/Domain/Order.cs`) get their store's `DefaultCurrency`, through `IStoreDirectory`. It's settled from the code, not asked. The HLD lists it as an edge case, and the empty day, quoted names and invariant-culture totals keep working.
6. The HLD has a section for each of: what it reuses, what must keep working, and the edge cases.
7. The rest of the flow is unchanged: one `question-round` comment on HLD task 5101, then `hld.roundPostedAt` through `item-set`, and `stage -Stage awaiting-answers`. No `ask_user`.

## Result (filled in by the person running the scenario)

- 2026-10-21, run 1, baseline before the deep dive existed (fresh read-only agent): **5 of 7 lines passed.**
  - It read 16 of the 18 files in the two workspaces.
  - It reused `Retry.WithBackoffAsync`, found Reports' strict header check, and asked a person about it (Q1: a new versioned file, recommended, or change Reports first).
  - It settled the null currency from the code (store default through the cached store directory).
  - Line 1 failed: there was no `deep-dive.md`, so the evidence lived only in an HLD section, "Current behavior and evidence".
  - Line 6 failed: there were no sections for reuse, what must keep working and edge cases; that content was spread across goals and "Verification expected".
  - The flow was unchanged (line 7).
- 2026-10-21, run 2, with the deep dive (fresh read-only agent): **6 of 7 lines passed.**
  - It wrote `deep-dive.md` first, with citations and the commit.
  - It found the retry helper, the store default and Reports' header check, and asked about Reports.
  - It found an extra edge case: Reports reads physical lines while the exporter can quote line breaks.
  - Line 6 failed: reuse was folded into the design and D3, with no Reuse section. Fixed by making the three lists headings of their own.
- 2026-10-21, run 3, after that fix (fresh read-only agent): **all 7 lines passed.**
  - The HLD had Reuse, What must keep working and Edge cases sections.
  - Harmless extra: Q2 asked whether the download may gain a column, since consumers outside the configured workspaces are unknown.
