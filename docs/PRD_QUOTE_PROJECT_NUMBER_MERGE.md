# PRD: Project Number Merge During Quote Conversion

## Requirement

`QUOTE-PROJECT-MERGE-001`

Managers may convert one or more open Quote Project Numbers into one live quote. They choose which selected project number survives; that project supplies the quote reference, manager, and sign-off defaults.

## Rules

- Any open project numbers may be selected, including projects owned by different managers.
- The survivor must be one of the selected projects.
- Selected unlinked costs become line items on the new quote while retaining their source project records.
- Existing timesheet job-code rows are rewritten to the survivor reference. Duplicate codes on the same entry are removed without duplicating labour.
- The survivor becomes `converted`; other selected projects become `merged` and retain a permanent link to the survivor and live quote.
- A merged reference remains a permanent alias. Old overview URLs and searches resolve to the survivor, and later timesheet writes using an old reference are canonicalised.
- Immutable timeline and leave-snapshot text remains unchanged for audit purposes.
- Generated Inventory locations reconcile atomically inside the conversion transaction. The survivor project location is preserved and transferred to the created quote where the normalized reference matches; merged project aliases archive individually when empty of protected stock. Physical locations, stock assignments, and movement history are not collapsed into a new identity.
- The operation is atomic and rejects stale retries, non-open projects, invalid costs, and quote-reference collisions.

## Acceptance

Given `80004-MD` and `80005-MD`, choosing `80004-MD` creates one quote numbered `80004-MD`, links selected costs from both projects, moves current timesheet references from `80005-MD` to `80004-MD`, and resolves future lookups of `80005-MD` to the created quote.
