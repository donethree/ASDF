# Deep dive: 5100 Show the currency in the order export

Read: workspace Orders at main 4f2a9c1, clean and level with origin/main, on 2026-10-21.

## How it works today

- src/Export/OrderCsvExporter.cs:12-26: `ToCsv` writes the header `OrderId,Date,Customer,Total` (line 10), then one row per order. Text goes through `CsvEscaping.Escape`, and totals use the invariant culture.
- src/Jobs/NightlyExportJob.cs:7-16: at 01:00 UTC, exports yesterday's orders and uploads them to orders/<yyyy-MM-dd>.csv with `BlobUploader.UploadAsync`.
- src/Storage/BlobUploader.cs:5-11: one PUT to the exports container, with no retry. Uploading the same path again replaces the file.
- src/Api/ExportController.cs:12-18: `GET api/export/{day}` returns the same CSV as a download.

## What we can reuse

- src/Common/CsvEscaping.cs:5-10: `Escape`, for any new text column.

## What depends on it

| What may change | Who uses it | What they expect |
|---|---|---|
| `OrderCsvExporter.ToCsv` output | src/Api/ExportController.cs:16 | a CSV file to download |
| `OrderCsvExporter.ToCsv` output | src/Jobs/NightlyExportJob.cs:14 | the nightly file's content |
| The header line | tests/OrderCsvExporterTests.cs:15-17 | exactly `OrderId,Date,Customer,Total` |

## Edge cases

- An empty day is just the header row (tests/OrderCsvExporterTests.cs:15-17).
- Names with commas are quoted (src/Common/CsvEscaping.cs:5-10; tests/OrderCsvExporterTests.cs:19-21).
- Totals use a dot whatever the server culture (src/Export/OrderCsvExporter.cs:21-22; tests/OrderCsvExporterTests.cs:23-28).

## Unknowns

- None.
