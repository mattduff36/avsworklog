# Squires Windows Fixerrors admission

## Everyday runner implementation plan (MPDEE Worker)

1. Separate clean-checkout connection readiness from packet readiness. Connect
   without a precreated packet; preserve locks and uncertain/prepared work.
2. On an actual-SuperAdmin, same-origin Debug request, read one current active
   error through the existing server application client, never the queue login.
   Project only bounded, privacy-safe diagnostics into the existing packet format.
   Bind the request, device, clean HEAD/tree and packet hash through signed admission.
3. Deliver that private packet only with its authenticated leased job. Verify the
   issuer signature before exclusive local preparation, then reuse the unchanged
   native review/repair and separate exact-candidate Deploy boundaries.
4. Journal job/packet association and confirmed completion locally. Archive only
   confirmed safe terminal packets; retain prepared, inflight and unknown outcomes.
   Recover idempotently on restart without deleting replay state or guessing success.
5. Add explicit owner-consented enrollment choices to the installed manager source,
   while keeping status read-only and service/token/Job Object boundaries intact.
6. Verify synthetic request-to-signature-to-adapter boundaries, privacy/authorization
   negatives, sequential jobs, restart/retirement, and native manager fixtures.
   Parent owns integration, installation/repinning and all live acceptance.

This plan does not authorize capture, installed-file changes, production queries,
incident lifecycle writes, migration, commit, push or deployment during development.

**Development evidence (MPDEE Worker).** The final 11-file focused Vitest run passed
212 tests, with one expected non-Windows-probe skip on Windows. It included actual
disposable two-commit native preparation, signed admission/release negatives,
request-time capture, review reuse and conservative lifecycle/linked-path cases.
`npm run typecheck`, scoped ESLint and `git diff --check` passed. The disposable
`scripts\automation\windows-runner\Test-Runner.ps1` harness passed production/fixture
compilation, consent/ACL preservation, packet-free waiting, restricted-token,
opt-out, duplicate-host and descendant-stop checks. Actual interactive window
Close still needs desktop acceptance; the harness exercised the same handler.
These are development results, not installed-service or live operational approval.

## Everyday owner workflow (source ready; activation is parent-owned)

1. Use the updated standard, non-elevated **Squires Runner** manager. Stop existing
   hosts first. Choose **E**, select review consent and type **SET REVIEW**.
   This atomically changes only the five existing enrollment opt-in booleans;
   it preserves device identity, credentials, keys, checks and transport hashes.
2. Start **1 Terminal** or **2 Service**, with review runtime permission. A clean
   fixed `main` checkout, available pinned bridge and successful heartbeat can
   report **Connected - waiting** without any precreated packet. Status remains
   read-only. Retained packets, uncertain locks and prepared candidates are holds.
3. As actual SuperAdmin outside View As, open Debug and choose **Review errors**.
   The same-origin request checks queue/device/checkout eligibility, then reads
   fresh evidence outside the queue lock and rechecks before committing a job.
   An empty read records terminal **no-work**, with no signed claim or worker.
4. For bounded repair, stop the runner, explicitly select **E / repair** with
   **SET REPAIR**, and restart with repair runtime permission. Debug can reuse a
   completed review only for that device and exact HEAD/tree, within 30 minutes,
   after rereading current evidence and matching the canonical packet bytes.
   Changed evidence requires a fresh review; empty evidence produces no-work.
   A repair without eligible review captures fresh evidence under a new request.
5. A tested candidate holds subsequent review/repair. Inspect its genuine receipts;
   only then separately enable release consent (**SET DEPLOY**), start the Deploy
   runtime, and use Debug's existing exact-candidate confirmation. Local opt-in
   neither approves Deploy nor removes the signed start-deploy/release gates.

**Capture scope and privacy.** The application server reads at most one oldest
active error whose triage state is null/untriaged/outstanding, excluding the
existing diagnostic account and localhost/loopback URLs. Timestamp and ID order
make selection deterministic; IDs and URLs are not selected. Only error type,
message, stack and triage state are selected through the existing authorized
application client, never the dedicated queue login or worker. The packet retains
fixed diagnostic vocabulary and up to eight allowlisted source paths, not raw
prose, identities, URLs, headers, additional data or occurrence records. Inputs,
stack lines, source paths, query time and packet size are bounded. Missing source
or context is explicitly held, never inferred from a compiled bundle as an
actionable defect. Sensitive evidence remains CRITICAL; network evidence remains
report-only. Capture does not triage, archive, resolve, clean up or mutate incidents:
Everyday Debug review/repair captures all eligible new and old held/outstanding
errors in one run; there is no per-error selector. Previous Fixerrors activity is
collapsed by default and includes all retained queue history; active and unresolved
work stays visible. Legacy single-packet helpers below remain separate compatibility
surfaces, not the everyday workflow.

**Shared full-batch capture and execution.**
`scripts/fixerrors-capture.ts` captures new exact rows and every active outstanding
row inside the existing read-only repeatable-read export transaction. Keyset
pages have no incident-count cap; cursor, unique-ID and expected-count checks
reject partial capture. Raw lifecycle rows and their original hashes stay in
trusted bindings. `scripts/fixerrors-retrieval.ts` owns the existing grouping,
source extraction and sanitized context/knowledge projection; the chat/worker CLI
uses this shared assembly, with new groups before oldest held cases. Capture-only
keeps its existing export contract. Capture itself performs no lifecycle writes.

Debug stores one canonical full-batch manifest and private exact-row bindings.
The authenticated device route delivers ordered 48 KiB chunks with full-byte
hash verification. The companion frames these into the native batch entry point,
with renewable authenticated execution leases, exact completed-prefix checkpoints
and at most one aggregate native preparation. Queue progress and cancellation,
exact-row server lifecycle reconciliation, conservative retirement and separate
candidate-bound Deploy are wired in source. Editing these sources neither
activates nor installs the owner-controlled runner.
Do not feed an oversized batch to the single-cluster executor or invoke it once
per error; either would lose coverage or prepare multiple release candidates.

The private job stores the canonical manifest, clean HEAD/tree and SHA-256.
Only its authenticated leased device receives the manifest and v1 signed admission.
Signature, job/device/authority, expiry, exact checkout, canonical bytes and hash
are verified before exclusive local preparation. Browser state exposes only an
evidence-available boolean, never the packet or admission ticket. Existing native
scope, premium-budget, durable replay, receipt and release controls remain mandatory.

**Restart and retirement.** The companion journals the packet association and
writes local completion receipts only after the authenticated server transaction
returns successfully. Confirmed reviewed/blocked/failed work retires only on its
unchanged clean checkout with no prepared evidence. Confirmed deployed work also
requires its distinct deployment, exact tested candidate and matching prepared
file digest. Files move conservatively into
`.git\squires-fixerrors\archive\<packet-job-uuid>`; exact partial copies can resume,
conflicting bytes/links cannot. Replay and native review artifacts are untouched.
Inflight, unknown, dirty, partial-preparation and pending-tested evidence remain held.
A crash between server acknowledgement and the local receipt requires parent
reconciliation; the runner does not guess success or delete a retained lock.

**Upgrade prerequisites (do not execute as development verification).** The parent
must integrate/release the server and checkout sources, then stop all terminal and
SCM hosts and close manager windows before replacing the immutable Windows package
through its reviewed installer. Review the existing transport/check SHA pins and
typecheck-cache readiness against the accepted clean candidate; repin only when
their trusted sources changed. Preserve existing device IDs, DPAPI enrollment,
signing material, replay tombstones and receipts. New optional queue JSON fields
need no SQL migration. Old synthetic/manual packets have no lifecycle journal and
intentionally block: reconcile their actual job/candidate/lock outcome once, retaining
evidence; never overwrite them to make readiness green. Explicit owner consent,
installed ACL/DPAPI/service verification, PostgreSQL fault/concurrency evidence,
real premium-worker acceptance and separately approved live Deploy remain
parent-owned. This implementation does not install, repin, enable or run them.

`scripts/automation/fixerrors-device-admission.ts` is an offline core for the
future local companion, not a launcher, scheduler, queue, enrollment endpoint or
production adapter. No application auth, billing or installed runner settings
are changed. Even successful admission returns `launchAuthorized: false`.

## Admission contract

The locally enrolled, explicitly enabled device pins one Ed25519 public key and
key ID, its device UUID and `squires-production` environment. Read-only and
bounded-repair opt-ins are independent; worker eligibility must be explicit.
Enrollment and dependency implementations are trusted local inputs, never
downloaded ticket fields. Protect enrollment, verifier code, replay storage and
the fixed checkout from untrusted local modification. Device UUID binding is an
enrollment match, **not hardware attestation** or proof of Windows parent identity.

The issuer constructs the strict `FixerrorsDeviceJob`, encodes it with
`encodeFixerrorsDeviceJob`, signs `fixerrorsDeviceSigningBytes(keyId, payload)`
with Ed25519, then serializes exactly `{version: 1, keyId, payload, signature}`
in that order, without whitespace. Payload and signature use unpadded canonical
base64url. Version, audience, fixed job, environment, device, authority, unique
job UUID, integer UTC validity window, exact clean HEAD/tree and sanitized packet
SHA-256 are signed. Maximum lifetime is 600 seconds for bounded repair and 300 seconds for review; expiry is exclusive, with
no future-issued grace. Envelope is limited to 4096 UTF-8 bytes. Unknown fields,
duplicate keys, reordered/noncanonical JSON and arbitrary command, path, prompt
or credential fields fail closed. Tickets contain no DB/model credentials.
The companion must bound input **before** buffering and use reliable UTC time;
offline validation cannot detect immediate server revocation or clock rollback.

Only `D:\Websites\avsworklog`, ordinary `.git` checkout, clean `main`, the signed
HEAD/tree and exact locally hashed sanitized packet can pass. Both authorities
require a clean checkout at entry. The native probe uses fixed absolute Git and
read-only argument arrays with a minimal environment, a timeout/output limit,
and no shell. It does not read private records or dotenv. Read-only maps only to
`review-sanitized-packet`; repair maps only to `repair-validated-cluster`.
Neither is a shell command or a whole `npm run fixerrors` invocation.

## Durable replay interface (required before integration)

`DurableFixerrorsReplayStore.claimOnce` is deliberately an interface, not an
in-memory production implementation. The companion must provide an atomic,
durably committed insert-if-absent keyed by `(namespace, jobId)`, shared across
processes and restarts, including key rotations. Store the ticket hash and
expiry. Return true only after durable commit, false on any existing ID, and
throw on storage failure/uncertain commit. No release/retry after partial failure
or expired admission. Keep tombstones forever, or until expiry only with a
rollback-resistant clock. Reset/restore of storage must disable admission until
re-enrollment or server reconciliation prevents old jobs being replayed.
The unit fixture tests concurrent claims and re-signing, **not crash durability**.
The production implementation still needs cross-process, crash/restart,
disk-full, uncertain-commit and rollback tests.

## Installed transport boundary and next phase

Read-only inspection on 2026-11-09 of
`C:\Users\mattd\.codex\skills\cursor-worker\scripts` found:

- `parent_access.py`: `verify` requires live native unrestricted Codex ancestry,
  environment and active-turn evidence. `_fixerrors_shell` additionally checks
  exact npm/tsx ancestry and still returns to that native Codex check. A service
  or companion is not that parent.
- `chatgpt_parent.py`: separate owner-enabled `origin=chatgpt` transport requires
  its configured Desktop Commander ancestry/token. It is not a generic service
  escape hatch.
- `run_worker.py`: origin routing admits Codex/ChatGPT; existing verification,
  scoped checks and handoff remain authoritative.
- `budget_guard.py`: fresh provider observations, credential attribution and
  budget reservation precede dispatch; runtime monitoring retains API-credit,
  timeout and repeated-failure gates.

Before unattended launch is authorized, the installed runner needs a separately
owner-approved **new transport**, distinct from both existing origins. It must
verify enrollment, explicit opt-ins and this signed admission at its trusted
boundary, own the durable claim, bind an immutable admission to one exact scoped
request, and authenticate the local companion using an explicitly designed
Windows IPC/process/service boundary. This core does not supply that identity.
Do not forge Codex environment/ancestry, relabel as ChatGPT, monkeypatch
verification, copy live credentials, or treat a receipt/UUID as parent authority.
An alternative today is an actual authorized interactive Codex parent using
the unchanged existing transport; that is not unattended execution.

Integrate these functions into that companion rather than adding another queue.
Hold a one-writer checkout lock, recheck candidate/opt-in/expiry at use time, and
fail on drift between inspection and launch. Locally define the fixed prompt,
commands and packet source; never accept those from the ticket. Read-only must
have no edit authority; repair must use existing validated decisions, exact
eligible source/test scope, candidate-bound required checks and receipts, and
CRITICAL holds (`fixerrors-auto.ts` / `fixerrors-decision.ts`). Preserve existing
budget eligibility/reservation/runtime guards and worker no-delegation,
no-commit/push/deploy/migration/production-mutation policies. A ticket is neither
budget approval nor authorization for capture/lifecycle SQL. Production adapters,
device enrollment issuance, key rotation/revocation, durable replay and transport
authorization require the next separately approved phase.

Targeted offline check (does not load `.env.local`):

```powershell
$env:AVSWORKLOG_TEST_SKIP_DOTENV='1'
npx vitest run tests\unit\fixerrors-device-admission.test.ts
```

## Local control-plane prototype (no production activation)

Debug > Error Log now includes a **Local Fixerrors companion** card. It has a
separate server-side actual-SuperAdmin check, rejects View As, and does not
inherit Debug's support-user exception. Existing error-log endpoints and
triage behaviour are unchanged. The card is disabled unless
`SQUIRES_FIXERRORS_LOCAL_ENABLED=1`, and the server forcibly disables it for
`NODE_ENV=production` or any Vercel environment. There is no public feature flag.

This phase is deliberately loopback-only. Both the site and companion use the
fixed `https://localhost:4443` origin. An owner-managed, locally trusted HTTPS
reverse proxy to the existing development server on port 4000 is required;
certificate/proxy setup is not provided. Do not disable TLS verification,
forward this endpoint publicly, or change the origin to production as a shortcut.
Browser writes require that exact Origin. The outbound device endpoint is
`POST /api/fixerrors-device`, independently authenticated by a provisioned
revocable device credential; browser sessions and Origin-bearing device calls
are not accepted as device authority.

### Dedicated private local storage

The queue uses the repository's `pg` transaction pattern, but **not** its
production database connection or application tables. Set
`SQUIRES_FIXERRORS_LOCAL_DATABASE_URL` locally to a dedicated PostgreSQL database
named `squires_fixerrors_local` on `localhost`, `127.0.0.1` or `::1`.
Remote hosts, other database names and URL query options are rejected.
Do not put connection strings or device credentials in site inputs or tickets.
These scripts do not load dotenv; configuration must be explicitly provided
in the local process environment.

`scripts/automation/local-migrations/20261109_fixerrors_control.sql` is a
forward-only **local** migration, intentionally outside production migration
discovery. It is never run by finalise. It creates private, RLS-enabled
queue/audit tables with no browser policies or PUBLIC grants. The queue locks
its singleton state row; request IDs remain tombstones, leases are hashed,
expired/lost leases are terminal and never requeued, and state plus append-only
audit commit together with synchronous commit enabled. There is a deliberate
capacity hold at 20 devices/500 jobs; there is no automatic pruning or database
reset. Approvals append the exact HEAD/tree/check digest as audit evidence.
Database owners remain privileged; this is not a tamper-proof audit against
the machine/database owner.

After separately provisioning the dedicated local database, an owner can
explicitly install this local schema and enroll the current Windows user:

```powershell
# Local process configuration only; never source production dotenv.
$env:SQUIRES_FIXERRORS_LOCAL_ENABLED='1'
# Provide SQUIRES_FIXERRORS_LOCAL_DATABASE_URL securely, without logging it.
$env:SQUIRES_FIXERRORS_LOCAL_SCHEMA_APPLY='1'
node --conditions=react-server --import=tsx scripts\automation\setup-fixerrors-local.ts
node --conditions=react-server --import=tsx scripts\automation\provision-fixerrors-local-device.ts
```

The `react-server` condition permits the scripts to use the server-only store.
No production schema is created or applied by these commands. Setup replay
fails instead of resetting existing state. Provisioning generates a random
credential locally, stores only its SHA-256 in the dedicated database and
writes DPAPI CurrentUser-encrypted enrollment to
`%LOCALAPPDATA%\Squires\Fixerrors\device.dpapi` in an owner-only directory.
The secret crosses a local child-process stdin pipe, not argv or console.
The site never accepts or displays keys. Revoke the device through the card.
Rotation/re-enrollment and recovery after an uncertain provisioning commit
are owner operations, not automatic retries; do not delete replay state to
recover. Never share, back up into source control, or copy enrollment to
another Windows identity.

### Manual companion and executor boundary

```powershell
$env:SQUIRES_FIXERRORS_COMPANION_ENABLED='1'
$env:SQUIRES_FIXERRORS_ALLOW_READ_ONLY='1'
# Independent local opt-ins, both off unless explicitly set:
# $env:SQUIRES_FIXERRORS_ALLOW_REPAIR='1'
# $env:SQUIRES_FIXERRORS_ALLOW_DEPLOY='1'
node --import=tsx scripts\automation\fixerrors-companion.ts
```

This is a manually started foreground Node process, not a service, tray app,
installer or autostart task. It polls outbound HTTPS only, refuses redirects,
bounds input/output and timeouts, and never accepts server-provided paths,
prompts, shell commands or argv. It pins `D:\Websites\avsworklog`, ordinary
`.git`, clean `main`, HEAD/tree and a bounded locally hashed sanitized packet
at `.git\squires-fixerrors\sanitized-packet.json` when executing work. Connection
readiness instead uses clean HEAD/tree without a packet. The authorized Debug
request captures the fixed privacy projection above; its signed leased claim
supplies the packet for exclusive local preparation. The companion itself has no
application-record credentials or production capture command.

An exclusive `.git\squires-fixerrors-companion.lock` permits one companion
writer. A stale lock requires owner investigation, not automatic deletion.
Renewals and terminal status updates require the same device and fresh lease.
Unknown network/commit outcomes stop polling rather than retrying work.
Execution rechecks consent, checkout and lease immediately before use.
Review is capped at 120 seconds; repair at 480 seconds, shortened by remaining
job expiry. A deployment must explicitly start
within the five-minute approval window. Once started, it has a 25-minute
execution cap, a renewable 60-second lease and up to 30 seconds to settle and
report its result. Cancellation must settle within five seconds or the checkout
lock is retained. A started deployment that times out, loses its lease or is
revoked requires reconciliation before another repair or deployment. The local
prototype has no reconciliation action. A real bridge must supply reliable
process-tree cancellation and candidate-bound required-check evidence. A lost
lease cannot report success.

**Local mode remains refusal-only:** `unavailableFixerrorsExecutor` reports
`blocked / bridge-unavailable`; no worker, fixerrors command, fap, commit, push,
migration or deploy launches. Production uses only the separately enrolled,
SHA-pinned bridge described below, with its independent opt-ins and durable replay.
Queue authentication does not replace signed admission or authorize deployment.
The v1 format is unchanged; Deploy approval is a separate control-plane record,
not a new v1 authority.

### Separate exact-candidate Deploy confirmation

Only a repair's terminal `tested` result, with passing `targeted-tests`,
`typecheck`, and `lint` evidence, can expose **Deploy: review exact candidate**.
The check digest is SHA-256 of the strict, fixed-order `checksSchema` JSON:
HEAD, tree, then those three ordered check IDs, output SHA-256 and passed=true.
Evidence contains hashes only, never test output or commands. The real bridge
must map those fixed IDs to its locally trusted scoped check receipts; the
site cannot choose checks.

The user must open the separate inline confirmation, inspect the tested commit
(full digests are under **Technical candidate details**), choose the release mode,
check the initially unchecked exact-candidate approval checkbox and submit.
Changing mode, cancelling/reopening or refreshing to a changed candidate resets
consent. This creates a distinct, five-minute job with an independent audit event
and frozen candidate approval, including the selected mode.
The same actual SuperAdmin may request repair and later confirm Deploy; this
is separate explicit consent, not a two-person approval policy. No repair or
review result triggers this step automatically. Duplicate approval, stale
HEAD/tree, changed check digest, offline/revoked device and absent local
Deploy opt-in fail closed. Claim and companion recheck the exact candidate;
the companion additionally requires locally held matching test evidence.
Local prototype tests exercise those states with clearly named fake executors;
they do not establish production worker or release acceptance.

### Verification and remaining integration gates

Offline fixtures (all commands skip `.env.local`):

```powershell
$env:AVSWORKLOG_TEST_SKIP_DOTENV='1'
npx vitest run tests\unit\fixerrors-control.test.ts tests\unit\fixerrors-companion.test.ts tests\unit\fixerrors-local-store.test.ts tests\integration\api\fixerrors-local-route.test.ts tests\ui\fixerrors-control-panel.test.tsx tests\unit\fixerrors-device-admission.test.ts tests\integration\api\debug-error-logs-route.test.ts
```

The queue tests use transaction fixtures; storage tests run the real local SQL
and store through a disk-backed PGlite adapter, including clean close/reopen,
rollback, append-only audit and RLS checks. They do **not** establish native
PostgreSQL cross-process locking, crash durability, disk-full or uncertain
commit behaviour. No actual worker or fap runs in tests. UI tests prove
separate confirmation and authorization gating, not browser visual acceptance.

Before any broader use: owner-reviewed trusted bridge integration and real
scoped receipt mapping; durable v1 replay; native PostgreSQL concurrency and
fault tests; DPAPI/ACL lifecycle and Windows termination testing; trusted local
TLS setup; real-browser responsive/keyboard/contrast checks; and a separately
approved production persistence/transport/enrollment design. No production
activation, installed-runner change or release authority is supplied here.
The native read-only Git probe additionally pins `NODE_ENV=production` to
satisfy Next.js's required
`ProcessEnv` typing without inheriting the parent environment.

### Signed release handoff library (isolated fixtures only)

The default foreground companion above still uses only the unavailable executor.
No Python process launcher, installed-runner change, pairing, service or fap
adapter is supplied or activated by this library.

`lib/fixerrors/release.ts` implements the staged Python bridge's distinct v1
`squires-windows-fap` issuer ticket and `squires-companion-release-v1` device
proof. Release and repair issuer IDs and Ed25519 keys must differ; the device
key must differ from both. Canonical field order, base64url, separate approval
and repair UUIDs, exclusive expiry, no future grace and the 300-second maximum
are enforced. This does not change the repair admission format.

Prepared checks may additionally contain
`release: {candidateSha256, testEvidenceSha256}`. The existing checks digest
covers that extension, so both values are frozen by the separate Debug
confirmation and are displayed there. `candidateSha256` is the worker snapshot
digest, **not** the Git tree or the control-plane checks digest.
`testEvidenceSha256` hashes `encodePreparedReleaseEvidence`'s exact UTF-8 bytes:
`repairJobId`, `head`, `tree`, `candidateSha256`, `allChecksPassed`,
`workerResultSha256`, then `preparedChecks`. The latter has exactly
`targeted-tests`, `typecheck`, `lint`, in that order, each containing
`{receiptId,sha256}`. Each receipt hash must also equal that check's
`outputSha256`. Preparation and genuine candidate-bound receipts remain trusted
local work, never browser input. Python must independently validate the actual
worker result, prepared files and receipt contents; these hashes alone do not
establish that checks ran.

For native batch preparation only, the canonical evidence appends
`batch: {version:1, manifestSha256, contributionsSha256, clusterCount, repairCount}`
after `preparedChecks`. Both counts are positive and repair count cannot exceed
cluster count. `workerResultSha256` then hashes the actual `batch-proof.json`,
not a single worker's state. The existing evidence/checks digest includes this
extension, without changing legacy encoding or separate Deploy consent. The
release verifier independently checks the manifest, ordered contribution
artifacts, decisions, intermediate candidates and final union receipts.

The authenticated device `start-deploy` transaction can return `releaseTicket`
only after verifying ownership of the fresh lease and recording the start.
Signing failure rolls back the start and audit; a ticket is returned only after
the store commits. The browser approval endpoint never issues tickets.
The ticket expires no later than the original five-minute approval, even though
the started job has a longer execution deadline. Repeated start is rejected.
No signing material or device proof is stored in browser-visible queue state.

For a **separately prepared disposable run**, the lead can enable only this
server-side fixture signer with both
`SQUIRES_FIXERRORS_SIGNED_RELEASE_FIXTURE_ENABLED=1` and
`SQUIRES_FIXERRORS_SIGNED_RELEASE_FIXTURE_ROOT`. The root must be an ordinary
direct child of the canonical Windows temporary directory named
`SquiresSignedReleaseFixture-<UUID>`, containing ordinary `checkout\.git` and
bare `remote.git` directories. The clean `main` checkout must have only
`origin`, with exactly that absolute filesystem path for both fetch and push.
The production checkout, URLs, alternate push URLs and linked directories fail
closed. Existing local-only/production/Vercel gates still apply.

The lead supplies `issuer.json` in that disposable root, with exact fields
`version:1`, `fixtureOnly:true`, `gitExe` (the fixed
`C:\Program Files\Git\cmd\git.exe`), `keyId`, `privateKeyPem`, `repairKeyId`,
`repairPublicKeyPem`. Use newly generated disposable keys only; never point at
installed enrollment/signing material. This file is not generated, provisioned
or read by default. Protect it locally and remove it after the fixture.

`createSignedReleaseFixtureExecutor` in
`scripts/automation/fixerrors-signed-release.ts` is the paired companion
interface. Supply `enabled:true`, the same fixture `scope`, pinned release and
repair public keys, a separate disposable device private key, trusted local
`evidence()` and `testedCandidate()` readers, `nowSeconds()`, and a reviewed
`PairedReleaseFixtureTransport`. Pass this executor to `executeCompanionClaim`,
with fixture-only inspection and existing authenticated device requests for
renew/complete. Its `startDeploy` callback must return the parsed **actual**
`start-deploy` response rather than discarding it. The executor forwards no
proof without that signed response. It rechecks clean candidate, filesystem
remote, expiry, approved digests and prepared receipt references, then passes
the canonical stdin buffer and fixed checkout/remote to `transport.invoke`.
Aborted or mismatched results cannot report deployment success.

**Remaining integration:** the lead must provide a separately reviewed,
hash-pinned disposable Python transport and through-push adapter with reliable
process-tree cancellation, protected durable replay/result persistence and a
guarded filesystem-only remote for the entire execution, not just preflight.
The staged Python entrypoint still pins the real checkout/enrollment; it must
not be invoked unchanged as a fixture launcher or pointed at installed secrets.
No dynamic command/path loader or automatic fallback is provided here. A
successful fake transport result is not a tested fap or end-to-end release.
The focused interoperability test calls the actual staged signature verifier
and candidate-drift preflight only, with ephemeral keys and no replay claim,
worker, Git write or fap.

Focused offline checks:

```powershell
$env:AVSWORKLOG_TEST_SKIP_DOTENV='1'
npx vitest run tests\unit\fixerrors-signed-release.test.ts tests\unit\fixerrors-companion.test.ts tests\unit\fixerrors-control.test.ts tests\integration\api\fixerrors-local-route.test.ts tests\ui\fixerrors-control-panel.test.tsx
```

## Production release foundations

The production control plane is disabled unless the production Vercel environment
sets `SQUIRES_FIXERRORS_PRODUCTION_ENABLED=1`. Preview deployments cannot enable
it. Production requests use only `https://www.squiresapp.com`. A dedicated
PostgreSQL login accesses the private production queue and append-only audit,
using `SQUIRES_FIXERRORS_PRODUCTION_DATABASE_URL` with certificate verification.
The schema migration creates the role without login access. It remains blocked
by the separately identified PUBLIC security-definer exposure; no migration or
production permission change is authorized by this work.

If the dedicated database requires a private CA, set the server-only
`SQUIRES_FIXERRORS_PRODUCTION_DATABASE_CA_PEM` to an owner-verified PEM certificate
bundle (maximum 64 KiB). Invalid or non-certificate content fails closed. Omitting
it retains Node's default trust store. Both paths require certificate and
hostname verification (`rejectUnauthorized: true`); URL query options cannot
override TLS. Do not disable verification to diagnose the connection.

The server pins the enrolled device with `SQUIRES_FIXERRORS_PRODUCTION_DEVICE_ID`.
The release issuer uses `SQUIRES_FIXERRORS_RELEASE_PRIVATE_KEY` and the distinct
`SQUIRES_FIXERRORS_REPAIR_PUBLIC_KEY`, each containing base64url-encoded PEM.
Only the authenticated deploy-start transaction can issue a release ticket.
Use separate production keys and leave the flag off until enrollment is verified.

The production adapter source is `scripts/automation/squires-fap-adapter.mjs`.
The installed copy must be outside the checkout and SHA-pinned by the trusted
Python bridge. **Full checks (fap)** is the default and retains the existing
guarded finalise-and-push gates. **Targeted checks (urgent)** reuses genuine,
candidate-bound `targeted-tests`, `typecheck` and `lint` receipts already validated
by the native bridge, without running local full fap/build again. This is not an
untested push and does not skip Vercel's build.

Both modes require the signed, one-use approval, clean exact HEAD/tree and prepared
two-commit candidate, unchanged expected remote base, canonical fetch/push
destination and ancestor proof. Targeted uses `fixerrors-targeted-release.ts` and
the same exact-SHA guarded push/expected-base lease as full, never plain `git push`.
It permits only modifications of existing ordinary source/unit-test files in
approved roots, plus the three existing generated release metadata files.
Additions, deletions, renames, links, mode changes, migrations, configuration,
API/server, security/permissions, financial and release-infrastructure paths fail
closed. Only the two exact synthetic acceptance fixture paths are exempt from the
`fixerrors` name hold. This release-machinery change itself requires full mode.
An ineligible urgent approval never silently downgrades/upgrades or falls back:
the parent must reconcile the failed job and separately approve a permitted release.

The selected `releaseMode` is stored with the approval and append-only candidate
audit, appended to the canonical signed release ticket and verified natively.
Historical stored approvals/tickets without it mean **full only**. Unknown modes,
mode tampering and mismatch with the local approval fail closed; older installed
verifiers reject new tickets until the owner installs and repins reviewed code.
No database schema change is needed for these existing JSON fields.

After either push, the adapter polls the fixed live identity endpoint for up to
**eight minutes**, requiring both the exact approved SHA and a valid Vercel
deployment ID before success. A timeout remains unknown, not successful. The
five-minute approval/admission expiry and 25-minute execution ceiling are
unchanged; neither mode authorizes installed-runtime changes or production setup.

Production still requires device enrollment and an owner-reviewed installed bridge
transport. Local mode continues to use the unavailable executor. Production
selects the separately pinned bridge; read-only, repair and Deploy each require
their own process opt-in plus the corresponding protected enrollment opt-in.
Repository source changes alone neither install nor activate that bridge.

### Staged production review/repair integration

The shared v1 repair encoding now lives in `lib/fixerrors/admission.ts`; the
offline admission script re-exports its existing interface. An authenticated
production device claim can return `claim.admissionTicket` for its exact leased
review/repair. Signing occurs inside the queue transaction; a signing or commit
failure cannot expose a successful claim. No ticket is stored in browser-visible
state. The repair issuer uses server-only base64url PEM
`SQUIRES_FIXERRORS_REPAIR_PRIVATE_KEY` plus
`SQUIRES_FIXERRORS_RELEASE_PUBLIC_KEY`, with distinct Ed25519 keys and IDs.
The signed UUID/device, authority, candidate and packet hash retain the v1
format and authority-specific exclusive expiry. This adds admission, **not** worker
launch authority, a replay store or a deployment approval.

`scripts/automation/fixerrors-companion-packet.ts` retains explicit trusted-local
packet preparation from stdin for legacy/manual tooling, not the everyday Debug
flow or production capture/sanitization. Such packets lack a request journal and
are held for explicit reconciliation by the current companion:

```powershell
# Pipe only an already reviewed sanitized JSON object; never raw error records.
# Fields: schemaVersion:1, snapshotChecksum, retrieval (the strict automatic
# fixerrors retrieval, including snapshotId, baseHead and treeFingerprint).
node --import=tsx scripts\automation\fixerrors-companion-packet.ts --prepare-local-sanitized-packet
```

These legacy single-packet preparation and companion reads remain capped at
96 KiB; full-batch execution uses the separate chunked transport below.
Preparation requires the fixed clean ordinary main
checkout, exact candidate fingerprint and the companion writer lock. It writes
canonical bytes with exclusive creation, fsync and readback to the fixed
`.git\squires-fixerrors\sanitized-packet.json`; it never replaces an existing
packet, deletes another lock, captures production, loads dotenv or launches
execution. Interrupted/failed writes and existing packets need owner
reconciliation, not an automatic overwrite. The sensitive-content check is a
backstop, not proof that arbitrary input is sanitized. The trusted preparer owns
that review and the original snapshot checksum.

`validateCompanionRepairDecision` reuses `validateDecision` and the extracted
automatic repair guard. It binds one exact cluster/candidate, holds CRITICAL
advisories or decisions, pending deployment, missing enrichment and sensitive
or unrelated source/unit-test scope. It derives only paths, the fixed check IDs
and the canonical validated-decision hash. This non-executable plan contains
neither commands nor receipt passes. The staged trusted boundary now invokes
these shared guards before production dispatch.

`squires-windows-release.py repair` selects the staged `squires_repair.py`.
The device proof contains exactly `{ticket,packet}`, never a supplied plan,
command or decision hash. Existing `squires_companion.py` verifies the distinct
repair/device signatures and atomically consumes its existing SQLite replay
claim. The new orchestrator uses the native premium runner's authenticated
`squires-companion` boundary, budget reservation and runtime monitoring unchanged.
It does not impersonate Codex/ChatGPT or broaden worker tools.

A read-only premium analysis must return actual strict decision JSON without
changing the checkout. `fixerrors-bridge-boundary.ts` independently binds that
decision to the one signed cluster/current candidate, applies shared CRITICAL,
pending-deployment and automatic-scope guards, intersects paths with the installed
runner's narrower root allowlist, and inspects tracked ordinary
existing source/tests for sensitive contents. A repair request is derived only
from the validated decision. The native runner must report success, no issues
or out-of-scope changes, an unchanged HEAD/branch/index and genuine passing
file-scoped receipts matching the final worker result. No model prose or caller
hash substitutes for those artifacts.

Trusted preparation reacquires the native checkout lock and compares the exact
native snapshot before writing. It commits only actual allowed repair changes,
then calls the existing deterministic release metadata generator with no provider
credentials. It commits only the metadata allowlist. Git hooks are not skipped.
It reruns the three fixed checks with `candidate_scope=worktree` **after both
commits**, verifies receipt bytes/config/commands/termination/candidate stability,
and exclusively fsyncs `.git\squires-fixerrors\prepared-release.json`.
The staged `squires_release.py` independently rechecks the two-commit chain,
validated decision, enrolled check derivation and receipts at separate Deploy.
Legacy/unprepared artifacts cannot be promoted by adding invented receipt fields.

The four ordered SHA pins are `squires-windows-release.py`, `squires_release.py`,
`squires_companion.py`, then `squires_repair.py`. Existing three-pin
enrollment fails closed until the owner installs and repins. The check catalogue
contains only absolute enrolled Node plus the fixed scoped wrapper and check ID;
validated unit-test/lint paths are appended locally. Typecheck takes no paths.
The wrapper sets `AVSWORKLOG_TEST_SKIP_DOTENV=1` and does not use a shell/npx.
Every typecheck runs the complete application `tsconfig.json` project with
`tsc --project tsconfig.json --noEmit --incremental`, using only the protected
external cache described below, never checkout `tsconfig.tsbuildinfo`.
The root project excludes unit tests; this is application-project typechecking,
not a claim that unit tests were typechecked. Worker artifacts, decisions, metadata
diagnostics and all receipt bytes remain in the private native run directory.

On the existing single-cluster path, review is capped at 120 seconds; repair
including preparation is capped at 480 seconds and additionally at ten seconds
before the original job expiry. Native
analysis/repair stages have one/two-minute bounds. The signed admission and queue
expire within ten minutes for bounded repair and five minutes for review. Renewable 60-second leases, cancellation, replay protection and exclusive signed expiry remain mandatory.
Slow work fails closed, never becomes tested evidence, and needs owner
reconciliation rather than automatic replay/requeue. Preparation failures retain
the native lock; abrupt cancellation during a write also leaves that lock.
The Windows Job Object contains descendants, while lease loss/cancellation
prevents the companion from acknowledging success. These are operational
boundaries, not an OS sandbox for trusted repository test code.

No installed files, enrollment, replay state, credentials, production checkout
commits, production records or deployment are changed by editing these sources.

Focused offline checks (the name filter excludes disposable Git-write fixtures):

```powershell
$env:AVSWORKLOG_TEST_SKIP_DOTENV='1'
npx vitest run --no-file-parallelism tests\unit\fixerrors-typecheck-cache.test.ts tests\unit\fixerrors-production-bridge.test.ts tests\unit\fixerrors-controlled-acceptance.test.ts tests\unit\fixerrors-production-config.test.ts tests\unit\fixerrors-production-admission.test.ts tests\unit\fixerrors-companion-packet.test.ts tests\unit\fixerrors-device-admission.test.ts tests\unit\fixerrors-auto.test.ts tests\unit\fixerrors-companion.test.ts tests\unit\fixerrors-control.test.ts tests\unit\fixerrors-signed-release.test.ts tests\integration\api\fixerrors-local-route.test.ts tests\ui\fixerrors-control-panel.test.tsx -t '^(?!.*clean local main only)'
npm run typecheck
```

Scoped ESLint should cover the changed Fixerrors source and test paths; do not
invoke a build, finalise, production capture or a release fixture for this check.

Packet-write tests use an in-memory filesystem, not the live checkout. The new
Python interoperability fixture uses explicitly **synthetic worker state** in a
disposable checkout, makes two real local fixture commits with the real metadata
generator, runs real Vitest/TypeScript/ESLint subprocesses and checks their actual
whole-worktree receipts (including tamper/drift negatives and TypeScript digest
interoperability). It uses the installed runner modules read-only, never enrollment,
replay storage or model credentials. Its dependency-only temporary junction is
removed without following it. This proves preparation/receipt mechanics, **not**
that a premium worker ran or a production candidate was accepted.
Queue fixtures are not native PostgreSQL crash/concurrency evidence.

### Native full-batch transport and aggregate preparation

`squires_repair.execute_batch(device_proof, manifest_bytes, cfg, lease)` is the
guarded native entry point, reached by the companion through framed `batch_main`.
Its TypeScript adapter in
`scripts/automation/fixerrors-batch-engine.ts` calls the shared
`runAutomaticFixerrors`; it cannot fall back to direct CLI worker dispatch.
The manifest has exactly `{schemaVersion:1,snapshotChecksum,retrieval}`, with
unique clusters in new-before-held order. Its canonical bytes bind the clean
initial candidate and complete sanitized retrieval. Raw rows and exact
production lifecycle IDs stay on the trusted server.

The existing short signed repair admission and durable SQLite replay claim
remain mandatory. The separate device-proof domain is
`squires-companion-batch-v1`, with exactly `{ticket,manifestSha256}` in its body.
The injected `lease(expected)` callback must return a canonical issuer-signed
envelope under `squires-fixerrors-batch-lease-v1`. Its ordered payload is
`version,runId,deviceId,manifestSha256,checkpointSha256,leaseId,sequence,authority,issuedAt,expiresAt`.
Version is 1, authority is `continue` or `resume`, and exclusive expiry is at
most 60 seconds after issue. Identity/checkpoint changes, rollback, expired
leases, changed enrollment or withdrawn consent stop execution. A safe resume
requires fresh strictly advanced `resume` authority, a one-use lease claim and
the original durable admission claim; it does not waive short admission expiry.
The server must issue a fresh same-binding admission when needed.
An authenticated recent heartbeat with no clean-checkout observation may resume
only that same device's retained, confirmed stopped prefix. New admission still
requires a clean HEAD/tree. Mutable consent flags do not change the preparation
fingerprint; their live opt-ins remain mandatory, while immutable enrollment,
source pins, keys, checks, artifacts and exact candidate changes still deny reuse.

Analysis and implementation use the existing authenticated native premium
dispatch, admission guard and budget checks, with only the selected cluster.
Read-only mode investigates all clusters but never repairs or prepares. Empty
review/repair returns a complete report/no-change result without commits.
Independent unchanged failures remain recorded and processing continues;
unverified mutation stops rather than becoming a resumable prefix.

The existing `.git\squires-fixerrors\active-packet.json` gains a versioned
`batch` extension, not another queue. It records immutable manifest/code/config
hashes, ordered native artifact hashes, intermediate snapshots, cursor and
outcomes. Resume requires the exact stopped completed prefix and unchanged
candidate, artifacts and genuine receipts, without repeating completed workers.
`.git\squires-fixerrors\batch-executor.lock` serializes execution. Inflight,
preparing, completed replay, stale crash locks and uncertain cancellation require
reconciliation; no automatic lock deletion or guessed completion is supplied.
The legacy single-packet lifecycle adapter holds batch journals; the dedicated
batch adapter handles confirmed completion and archival without deleting durable
replay or native artifacts. Uncertain and inflight evidence remains held.

Native manifests have a 16 MiB physical limit, not a row or cluster truncation
rule; oversize evidence fails explicitly. Frames are bounded to 192 KiB. Every
completed prefix is saved locally and acknowledged through signed server authority
before it becomes a confirmed pause/resume boundary. Terminal completion binds the
sorted full-outcome hash and a successful native process exit; confirmed pause
requires the native pause exit code.

The server persists one immutable exact-row lifecycle plan in its private queue.
Its pre-receipt transaction must complete before application updates begin; its
post-receipt is separately persisted after the application commit. Application
access uses `POSTGRES_URL_NON_POOLING`, never the queue database login. Commit or
post-receipt uncertainty retains the same plan for receipt-verified idempotent retry.
Verified local repairs remain awaiting deployment, never fixed live. Conflicts,
schema drift, expiry and unavailable storage remain visible lifecycle blockers.
Completion acknowledgement lost after server commit can be reconciled against the
retained exact outcome. Native completion with no committed server outcome, an
unacknowledged checkpoint, stale crash locks or uncertain stop still requires
owner reconciliation; no success or fresh execution authority is guessed.

There is no whole-backlog single-cluster timeout. The parent rechecks renewable
authority while each isolated operation runs, terminating its particular Windows
PID tree on lease loss. Analysis/repair operation bounds are 180/480 seconds;
preparation allows two complete enrolled check rounds plus 300 seconds of bounded
Git/metadata/proof overhead. Isolated Python children receive only allowlisted
runtime variables, without inherited worker overrides or trusted Git subprocess
overrides; the normal runtime guard is not weakened. Isolated Python startup
imports sibling modules only from the fixed script directory.

All accepted independent repairs contribute to one `batch-proof.json`, binding
the manifest, ordered decisions/artifacts, intermediate candidate chain and
complete outcome. The union of required tests and editable paths is hash-bound
in `.git\squires-fixerrors\batch-check-scope.json`. Targeted tests and ESLint
run every path in chunks of 40; 40 remains a single-cluster limit, not a batch
truncation rule. Complete application-project typecheck remains required.
The optional Node V8 compile cache is disabled in check subprocesses to avoid
deep Windows receipt-TEMP stalls; the protected TypeScript incremental cache
and its candidate checks remain unchanged.

Trusted preparation runs all three checks on the aggregate tree, creates
exactly one product and one metadata commit, then reruns all three on that final
candidate. Independent Python release verification rechecks shared
CRITICAL/scope/overlap policy, exact final decisions, every contribution,
two-commit ancestry and actual aggregate/prepared receipts. Preparation never
pushes or grants Deploy authority.

The focused native fixture is:

```powershell
$env:AVSWORKLOG_TEST_SKIP_DOTENV='1'
node .\node_modules\vitest\vitest.mjs run tests\unit\fixerrors-native-batch.test.ts
```

It uses disposable Ed25519 keys/replay storage, synthetic model decisions and
native worker artifacts, real Vitest/TypeScript/ESLint receipts and two actual
disposable commits. Two repairs plus two held clusters, stopped-prefix resume,
empty/read-only runs, lease/consent/cancellation/admission failures and evidence
tampering are covered. Separate cases verify isolated child bootstrap without
enrollment and real ESLint coverage of path 41.
The connected scenario captures 281 synthetic exact rows (280 new, one held)
across two shared capture pages, delivers an authenticated manifest larger than
96 KiB, resumes the server-confirmed prefix with a null-checkout heartbeat through
native `batch_main` framing, and verifies the final cross-language outcome hash
and all-row server completion. Its queue and capture SQL are in-memory fixtures;
native stdin/stdout framing is connected in-process. Separate Node transport
tests mock the spawned child, and lifecycle durability tests mock the application
database. These are not live HTTP, real PostgreSQL locking/crash, browser visual
or deployed-trace evidence.
No model, production queue, installed enrollment or release is invoked. A skip
because installed runner modules are missing is not passing native evidence.

The Debug route's Next output tracing includes only source-code extensions beneath
the allowed application roots and the exact checked-in knowledge JSON. Source-backed
projection rejects missing files and symlink resolution rather than trusting runtime
prose or route slugs. Config tests do not prove a built/deployed trace: the parent
must inspect the authorized build output and deployed read-only capture before activation.

Installation, SHA repinning, protected configuration, enrollment/consent and service
activation remain owner actions. Source tests and disposable fixtures do not grant
production execution authority or replace live acceptance and exact-candidate Deploy.

### Protected full-project TypeScript cache

Before requesting a repair, the owner must provision the fixed ordinary directory
`%USERPROFILE%\.codex\cursor-worker\squires-typecheck-cache`, outside the checkout
and worker candidate snapshot. Use an owner-only, inheritance-protected Windows
DACL: current Windows user owns it and is the only allowed principal, including
on its files. The helper checks ownership/ACLs at every use and rejects junctions,
symlinks, hard-linked artifacts and redirected ancestors. Protect the parent
directories, checkout, compiler and installed dependencies from untrusted writes
as well. This is not an OS sandbox against the enrolled Windows user.

For a **new directory only**, in an owner-controlled PowerShell:

```powershell
$cache=Join-Path $env:USERPROFILE '.codex\cursor-worker\squires-typecheck-cache'
if (Test-Path -LiteralPath $cache) { throw 'Existing cache requires owner inspection' }
New-Item -ItemType Directory -Path $cache -ErrorAction Stop | Out-Null
$id=[Security.Principal.WindowsIdentity]::GetCurrent().User
$acl=New-Object Security.AccessControl.DirectorySecurity
$acl.SetOwner($id)
$acl.SetAccessRuleProtection($true,$false)
$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($id,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
Set-Acl -LiteralPath $cache -AclObject $acl
```

With the companion stopped and the accepted clean checkout current, the parent
explicitly runs these fixed commands **before signed admission**:

```powershell
Set-Location -LiteralPath 'D:\Websites\avsworklog'
$env:AVSWORKLOG_TEST_SKIP_DOTENV='1'
node scripts\automation\fixerrors-typecheck-cache.mjs warmup
if ($LASTEXITCODE -ne 0) { throw 'Typecheck warmup failed' }
node scripts\automation\fixerrors-typecheck-cache.mjs ready
if ($LASTEXITCODE -ne 0) { throw 'Typecheck cache not ready' }
```

Warmup is trusted parent maintenance, never an enrolled worker check. The wrapper
accepts only `typecheck` with no paths and cannot warm a missing/stale cache.
The orchestrator checks readiness before either repair premium dispatch, including
the internal analysis stage, without changing budget preflights, admission,
leases or timeouts. Read-only review does not require this cache. All three genuine
post-metadata worktree receipts and both actual worker stages remain required.

A successful explicit review records hashes of its actual native request,
before/after snapshots, successful worker result and validated decision in
`.git/squires-fixerrors/reviewed-<packet SHA-256>.json`. A later repair may reuse
that investigation only for the identical packet and unchanged worktree. It
rechecks every artifact hash, the read-only result and current snapshot, then
validates the decision again. The new signed repair admission, durable replay
claim, local consent, fresh implementation budget preflight and all repair checks
remain mandatory. The earlier review is evidence, never repair or Deploy authority.
Changed or corrupted evidence fails closed; it is not silently replaced. Without
an existing review, repair performs its own real investigation, but may exceed
the unchanged deadline. Request and verify review first for the controlled live test.

Readiness hashes the exact cache bytes, project/extended configuration, compiler
and Node identities, lockfiles, consumed dependency files and their package
manifests, plus the project source candidate. Compiler runs recheck those inputs
before publication; source edits between checks are allowed, edits during a check
fail closed. TypeScript still discovers and checks the full project and its imports;
there is no changed-file compiler filter. New/unconsumed dependencies are checked
by TypeScript on first use, not claimed as previously cached evidence.
Installed dependencies (including any explicitly trusted fixture junction) remain
trusted local inputs; cache paths never accept links or caller overrides.

An exclusive lock serializes readiness, warmup and checks; no stale-lock stealing.
Each successful invocation fsyncs temporary compiler output and atomically renames
it and its matching manifest. An interrupted two-file publication leaves pending
state or a hash mismatch and cannot be used. Compiler diagnostics retain the
previous intact cache so a worker can repair and rerun, but return failure, never
a passing receipt. Missing cache, changed configuration/dependencies or a changed
pre-admission source candidate requires parent warmup. Tampering, pending files,
or a leftover lock requires owner investigation with all users stopped; do not
automatically delete locks or overwrite corrupted/orphaned state to force readiness.
Native crash/disk durability and real production warm/cold timings remain parent
acceptance checks; disposable compiler fixtures are not timing evidence.

### Parent installation, repinning and controlled live acceptance

These are **owner/parent operations, not authorization supplied by this document**.
First review/accept the staged code and its source candidate, resolve existing
work and stop the manually started companion by its known PID. Verify no child
remains; investigate any existing checkout/check/replay lock or prepared candidate,
never delete it to make the next command pass. Integrate the accepted source through
the parent's normal gates so the fixed checkout is clean `main` with the reviewed
scripts before any worker starts. Keep production queue activation and Deploy off.

Install the complete reviewed native runner distribution, not just its Python
files. In particular, `copilot_backend.py` requires its distribution's
`../references/premium-policy.md` relative to that module. Copy that exact reviewed
reference to the corresponding installed `references` directory and verify it
exists and matches the reviewed version before enabling either worker stage.
Do not invent a replacement policy or disable the lookup on a missing-file error.
Preserve native budget/account eligibility preflights.

Launch from an owner-controlled PowerShell. Reset any inherited PowerShell 7 or
editor-specific process-only module path to the trusted Windows
PowerShell defaults before launching Node, so nested PowerShell ACL probes and
runner processes do not resolve editor-specific module locations:

```powershell
$env:PSModulePath=@(
  (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'WindowsPowerShell\Modules'),
  (Join-Path $env:ProgramFiles 'WindowsPowerShell\Modules'),
  (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\Modules')
) -join ';'
```

Do not change machine/user persistent environment settings for this launch hygiene.
Provision and warm the protected TypeScript cache above before admission; source
integration, dependency installation or config changes can invalidate readiness.

For an existing enrollment, preserve its device/key/enrollment IDs and replay DB.
Do not rerun fresh provisioning or generate replacement keys. From an owner-controlled
PowerShell, with the accepted checkout at `D:\Websites\avsworklog`, use this explicit
installation/repin sequence (no secret is printed):

```powershell
$ErrorActionPreference='Stop'
$repo='D:\Websites\avsworklog'
$bridge=Join-Path $env:USERPROFILE '.codex\cursor-worker\squires-production-bridge'
$device=Join-Path $env:LOCALAPPDATA 'Squires\Fixerrors\production-device.dpapi'
$cfgPath=Join-Path $env:USERPROFILE '.codex\cursor-worker\squires-companion\enrollment.json'
$secure=Get-Content -LiteralPath $device -Raw | ConvertTo-SecureString
$b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $e=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) | ConvertFrom-Json }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
$cfg=Get-Content -LiteralPath $cfgPath -Raw | ConvertFrom-Json
if ((Get-FileHash -LiteralPath (Join-Path $bridge 'squires_companion.py') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $e.bridgeHashes[2]) {
  throw 'Existing admission verifier pin changed; investigate before installation'
}
if ((Get-FileHash -LiteralPath $cfg.releaseAdapter.script -Algorithm SHA256).Hash.ToLowerInvariant() -ne $cfg.releaseAdapter.sha256) {
  throw 'Existing release adapter pin changed; investigate before installation'
}
function Replace-PrivateJson($file,$text) {
  $pending=$file+'.reviewed-repin-pending'
  $stream=[IO.File]::Open($pending,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try { $bytes=[Text.Encoding]::UTF8.GetBytes($text); $stream.Write($bytes,0,$bytes.Length); $stream.Flush($true) }
  finally { $stream.Dispose() }
  [IO.File]::Replace($pending,$file,[System.Management.Automation.Language.NullString]::Value)
}
# Fail closed before changing executable files. These remain off after repinning.
$cfg.enabled=$false; $cfg.workerEligible=$false
$cfg.allowReadOnly=$false; $cfg.allowBoundedRepair=$false; $cfg.allowRelease=$false
Replace-PrivateJson $cfgPath ($cfg | ConvertTo-Json -Depth 20 -Compress)
foreach ($name in @('squires-windows-release.py','squires_release.py','squires_companion.py','squires_repair.py')) {
  Copy-Item -LiteralPath (Join-Path $repo ('scripts\automation\'+$name)) -Destination (Join-Path $bridge $name) -Force
}
$names=@('squires-windows-release.py','squires_release.py','squires_companion.py','squires_repair.py')
$e.bridgeHashes=@($names | ForEach-Object { (Get-FileHash -LiteralPath (Join-Path $bridge $_) -Algorithm SHA256).Hash.ToLowerInvariant() })
Copy-Item -LiteralPath (Join-Path $repo 'scripts\automation\squires-fap-adapter.mjs') -Destination $cfg.releaseAdapter.script -Force
$cfg.releaseAdapter.sha256=(Get-FileHash -LiteralPath $cfg.releaseAdapter.script -Algorithm SHA256).Hash.ToLowerInvariant()
$catalogue=[ordered]@{}
foreach ($id in @('targeted-tests','typecheck','lint')) {
  $catalogue[$id]=[ordered]@{argv=@($cfg.releaseAdapter.nodeExe,'scripts/automation/fixerrors-scoped-check.mjs',$id);timeout_seconds=120;description=('Trusted scoped '+$id)}
}
$cfg.checks=$catalogue
Replace-PrivateJson $cfgPath ($cfg | ConvertTo-Json -Depth 20 -Compress)
$cipher=($e | ConvertTo-Json -Depth 20 -Compress | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString)
Replace-PrivateJson $device $cipher
Remove-Variable e,secure,cipher,cfg -ErrorAction SilentlyContinue
```

Preserve owner-only ACLs and confirm all installed dependency files are the reviewed
runner version. Do not patch `parent_access`, budgets or enrollment verification.
A failed/partial repin is an owner-held disabled state, never permission to reset
enrollment or claims. For a genuinely new, separately approved device only, the
existing `provision-fixerrors-production-device.ts --prepare-local-production-enrollment
<absolute-python.exe>` prepares the four pins/check catalogue with every opt-in off;
registration and production activation are still separate owner operations.

The legacy controlled-packet helper creates no production records. Its clearly
labelled, application-unimported
`lib\utils\fixerrors-controlled-acceptance.ts` is exercised only by
`tests\unit\fixerrors-controlled-acceptance.test.ts`; its intentional `it.fails`
demonstrates a synthetic trim fixture. A repair must change that fixture function
to trim both ends and remove `it.fails`, preserving the expected value. It is not
an application defect or evidence about customer incidents. It no longer supplies
production Debug requests: those always capture current evidence. Do not create a
fixed-checkout synthetic packet as a connection prerequisite. Existing manual
packets require one-time parent reconciliation, never automatic replacement.

For future live acceptance follow the everyday workflow above, after separate
approval of production persistence permissions, TLS/CA, issuer and device
registration. Require a genuine premium read-only run with no checkout changes,
then an independently opted-in bounded repair, two local prepared commits and
real post-metadata receipts. Held, revoked, expired, partial or over-budget work
is not successful acceptance. Only separately approved exact-candidate Deploy may
push; require the matching approved SHA and deployment ID on the fixed live origin
before claiming deployed. Native PostgreSQL fault tests and real worker/release
acceptance remain parent-owned; synthetic fixtures do not substitute for them.

## Windows terminal/service manager

`scripts\automation\windows-runner` supplies an opt-in manager for the existing
production companion, not another queue, worker transport or release authority.
The small .NET Framework host uses native Windows APIs because a detached
PowerShell process is not an SCM service and does not reliably contain its tree.
It requires 64-bit Windows 10/11 (atomic process-to-Job assignment), the installed
Framework compiler, Node and the existing accepted checkout/dependencies.

After reviewing these sources, the parent can inspect the default, non-mutating
installation plan, then separately install from an **elevated Windows PowerShell
as the same enrolled `MPDEE-SERVER\mattd` account**:

```powershell
& 'D:\Websites\avsworklog\scripts\automation\windows-runner\Install.ps1'
# Explicit parent-approved installation only:
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File 'D:\Websites\avsworklog\scripts\automation\windows-runner\Install.ps1' -Install
```

The installer resolves the account SID and real profile; it never hardcodes a SID.
A new service requires a secure same-account Windows password prompt. The password
is passed directly to Windows SCM via zeroed unmanaged memory, never argv, JSON,
environment or logs. If `SeServiceLogonRight` is absent, installation requires the
parent's separate `GRANT` confirmation; it never silently grants that right.
Cancellation or partial installation is a held state for owner reconciliation,
not automatic rollback, removal or re-enrollment.

The administrator-owned, protected package is installed at
`C:\Program Files\Squires\FixerrorsRunner`, with owner-only lifecycle data under
the real profile's `.codex\cursor-worker\squires-runner-manager`. Existing package,
parent-directory, account/configuration and private-data ACL drift fail closed.
Close every manager/console and stop the service before an update. The installer
refuses unrelated services or Desktop files. It adds **Squires Runner.cmd** to
the owner's Desktop, pointing to the absolute installed launcher; working
directory does not matter. It does not start the service or change enrollment,
production flags, packet, keys, replay storage or existing check/release gates.

Run the Desktop launcher **without elevation**. Its actions are:

| Action | Behaviour |
| --- | --- |
| 1 Terminal | Opens a standard Windows PowerShell console hosting the companion; closing it stops its contained tree. |
| 2 Service | Starts the genuine `SquiresFixerrorsRunner` SCM service with the selected runtime permission. |
| 3 Stop | Stops the authenticated managed host and its Job Object descendants, waits for confirmation and reports retained locks. |
| 4 Status | Reads public enrollment booleans, actual SCM state and authenticated running/readiness state; never decrypts credentials or writes control-plane state. |
| E Owner consent | With all hosts stopped, explicit typed confirmation atomically changes only existing enrollment opt-ins, preserving ACLs and unrelated fields; no job or release approval. |

The service is **Manual**, with no triggers, recovery restart, scheduled task or
autostart. It runs as the enrolled owner, loads that owner's profile for DPAPI and
creates a verified non-admin, medium-integrity companion token. The privileged
host does not execute companion code under its own unrestricted token. Child
startup uses a dedicated non-interactive window station and desktop, with protected
owner/System permissions and medium integrity. It never changes the interactive
desktop's permissions. The private objects remain until the contained tree stops;
native child initialization failures record only a numeric exit code.
Only the reduced token's default object ACL is set to the enrolled owner and
System and read back before launch; the privileged service token is unchanged.
Child
environment comes from Windows' owner environment with an explicit safe allowlist,
fixed PowerShell/Git paths and no inherited editor/model/Node injection variables.
Existing protected opt-ins remain authoritative: a running host can be
`idle-enrollment-disabled`, with **no child and ready=false**.

Review is the runtime default. Repair requires its own runtime choice plus the
existing protected repair opt-in. Deploy-capable mode can start and wait before
a candidate exists. An actual deployment still requires the protected release
opt-in, a tested candidate, exact-candidate Debug consent, signed admission, genuine receipts,
budget and release gates. Runtime permission is not job or Deploy approval.

A cross-session mutex prevents simultaneous terminal/service hosts. A local-only,
ACL-protected named pipe accepts only status/stop from the enrolled owner or
System; clients verify the server's fixed executable using limited process-query
rights. Connected/waiting readiness requires a clean checkout, an available
trusted bridge, a successful companion heartbeat and telemetry younger than
**15 seconds**. Missing IPC with
a matching executable is **running/unresponsive, not stopped**. Readiness is not
proof of a successful worker, available budget or release approval. No packet is
needed merely to connect. Each action independently checks its signed packet or
exact prepared candidate. Prepared work holds fresh review/repair but can enter
separately approved Deploy. Stale/uncertain packets are held, never regenerated
by status or overwritten by another job.

The child is atomically assigned to a non-inheritable kill-on-close Job Object
at creation, remains suspended until membership is checked, and cannot break away.
Normal stop asks the companion to abort, then enforces bounded whole-tree
termination. Host death closes the Job Object too. An interrupted claimed job is
never acknowledged as success; uncertain execution retains the checkout lock for
owner investigation. Idle cleanup checks the held lock's file identity and will
not delete a replaced lock. The manager never deletes stale locks or guesses that
an arbitrary Node/Python process belongs to this runner: unverifiable/unmanaged
processes are not killed, and unresolved locks prevent a clean-stop claim.
Only fixed lifecycle codes are logged; child output and exception text are not
copied into logs. The optional log menu and Debug link confer no extra authority.

Focused offline verification (no installed service, enrollment or live job):

```powershell
& .\scripts\automation\windows-runner\Test-Runner.ps1
$env:AVSWORKLOG_TEST_SKIP_DOTENV='1'
npx vitest run tests\unit\fixerrors-fresh-evidence.test.ts tests\unit\fixerrors-companion.test.ts tests\unit\fixerrors-companion-packet.test.ts tests\integration\api\fixerrors-local-route.test.ts tests\ui\fixerrors-control-panel.test.tsx
npx eslint scripts\automation\fixerrors-companion.ts tests\unit\fixerrors-companion.test.ts
```

Native fixtures compile production/fixture hosts with warnings as errors and use
only GUID-named disposable directories and fake children. They cover restricted
tokens, owner-consent flag/ACL preservation and refusal paths, packet-free waiting,
disabled/idle status, clean owner environment, freshness, duplicate hosts,
authenticated stop, real descendant termination, abrupt host death, real
`CTRL_BREAK`, redaction, installer/service plans and PowerShell parsing. Where
the noninteractive desktop does not deliver an actual console-window Close, the
fixture invokes the same native close handler and labels that limitation; it
does not claim interactive Close acceptance. Parent-approved real installation,
SCM start/stop, service-logon/profile/DPAPI access, terminal Close in the owner's
desktop, logoff/reboot behaviour and genuine worker cancellation remain separate
Windows acceptance gates. No service or production activation is performed by
these checks.
