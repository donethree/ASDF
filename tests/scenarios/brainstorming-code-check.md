# Scenario: brainstorming, the code check finds what the HLD missed

## Setup

- The workspaces are the ones in `brainstorming-deep-dive.md`: the fixture `tests\scenarios\fixtures\orders-export`, copied outside the repo, with `Orders` and `Reports`.
- PBI 5100's item folder holds `hld.md` and `deep-dive.md` from the fixture's `item-5100-v1` folder. HLD v1 has no open questions, so step 8 runs.
- The HLD has three planted misses:
  - it writes its own retry loop;
  - it doesn't know that Reports imports the nightly file;
  - it doesn't handle orders with no currency.

## Prompt

1. **The check.** Dispatch a fresh subagent with `skills\brainstorming\code-check-prompt.md`, filled in:
   - the domain "C# backend engineer";
   - the Orders workspace as the item's workspace, and Reports as the other configured workspace;
   - the commit each was read at, `4f2a9c1` for both (they're plain folders, clean and at that commit, so they're read directly);
   - the paths to the copied `hld.md` and `deep-dive.md`.
2. **The sorting.** Give its report to a fresh read-only agent: "Dry run: you're in an unattended do-next pass, running step 8 of the brainstorming skill for PBI 5100, and this is the code check's report. Say what you'd do with each finding. Don't run anything."

## Expected

1. It reports the retry loop as reinventing `Retry.WithBackoffAsync` (Orders `src/Common/Resilience/Retry.cs`). It notes that the HLD's loop would also retry failures that aren't transient.
2. It reports that Reports' `OrderCsvImport` (`src/Imports/OrderCsvImport.cs`) rejects the new header, so the nightly import fails from the first night after release.
3. It reports that orders whose `Currency` is null (`src/Domain/Order.cs`) would get an empty field, not their store's `DefaultCurrency`.
4. Each finding gives its kind, the file and line, and what goes wrong if the design ships as written. The check changes no files.
5. Sorting:
   - the retry and the missing currency are fixed in the HLD and the deep dive, as answered by the code;
   - the Reports break goes to the next round as a question, and is never an assumption;
   - no approval request goes out, and there's no `ask_user`.

## Result (filled in by the person running the scenario)

- 2026-10-21, run 1, baseline: the builder check alone, as step 8 ran before the code check existed (fresh read-only agent with only `hld.md`). **Lines 1 to 3 failed.**
  - It asked three questions:
    - whether a retried upload overwrites the file;
    - whether historical orders have a currency;
    - which failures to retry.
  - It never saw the code, so it couldn't find the existing `Retry.WithBackoffAsync` or Reports' strict header check.
  - The null currency came back only as a question, not as a finding from the code.
- 2026-10-21, run 2, with `code-check-prompt.md` (fresh read-only agents, one for the check and one for the sorting): **all 5 lines passed.**
  - The check found all three planted misses, with file, line and consequence for each.
  - It found two more real ones:
    - `CsvEscaping.Escape` would throw on a null currency;
    - the culture test pins Total as the last column.
  - The sorting:
    - fixed the retry, the null currency and the test in the HLD and deep dive, as answered by the code;
    - sent the Reports break to the next round as Q1, with no assumption;
    - made no approval request and used no `ask_user`.
- 2026-10-21, run 3, after the final review: the check now gets each workspace's commit (fresh read-only agent; check only, since step 8's sorting text didn't change). **Lines 1 to 4 passed again.**
