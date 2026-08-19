# /createinvoice

1. Use AskQuestion to collect the invoice date range, development rate (default £28/hour), whether completed unpushed work is included, and support rate (£5/hour, development rate, or custom).
2. Run:
   `npx tsx scripts/create-invoice.ts --from "<YYYY-MM-DD>" --to "<YYYY-MM-DD>" --rate "<rate>" --support-rate "<support-rate>" --include-unpushed "<true|false>"`
3. Read the generated evidence JSON and Markdown. Reconcile and deduplicate releases, substantive commits, and completed parent chats.
4. Exclude planning-only, cancelled, administrative, external, merge-only, version-only, duplicate `[skip version]`, and uncorroborated release-only development evidence.
5. Produce established customer-facing development-session lines plus a separate final production-support line where appropriate. Sort by completion date and estimate conservatively from the calibrated recommendation.
6. Show hours, line values, subtotals, total, and coverage notes.
7. Save the exact response as `docs_private/invoices/invoice-<from>-to-<to>-final.md`.
8. Export the companion JSON with the same formatting:
   `npx tsx scripts/create-invoice.ts --export-final "docs_private/invoices/invoice-<from>-to-<to>-final.md"`

Do not modify app code, commit, push, or run builds.
