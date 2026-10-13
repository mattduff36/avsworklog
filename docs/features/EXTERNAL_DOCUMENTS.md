# External Documents

## Agreed first release

A separate `/external-documents` module for accounts staff to store and retrieve third-party records. Reuse the Squires page shell, dark theme, tables, search, dialogs, permissions matrix and private document viewing conventions.

- Upload PDFs, JPEGs and PNGs from desktop, or capture photographs on a supported mobile device.
- Arrange multiple inputs in order and combine them into one PDF. Validate types, sizes and readability; show actionable errors without losing the form.
- Capture title, category, external company, document/service date, optional expiry date, reference and notes.
- Manually link a document to a van, HGV or plant asset. Show accessible linked documents from the asset record. A link does not update service history or maintenance fields.
- Search/filter the library; preview/download documents; edit metadata and access; archive rather than permanently delete.
- No publication, approval, signatures, reminders or automatic extraction in this release.

## Access contract

Module slug: `external-documents`. Team access through the existing permissions matrix, with no automatic positive team/user grants on rollout.

- Level 0: no module access or data requests.
- Enabled Levels 1–3: retrieve active documents explicitly shared with the user.
- Levels 4–5: upload, view all, edit metadata/links, grant/revoke document access and archive/restore.
- Resolve the effective matrix level, including View As. Enforce the same boundary on every API and at the database/storage layer. Honour the existing optional sensitive-PIN configuration.
- A fleet/asset link does not grant document access.

## Local acceptance preview

The user approved an explicitly labelled local preview using sample vehicles/assets and local document storage. It must reuse the real module interface, demonstrate the access levels, preserve uploads across reloads and never connect to hosted services. Keep preview infrastructure separate from production authentication and permissions; do not introduce production auth bypasses.

Verify upload/merge/order, persistence, preview/download, search/filter, metadata edits, asset links, archive/restore, access grants and denied access. Exercise desktop and narrow layouts, keyboard operation and loading/error/empty states. Also run targeted production API/permission/schema tests and application typecheck. Hosted migration and activation remain unperformed for this local-only request.

## Future releases

### Scan to email

Add a dedicated intake mailbox/provider adapter. Authenticate webhook deliveries, allow approved senders, deduplicate messages and attachments, validate file limits, and retain source message provenance. Intake creates documents through the same validated storage service. Unknown category/asset matches stay visibly unassigned for accounts to resolve. Do not auto-grant broader access.

### Assisted record updates

Extract suggested service date, provider, mileage/hours, work performed and next-service details with field-level source references. Present the original document alongside proposed changes; require an authorised user to confirm the target asset and each update. Use existing maintenance APIs and audit rules, optimistic concurrency and idempotency. Preserve the original document and record which values were applied, by whom and when. Never silently replace existing records or treat uncertain extraction as fact.

## Release instruction

The owner subsequently requested matching Beta badges and `fap` (finalise and push), superseding the original local-only/no-push instruction. Keep the isolated local preview available. Run the canonical release workflow only after verification; enable Accounts/team grants separately through the permissions matrix.
