# Orders

The Orders service: order intake, payments, and the order export.

- `src/Api`: HTTP endpoints, including the CSV download of a day's orders.
- `src/Domain`: orders and stores.
- `src/Export`: the CSV export.
- `src/Jobs`: scheduled jobs, including the nightly order export to the shared exports container.
- `src/Common`: shared helpers.
