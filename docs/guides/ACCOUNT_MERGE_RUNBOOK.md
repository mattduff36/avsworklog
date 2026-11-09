# Account consolidation maintenance runbook

This is a dedicated, reviewed two-account operation, not a generic user deletion tool. The source account's business history moves to an **existing Manager target**; the target's identity, authentication and configuration remain authoritative. Implementation and local tests do not authorize live execution. The parent/operator owns CRITICAL approval, target selection, live inspection and acceptance. Never put personal IDs, emails, employee numbers, credentials, connection strings, snapshots or operator config in this repository or chat.

## Preconditions and scope

Read `docs/SECURITY.md`, `.cursor/rules/database-migrations.mdc`, `HOW_TO_RUN_MIGRATIONS.md` and `MIGRATIONS_GUIDE.md`. This runner installs private state, triggers and a Storage policy during `fence`; that is live DDL/data mutation and needs explicit authorization even though no migration file is created.

Use one operator and keep the two account identities and their business records stable from final inspection through Auth retirement. Freeze DDL and deployments. Each bounded SQL phase acquires sorted locks to drain existing database writers and prevent concurrent DML; plain reads remain available. Unrelated activity between phases is supported. After the complete source authentication/profile fence, the runner enforces a non-configurable 960-second drain for already-authorized deployed requests before the authoritative merge snapshot. The native fences cover existing public/private tables and `storage.objects`, including direct partition writes; they do not cover tables created later or arbitrary external services. A schema change requires a fresh review, not a bypass. Existing fences remain after retirement; do not remove them merely to make a retry pass. This dedicated installation supports one approved source/target pair; a later consolidation needs a separate reviewed extension.

The maintenance connection must own/have the approved DDL and table privileges, bypass normal RLS legitimately, and have `auth.uid() IS NULL`. It must be an idle, dedicated `pg.Client`, not a pooled application transaction. The runner takes sorted EXCLUSIVE table locks with a 10-second lock timeout: ordinary reads remain available, while DML and row-locking reads wait. DDL may acquire stronger locks. Mutation and fingerprint operations are batched to avoid a network round trip or full-table scan for every historical row. Plan for bounded write blocking and table-hash scan cost. Verify actual Storage DDL privileges; never weaken ownership/RLS to get past a refusal.

Required parent-owned live evidence before proceeding:

- Independently approve both identity/profile fingerprints, the Manager role/team and existing protected target configuration; the target employee ID must be empty before transfer. Do not identify a person by editable name or email alone.
- Review the actual catalog, incoming FKs (including Auth), constraints, policies, trigger bodies, closed-year carryover behavior, JSON operational references, allocation recipients and undo-close snapshots. A matching schema hash pins reviewed definitions; it does not establish that an unfamiliar schema is supported.
- Confirm 29 source absences, seven exact approved target duplicates, 16 canonical holiday keys, 23 source permission overrides, identical source/target shifts, and exactly the target onboarding adjustment of -17. Check training qualifications, 231 timesheet entries, inspections, signatures and file IDs against the private inventory.
- Confirm there are no source-owned or source-UUID-path Storage objects. Any such object requires a separately approved parent Storage operation; this runner refuses to rename paths, move objects, change bucket access or delete them.
- Prove source login/re-authentication and writes are refused after fencing, and target Manager login/PIN/permissions still work. Validate app sessions, passkeys, data tokens, privileged RPCs and Storage in the real stack. Local PostgreSQL mocks Auth and is not full Supabase/app evidence.

Unknown nonzero identity dependencies, identity FKs outside the supported schemas (even empty tables), unsupported trigger effects, incoming references to rows to be discarded, allocation recipient moves, undo-close carryover preimages, uniqueness conflicts and unapproved reporting self-loops fail closed. Stop for reviewed scope changes; never disable guards or issue generic cleanup SQL.

## External config and secret handling

Create a strict version-1 JSON config in an operator-owned directory **outside the checkout**. Reject symlinks into the repository. Keep the directory on an approved encrypted volume, with an explicitly reviewed Windows ACL restricting config, encrypted backups and receipts to the authorized operator/recovery custodian. Mode 0600 is requested by Node but is **not** a Windows ACL guarantee. Set `backupProtectionReviewed: true` only after that review.

| Config field | Contract |
| --- | --- |
| `version` | `1` |
| `runId` | New UUID identifying this approved operation; retain for all retries |
| `sourceId`, `targetId` | Distinct, externally approved UUIDs; never interchange them |
| `projectRef` | Exact bare Supabase project reference |
| `sourceEmail`, `targetEmail` | Exact approved Auth email mapping, checked with both UUIDs before retirement and merge; source must not be the protected administrator |
| `schemaHash` | SHA-256 from the reviewed live catalog |
| `sourceProfileHash`, `targetProfileHash` | SHA-256 identity fingerprints from `inspect`, excluding only `updated_at` |
| `employeeId` | Approved source employee ID to transfer after releasing source uniqueness |
| `duplicates` | Exactly seven `{ "source": "<UUID>", "target": "<UUID>" }` pairs, 14 distinct absence IDs |
| `targetAdjustmentId` | Exact target carryover adjustment ID; must be -17 and `admin-user-onboarding-adjustment` |
| `expectedSourceAbsences` | `29` for this operation |
| `expectedHolidayKeys` | `16` for this operation |
| `expectedPermissionOverrides` | `23` for this operation |
| `holidayYears` | For this account, FY2025: used 28 / balance 0; FY2026: used 30 / balance -2; FY2027: used 11 / balance 17. All carry-in values are zero. |
| `backupPath`, `receiptPath` | Absolute external file **prefixes**, with existing protected parent directories; the prefix itself must not already exist |
| `backupProtectionReviewed` | Literal `true`, acknowledging the reviewed ACL/encryption/recovery arrangement |

All fields are required; unknown fields are rejected. UUIDs and 64-lowercase-hex hashes are validated. `tests/unit/account-merge-runner.test.ts` contains a complete synthetic config factory, not real operator values. An initial inspection config may use placeholder 64-hex hashes to obtain actual fingerprints: read-only `inspect` reports, rather than validates, those pins. Review the results, replace the pins, then freeze the **entire** config before `fence`. Changing any field, including paths, makes an existing receipt incompatible.

The CLI never loads `.env.local`. An approved secret launcher must populate process environment without putting values in command arguments, terminal output, shell history, tickets or receipts:

- `POSTGRES_URL_NON_POOLING`: explicit port 5432, database `postgres`; either direct `db.<projectRef>.supabase.co` as `postgres`, or a Supabase session pooler as `postgres.<projectRef>`. No transaction pooler (6543), URL query options, remote substitute, `POSTGRES_URL` fallback or Supabase RPC migration shortcut. TLS certificate verification is enabled.
- `SUPABASE_SERVICE_ROLE_KEY`: required for supported Supabase Admin Auth and the source-only profile retirement API in apply phases other than `verify`. The profile API is a separate account-lifecycle action, not a SQL/RPC migration fallback.
- `NODE_EXTRA_CA_CERTS`: when the pooler requires Supabase's private CA, point the child process at the official downloaded certificate before Node starts. Keep TLS chain and hostname verification enabled; do not use `rejectUnauthorized:false`.
- `ACCOUNT_MERGE_BACKUP_KEY`: base64-encoded random 32-byte AES key, held separately from the encrypted backup directory in an approved recovery secret store. Keep it available for retries and recovery. Do not print it or generate it into a tracked file.

## Commands and phases

The examples below are **operator instructions, not authorization**. Run from the reviewed checkout with its installed dependencies; do not use an installing `npx` fallback. PowerShell variables contain no credentials:

```powershell
$Config = 'E:\ApprovedOps\account-merge\config.json'
$Project = '<approved-project-ref>'

# Offline default: parses config only; no environment reads, connection, Auth client or writes.
node .\node_modules\tsx\dist\cli.mjs .\scripts\maintenance\merge-user-accounts.ts --config $Config

# Explicit read-only live inspection. Review hashes/counts privately; no row values are printed.
node .\node_modules\tsx\dist\cli.mjs .\scripts\maintenance\merge-user-accounts.ts --config $Config --mode inspect --live --confirm-target $Project --confirm-port 5432

# Each following command needs the separately approved maintenance window and mutation authorization.
node .\node_modules\tsx\dist\cli.mjs .\scripts\maintenance\merge-user-accounts.ts --config $Config --mode fence --apply --confirm-target $Project --confirm-port 5432
node .\node_modules\tsx\dist\cli.mjs .\scripts\maintenance\merge-user-accounts.ts --config $Config --mode merge --apply --confirm-target $Project --confirm-port 5432
node .\node_modules\tsx\dist\cli.mjs .\scripts\maintenance\merge-user-accounts.ts --config $Config --mode verify --apply --confirm-target $Project --confirm-port 5432

# Separate irreversible Auth action, only after independent post-merge acceptance and verified receipt.
node .\node_modules\tsx\dist\cli.mjs .\scripts\maintenance\merge-user-accounts.ts --config $Config --mode retire-auth --apply --confirm-target $Project --confirm-port 5432
```

Omitting both `--live` and `--apply` is offline even when a mutating mode is named. `--live` is inspect-only; inspect cannot use `--apply`. Exact project and session-port confirmations are mandatory for every connection. There is no combined `all` mode.

| Phase | Effect and acceptance boundary |
| --- | --- |
| `inspect` | Read-only schema/identity/table hashes and source dependency counts; no backup or state writes |
| `fence` | Validate identities/emails/dependencies/plan; persist encrypted pre-fence snapshot; install tombstone/native guards and revoke source sessions/devices/credentials; commit `fence-pending-auth`. Outside SQL locks, use real service credentials to ban source Auth and atomically set only the source profile's `deleted_at`, `role_id=null`, `super_admin=false`. Confirm the exact retired profile and ban under locks, then record `fenced` and the drain start timestamp. |
| `merge` | Require the complete confirmed fence/ban, exact retired source profile, protected target pins and at least 960 elapsed seconds; persist another encrypted snapshot; atomically transfer approved business references, preserve history, discard only approved source config/duplicates/adjustment, reconcile carryovers, remove source profile last, prove exact conservation, and record `merged`; source Auth still exists |
| `verify` | Recheck committed conservation, target fingerprint, source-reference closure, leave totals and native fences; record `verified` |
| `retire-auth` | Require `verified`; recheck under locks, release locks for supported Admin Auth hard deletion, reacquire and verify again, then record `retired`; never SQL-delete `auth.users` |

Native actor guards cover INSERT/UPDATE/DELETE/TRUNCATE even on identity-free public/private tables. Row guards deny new/changed source identity assignments for null-actor/service writers, including previously empty unknown FK tables. Source UUID literals in guard bodies cover pre-fence MVCC snapshots. Storage also gets a restrictive source-actor RLS policy and owner/path assignment checks. These controls do not depend on service-role bypass flags or disable existing business triggers.

A narrow carryover exception exists only for nested native carryover-trigger writes in the runner's privately recorded current transaction, with a null JWT actor, approved source, expected generator and no generated actor. It is not available to ordinary direct/service inserts or a client-set GUC. Closed-year mutation additionally uses only transaction-local `app.absence_archive_move='on'`. Generated source carryovers are validated, attributed privately and removed; target closed-year carryover is recalculated from real source-backed rules. No global trigger disabling or `session_replication_role` is used.

## Conservation and protected target state

All 29 source absence IDs/states remain; source processed rows win over exactly seven approved target duplicates whose reason/date/end/duration/half-day/session/bank flags must match. Rewrite only the 16 canonical holiday keys. Remove the -17 onboarding adjustment without adopting it. Closed FY2025 usage remains 28 and carryover zero; FY2026 usage remains 30 against 28, balance -2.

Keep the target Manager role/team, phone when present, PIN/password/passkeys/sessions/devices, personal permission overrides, approvals and direct reports. Only missing allowlisted contact/employer fields are copied; employee ID transfers after source uniqueness is released. Discard the identical source shift and 23 source permission overrides, never grant them to the target. Remove only an active source-to-target reporting self-loop; other collisions/self-loops abort.

Timesheet/training/inspection/file IDs and their child records remain unchanged. Recipient ownership uses guarded **same-ID delete/insert**, retaining all original signature/status/timestamp bytes, because native recipient identity is immutable; allocation recipients or incoming recipient dependencies are refused. Repoint audit actors and profile-record links with protected original attribution. Historical business JSON, signatures, PDFs and audit-change payloads are not globally UUID-rewritten. Only the known `plant_legacy_missing_site` reminder's operational `metadata.submitted_by` is changed.

Usage events and usage sessions retain their IDs, payloads and attribution history. Only their allowlisted nullable `app_session_id` links to source-owned sessions are explicitly cleared while ownership moves to the target, before those source login sessions are retired. Private provenance keeps the original session links. Cross-owner links, unclassified surviving dependents or schema drift stop preflight before any backup or mutation; the runner never relies on a silent `ON DELETE SET NULL` side effect. Native regression AM-R2-001 covers both tables, linked/unlinked history, target preservation and both cross-owner directions.

The runner proves a physical MVCC tuple-token multiset for **every existing operational root table** while EXCLUSIVE locks hold. Tokens include relation OID, tuple location and creating transaction. Untouched tuples therefore retain their bytes, without reading large TOAST payloads. For every planned or accepted changed/created row, a primary-key lookup must match the exact expected full row hash (excluding only `updated_at`) before its new tuple token is accepted. Removed rows must have their original tokens. Explicit mutations and validated audit/carryover side effects are the only accepted differences, so unexpected cascades, SET NULL, child-data, no-op updates or trigger changes abort. Physical tokens are used only within that lock-held transaction, never as a durable postcommit equality check. The committed global fingerprints remain private evidence of that atomic conservation proof. Postcommit verification uses primary-key-bound expected hashes and expected absences for every changed/deleted row, together with source-reference closure, protected target profile, leave totals and fence definitions. Unrelated new or updated rows therefore do not invalidate retirement; changes to migrated records still fail closed. Do not reset receipts or bless changed fingerprints merely to force a rerun.

## Backup, receipts and recovery

Before fence or business mutation, the backup callback must confirm a durable AES-256-GCM snapshot of affected source/target rows, Auth identities/dependencies and complete operational tuple-version fingerprints. The CLI exclusively creates a new `<backupPath>.<phase>.<random>.enc`, fsyncs it and verifies the ciphertext readback hash before any mutation. The envelope holds base64 `iv`, `tag`, `aad` and `ciphertext`; AAD binds `<configHash>:<phase>:<runId>`. It does not contain the decryption key. An injected API callback is a trusted durability boundary; the CLI implements the actual write/readback contract.

Recovery custodians must verify decryption in an approved isolated tool before live use: authenticate the GCM tag/AAD with the separately held key, recompute the decrypted snapshot hash, and compare receipt/config/run/schema hashes. Do not decrypt to terminal, chat or an unprotected temp file. The snapshot contains credentials and personal data; private provenance is **not** a substitute for it. Child records not changed by the runner are protected by fingerprints, not a complete raw database backup: retain an independently approved full recovery backup/PITR arrangement too.

`private.account_merge_runs` is the durable phase/config/hash authority. It also retains the original source profile preimage, the fixed retirement timestamp and the completed-fence timestamp; rerunning a successful fence does not reset the drain. `private.account_merge_provenance` retains original business attribution and discarded permission/shift/duplicate rows; credential/session/PIN material is represented only by row hashes/IDs/retirement metadata, with nested sensitive keys scrubbed. `private.account_merge_retired` has no FK to the identity being removed. These tables use RLS and revoke PUBLIC/anon/authenticated/service_role access. Do not expose them through an app endpoint or grant browser access.

Successful apply commands also exclusively write fsynced external JSON receipts under `<receiptPath>.<phase>.<random>.json`. Stdout contains only safe receipt fields/hashes. If a receipt-file write fails **after a database commit**, the command fails but the DB may already be committed; inspect durable private state before retrying. SQL/Auth/Zod errors are redacted to allowlisted codes; raw driver errors are intentionally not printed.

A failed preflight/backup or business transaction rolls back that transaction; an already written encrypted snapshot remains as recovery evidence. A failed Auth ban or profile retirement leaves the committed fence at `fence-pending-auth`, with no business merge allowed. Retry `fence` with the identical approved config after resolving the cause; the exact already-retired profile is accepted idempotently. There is no automatic unban or restoration of source authority. An injected/business failure leaves phase `fenced` and all original business rows; rerun only after diagnosing the cause. Repeated merge/verify/retire commands validate the existing committed candidate rather than repeating transfers.

Auth API calls cannot share a PostgreSQL transaction. If deletion succeeds but confirmation/recording fails, the durable phase can remain `verified` with source Auth already absent; `retire-auth` safely checks absence and completes verification on retry. If Auth deletion causes unexpected public data changes, final verification fails and cannot undo the external deletion. Keep the affected account records stable, preserve snapshots/receipts, and return to the parent for an explicitly reviewed recovery plan. There is no automatic restore, unban, receipt rewrite, constraint bypass or inverse live merge. Never recreate/adopt old credentials into the Manager account.

## Focused local evidence

The implementation checks are `tests/unit/account-merge-runner.test.ts` and the native PostgreSQL target `tests/db/account-merge-runtime.test.ts`. Run only through the approved check runner. The native one-shot target is allowlisted in `scripts/local-test-postgres.ts`; it validates loopback/disposable-runner provenance, strips inherited database variables, skips dotenv, and proves owned-cluster cleanup. It uses synthetic data and actual source-derived absence/recipient/allocation/plant/payroll guard bodies. Auth is fixture-mocked; real Supabase Auth, PostgREST, app-session/WebAuthn flows, Storage service behavior, production schema/major parity and live business acceptance remain parent-owned evidence, not claims made by the fixture.
## Non-FK operational identity closure

The typed manifest covers document `shared_with` UUID arrays, the reminder `metadata.submitted_by` UUID, and profile audit `record_id` links. The same manifest drives dependency checks, recovery capture, source discovery, assignment triggers, and postcommit closure. An existing source document share stops the migration for review; it is not silently granted to the Manager account. Reminder UUID spellings are normalized for denial/closure, and noncanonical existing source values require review. Historical JSON is preserved.

The profile audit exception requires a nested native trigger, a null actor, an exact lifecycle delta, and the private transaction ID recorded by the exact service-role retirement transition or active maintenance transaction. Direct and unrelated nested audit writes cannot create a source link. Completed retirement clears its transaction marker; deleted source profiles cannot regain a role or super-admin authority. Native regression IDs AM-R1-001, AM-DB-011 and AM-DB-012 exercise these surfaces, including privileged null-actor writes and an injected residual.

The seven operator-approved target duplicate IDs may be either approved or processed; the source counterparts must remain processed and every matched business field must agree. Both target states are covered by the native tests. Recovery snapshots retain the actual target preimages; no other target absence is selected for deletion.

## Bounded live execution

The operator must benchmark the current read-only inspection before applying. The original all-row JSON scan took 87.5 seconds across 1.2 million live rows; the tuple-token proof avoids deparsing untouched TOAST payloads while still detecting every insert, update or delete. Mutated rows retain exact byte checks. Each lock attempt is limited to 10 seconds, a statement to 60 seconds, and the complete transaction to 180 seconds on PostgreSQL17+. Recovery and Auth API work that does not require SQL consistency occurs outside the write lock window. A timeout aborts instead of leaving a long-running maintenance transaction. The separately encrypted application/auth/storage archive provides full row recovery in addition to the per-phase affected-row snapshots.

Expected postimages are materialized in PostgreSQL from each raw preimage plus only approved changed fields. This preserves numeric scale and exact JSON numeric values, including numbers beyond JavaScript's safe-integer range. The operational reminder changes only its submitted_by key. Batched preimage predicates, same-ID recipient reinsertion, expected hashes and generated audit additions retain raw JSON. Private provenance redacts sensitive paths in PostgreSQL without reserializing unaffected values. AM-DB-015 covers the live numeric(4,2)/numeric(6,2) shapes, scaled audit JSON and exact large JSON integers.
