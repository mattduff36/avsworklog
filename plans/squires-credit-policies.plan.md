# Credit entry and Policies and Procedures

Status: local credit-note, Policies and Beta-module design work prepared for integration into local main. Shared-backend migration/import is recorded below; no code push or deployment has occurred.

The earlier Git sandbox restriction is resolved in the takeover conversation. Matt authorized applying DESIGN.md to External Documents and Daily Allocation and merging the accumulated work into local main. This is local integration only.

2026-10-20 preview follow-up: Matt approved a new preview branch and live preview deployment. Added the shared Beta badge to the Policies workspace, loading state and dashboard tile. Intended branch: `preview/credit-notes-policies`. Branch creation failed because the session explicitly restricts `.git` to read-only. Vercel project `avsworklog` was identified and preview protection is enabled. No branch, push or deployment was completed. Resume with Git metadata write access, check preview database isolation/configuration, then commit/push this scope and deploy to Preview only. Production remains unauthorized.

## Decisions and implementation

1. Reuse the existing quote financial-adjustment ledger. Negative ad-hoc invoice entries become `credit_note` adjustments with a positive ledger amount; no negative invoice row is created. The original invoice, Sage credit reference, date and reason are required. Existing Accounts/admin authority, module access and PIN checks apply. Existing reversal, PDF and financial reconciliation behaviour remains authoritative. Credits against prior quote versions target the original invoice's version. Duplicate references and credits beyond the remaining invoice balance are checked inside the existing locked transaction. Reconciliation variance requires explicit confirmation.
2. Add `/policies-procedures` using the existing page shell, header, controls and permission registry. Levels 1–3 read current published documents; Level 4 manages drafts, versions, publication and archive/restore. No automatic permission grants. Effective permissions and sensitive-module PIN are enforced server-side. Private storage and server-only tables prevent direct browser access. Each upload is immutable; publishing supersedes the previous published version atomically. Draft replacements do not hide the current published version from readers.
3. Preserve all 73 SharePoint originals and source paths in a SHA-256 manifest. Categories: 18 company policies, 12 environmental, 20 health and safety, 21 quality, IMS manual and Employee Handbook. Import as reviewable drafts, rather than treating filenames as approval evidence. 71 are completion candidates. Review the legacy `AVS-HSMP-008` DOC and the Employee Handbook's conflicting footer reference (`AVS-SHEQ-IMS-006`); the handbook has provisional catalogue reference `AVS-EMPLOYEE-HANDBOOK`. CP009 was not supplied. No source content has been edited. Supported formats: PDF, DOCX, DOC, XLSX, up to 4 MB each.
4. Provide an isolated localhost preview sharing the real workspace and request handler. It uses persistent local PGlite and local blobs, not production credentials. It applies the proposed migration to fixture schemas and imports the manifest idempotently. Preview identities are fixtures, not production authentication. Notifications are not added because this module sends none.

## Local manual testing

Policies preview: http://127.0.0.1:4002 (running at handoff).

To restart from the repository root:

```powershell
Set-Location preview/policies-procedures
node ../../node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 4002
```

Prepared originals and manifest: `data/policies-procedures/import/`. Local database and uploaded files: `data/policies-procedures/preview-db/` and adjacent local storage. These are ignored by git. Recreate the import from the supplied ZIP with `python scripts/prepare-policy-import.py <zip-path>`. Do not delete the preview database to reset it without preserving any manual test work needed.

- Document controller: search by reference/category, open an original, inspect history, upload a draft replacement, publish it, archive and restore it.
- Reader: see only current published, unarchived versions; no management controls. A newer draft must not replace the published version in this view.
- No access: no document list or downloads.
- CP-001 was published in the local preview as the browser acceptance example; the other 72 originals remain drafts. This does not approve or publish the real company policy.
- Credit entry: use the updated Quotes → Accounts invoice form on an explicitly isolated test backend. Choose the ad-hoc option if an invoice request is selected, enter a negative amount, choose the original invoice, enter the Sage credit note number/date/reason and record. Confirm the credit appears once in the existing ledger and net totals, can be reversed through the existing system, and ordinary positive invoices still work. Test unauthorized users, duplicate reference, excessive credit and variance confirmation. **The ordinary app's localhost URL alone does not guarantee an isolated database; no financial records were entered against its configured backend.**

## Verification and limitations

- Application TypeScript check passed.
- 40 targeted tests passed across seven files: financial, invoice API, policy lifecycle/RLS, registration and policy authorization. Coverage includes allowed/denied access, PIN gating, version transitions, stale submissions, upload cleanup, file validation and financial reconciliation regressions.
- Browser verified actual local policy publication, reader visibility and no-access view; inspected visual layout.
- PGlite tests validate SQL/lifecycle behaviour but do not prove PostgreSQL concurrent-lock scheduling. Real PostgreSQL concurrent credit/publish acceptance remains a pre-release check.
- Main financial form has not been exercised end-to-end against an isolated database. No production build was requested or run.

## Release work deliberately deferred

After manual acceptance and separate release authorization: apply the reviewed migration through the repository migration ledger; explicitly grant reader/controller permissions; upload the reviewed source documents through the authenticated service; resolve the two flagged references/formats and confirm company approval before publication. Verify current versions, access denials, downloads, audit records and financial concurrency on the designated test database. Coordinate SharePoint cutover so only the published module is presented as authoritative. Production import/publication has not happened.

## 2026-10-20 hosted preview readiness check

- Branch remains `main`; `git switch -c preview/credit-notes-policies` failed because `.git/refs/heads/preview/credit-notes-policies` could not be created. This session still restricts Git metadata writes. No workaround, commit or push was attempted.
- Vercel environment metadata confirms Preview and Production share the same entries for `NEXT_PUBLIC_SUPABASE_URL`, PostgreSQL connection URLs, Supabase service-role/anon keys and JWT secret. No branch-specific overrides were listed. Preview also shares email and external integration credentials. Values were not decrypted.
- The policy handler uses `POSTGRES_URL_NON_POOLING` and Supabase private storage; app authentication falls back to the shared service-role key for signing. Current Preview configuration is therefore not an isolated test environment.
- `git diff --check` passed (line-ending warnings only). Import manifest is gitignored; the untracked-file inventory contains source/test/config files, not company originals. Prior test evidence remains recorded above; tests were not repeated.
- Next: restore Git metadata write access through the session permission configuration. Provision or identify a designated non-production Supabase project/branch with schema and synthetic test identities/data, private policy storage, separate signing configuration and disabled/test-only outbound integrations. Configure branch-specific Preview overrides before any push that can trigger deployment. New billable infrastructure requires approval of the chosen option/cost. Production data cloning remains outside scope.
- No migration, document upload, deployment, production write or remote branch change performed.

## Updated deployment decision

Matt created `preview/credit-notes-policies` in his own terminal; verified as the current local branch. Matt explicitly accepts the existing shared Preview/Production backend. Supabase branch creation was declined; no new backend was created. Squires project `lrhufzqfzeutgvudcowy` has only its default main database branch.

Proceed with Preview code deployment using current configuration. The earlier restriction on production schema/data changes remains: do not apply the Policies migration, import files, grant permissions or create financial test records without separate authorization. The Policies hosted data flow cannot be signed off until the shared backend is configured. Git metadata remains read-only to this agent; Matt will execute the reviewed commit/push commands in his terminal. Prior typecheck and 40-test evidence is reused; current diff whitespace check passed. Source changes inspected; company originals remain ignored.

## 2026-10-20 shared-backend import completed

Matt explicitly authorized reviewing/correcting the two document flags, importing into the shared backend, and applying compatible outstanding migration(s). Applied only `20261020_policies_procedures.sql` through the approved ledger runner to `lrhufzqfzeutgvudcowy` (checksum prefix `0713b63e9b2f`). Preflight confirmed no prior policy tables/bucket/module; existing storage policies remain and the new restrictive rule excludes only the new bucket. No existing columns/tables renamed or dropped, no financial records changed, no permission grants added.

All 73 supplied originals imported as drafts using the real shared request handler and file validator, with Matt's admin identity and upload audit events. Employee Handbook has a second draft version correcting only its footer from AVS-SHEQ-IMS-006 to AVS-EMPLOYEE-HANDBOOK. Every other DOCX archive member is byte-identical; original remains version 1. Both native Word renders have 42 pages. Legacy AVS-HSMP-008 opens in Word and contains a complete two-page Vehicle, Plant and Equipment Procedure, April 2026 revision 7.0; retained original .doc unchanged and set catalogue revision to 7.0.

Database verification: 73 documents, 74 versions, 74 upload audit events, zero published versions; private bucket; forced RLS; anon/authenticated have no direct SELECT privilege. Local CP-001 publication remains isolated to port 4002. Admin on port 4000 should now see shared drafts; readers see nothing until publication. Reusable import script: scripts/import-policy-documents.ts (dry-run default, explicit target, source hashes, resumable and stored-object verification). Originals and reviewed copy remain under ignored data/policies-procedures; no company files added to Git. No code deployment performed during this operation.

## 2026-10-20 local takeover and Beta design alignment

- Policies: removed decorative header icon and extra footer guidance, including the loading header. Registered Tailwind v4 semantic popover/muted utilities and removed the global fixed-position override that broke Radix menu positioning. Verified the opaque anchored menu, Escape/focus return and light-grey secondary text in the signed-in app on port 4000.
- External Documents: standard title bar; compact document table with muted secondary metadata and en-GB dates; shared loaders; responsive filters, semantic statuses and distinct empty/error states. Preserved PDF/upload/sharing/archive handlers. Actual port-4000 desktop/mobile empty library, filters and opening/closing the Add document dialog checked without saving records; populated rows and reader/error states were not browser-tested.
- Daily Allocation: kept specialist board behaviour; moved latest-publication metadata into the action area; retained readable publish-disabled help and accessible association; aligned legacy controls and issued-card metadata/status styling. Actual desktop board and publication-history dialog checked read-only; 390px view retains the wider-screen editing fallback. Temporary browser viewport override was reset.
- Validation: application typecheck and whitespace check passed; 54 focused credit/Policies/External Documents/registration/allocation-contract tests passed. Worker UI run: 39 passed, 3 failed in unchanged board drag/session tests (DA2-AUTO-002, DA2-AUTO-006 and morning-session button lookup), reproduced on focused retry. Board/VisitCard implementations were not edited; these failures remain unresolved, and the full UI suite is not green.
- 2026-10-20 board interaction follow-up: those three failures were stale against the current drop and session controls, plus one plan-identity bug. Job drops persist through `POST /api/daily-allocation/assigned-visits` after conversion, not a separate visit create plus labour assign. `admitPlanDay` treated a provisional plan as missing and minted a second plan id, so a second drop on the same team/date could not share the in-flight conversion. It now reuses that provisional plan. Morning session changes use the card end-edge keyboard resize (ArrowLeft on a Full visit), not an AM button; the fixture visit was a custom interval, so it had no session edge. Tests now assert one shared convert, one assigned-visit body with `plan-converted` / version 4 / Full `06:00Z–15:30Z`, and a morning PATCH of `06:00Z–11:00Z` with row version 1. `npx vitest run` on the three tests passed (3/3), then `daily-allocation-pages.test.tsx` and `daily-allocation-module-header.test.tsx` passed together (40/40). No release gate was run.
- Company documents and local databases remain ignored. No new database writes, migration runs, push, build or deployment during this design alignment. Hosted financial concurrency and isolated credit-entry manual acceptance remain release limitations.

## 2026-10-20 production release follow-up

Matt authorized fixing the three board tests, first production FAP, then fixerrors/remediation and a second FAP. Board fixes merged to local main at f87e071f; independent board/header selection 40/40 and application typecheck passed. First FAP attempt stopped before build/push on migration-ledger checksum drift. Read-only comparison proved the committed LF SQL and production ledger both equal `0713b63e9b2f583ab62451c64acefcaadfe650187df81debf0c13cf81b8c08fd`; only the working checkout had CRLF bytes. Restored the exact LF content and added an exact-path LF attribute. No ledger or database change was made. Original FAP is being resumed after this local correction; fixerrors and the second FAP remain pending.
