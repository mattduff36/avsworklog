# PRD: Live Quote Merge

## Requirement

`QUOTE-LIVE-MERGE-001`

Administrators may permanently merge two or more commercially open live quote
threads for the same customer and manager. One selected quote number survives
and every retired number remains a permanent alias of it.

## Rules

- Only effective admin or super-admin accounts with Quotes module access may
  merge live quotes.
- The latest version of each selected thread is used. Every selected thread
  must be commercially open and have the same `customer_id` and manager
  profile.
- The survivor must be selected. A merge may add another eligible quote to an
  existing survivor group, but a retired quote cannot move between groups.
- Before submission, the UI must warn that merging is permanent and cannot be
  undone, then require explicit confirmation.
- `consolidated` mode creates a new draft revision under the survivor. It copies
  every latest source line without deduplication and records its source quote,
  line, reference, quantity, unit, and rate.
- `grouped` mode leaves the commercial documents separate and presents them
  beneath the survivor.
- Every version of every selected thread receives an immutable PDF snapshot
  before the database merge commits.
- Existing quote versions, PDFs, timeline events, attachments, RAMS, purchase
  orders, invoices, invoice requests, Sage timestamps, and financial
  adjustments remain on their original records for audit integrity.
- Existing invoices remain visible under their source reference. New invoice
  requests and invoices use the survivor and may cover the whole merge group
  or selected source threads/lines.
- Only the survivor is active for future Sage actions. Source Sage timestamps
  remain historical; the merge confirmation identifies source references that
  must be retired manually in Sage.
- Retired base and version references remain permanent aliases. Searches,
  overview links, job-code lookup, inventory, calendar, and reports resolve or
  aggregate them under the survivor.
- Existing timesheet and immutable audit text is not rewritten. Future
  timesheet writes using a retired reference are canonicalised to the survivor.
- The database operation is locked, atomic, idempotent, and rejects stale
  selections, duplicate IDs, invalid snapshots, reference collisions, and
  cross-customer or cross-manager merges.

## Acceptance

Given `80004-MD` and `80005-MD` for the same customer and manager, choosing
`80004-MD` permanently retires `80005-MD`. A consolidated merge creates a new
draft revision under `80004-MD` containing both quotes' latest priced lines,
while a grouped merge retains separate documents. In either mode, original
PDFs and accounting history remain available, `80005-MD` resolves to
`80004-MD`, and future invoices can be combined or limited to selected source
work.
