# Timesheet `/process` Manager Approved server lock

Independent CRITICAL plan for `POST /api/timesheets/[id]/process`.

Baseline: `main` @ `c8e9020b` (release `0926.3.0`).
Workstream: `ws_303cb13a69947b08` — new lineage. Do not attach to `ws_8a2f4c91e6b03d17`, `ws_96e9f347f9da5b8f`, or the FD-FALSE-ABSENT successor.

Naming: the product label for this gate is **Manager Approved**. “Accounts Manager” in live code means Accounts team + `manager`/`supervisor` role. That role already owns **Payroll Received** on `/approve`. This plan locks `/process` to the Manager Approved actor rule the UI already uses.

No implementation, protocol init, deploy, or push in this planning pass.

## Classification

- Lane: CRITICAL.
- Risk: high.
- Reason: live server authorisation for a timesheet approval gate. Hiding a button is not security.
- Task type: change, after this plan is approved.
- Workstream: `ws_303cb13a69947b08`.
- routingDecision: economical_default.
- Parent: current economical parent. Stay Agent until the architecture gate is approved, then implement on the same economical default.
- Do not reopen Timesheet Submit or Approvals UI/product work. Shared helpers may gain a sibling function; payroll and submit behaviour must not change.

## Plain-English problem

Two independent stamps exist on a submitted timesheet:

1. **Payroll Received** — Accounts have taken the week. Server already checks this on `/approve`.
2. **Manager Approved** — a team manager has signed the week. The UI already hides this from Accounts. The `/process` API does not.

Anyone who can authorise a timesheet (Approvals level 3+ and in scope), including an Accounts Manager or Accounts Supervisor, can call `/process` directly and set Manager Approved. The mutation then runs with a privileged database connection, so row-level security never gets a second vote.

## Current behaviour

End-to-end today:

browser button or raw `POST`
→ `app/api/timesheets/[id]/process/route.ts`
→ `supabase.auth.getUser()` then `getEffectiveRole()` (app session / effective View As role)
→ load target with the admin client
→ `canCurrentActorAuthoriseTimesheetTarget` only
→ `applyTimesheetManagerApproved` over direct Postgres (`POSTGRES_URL_NON_POOLING`)

Who can call `/process` today, if they pass login and Approvals level 3+:

| Actor | Result today |
| --- | --- |
| Team manager / supervisor with team or all authorise, in scope | Allowed |
| Accounts Manager or Accounts Supervisor (Accounts override) | Allowed — this is the hole |
| Admin / Super Admin | Allowed |
| Ordinary employee, or Approvals below level 3 | Rejected |
| Same person as the timesheet owner | Rejected (no self-authorise) |
| Authoriser outside team scope, unless they have all-scope or Accounts/admin override | Rejected |
| No login / no effective user | Rejected (401) |

The endpoint does more than flip a flag. It:

- sets `manager_approved_at` / `manager_approved_by` on first success
- moves `submitted` → `manager_approved`, or `approved` → `processed` (Complete)
- sets `processed_at` when the status becomes `processed`
- is a no-op success when Manager Approved is already present (`manager_approved` or `processed`)
- does **not** set Payroll Received fields, does **not** build a payroll snapshot, and does **not** write a separate history/notification row

Weakness type: missing Manager Approved role check + overly broad reuse of the shared authoriser helper + server/UI mismatch. Not an RLS write-path gap for this API (the write bypasses RLS). Not a wrong mutation target (`/process` already calls `applyTimesheetManagerApproved`).

Existing test `PAY-PROCESS-MANAGER-001` currently encodes the hole: it asserts `/process` uses authorise scope and must not use the payroll-received helper.

## Intended behaviour

Mirror the already-shipped Approvals actor split. Do not invent a new role matrix.

| Actor | `/process` (Manager Approved) | `/approve` (Payroll Received) — unchanged |
| --- | --- | --- |
| Scoped team manager / supervisor (not Accounts override) | Allow | Reject |
| Other scoped authoriser who is not admin and not Accounts override | Allow (same residual as UI `actorKind: 'manager'`) | Reject |
| Accounts Manager / Accounts Supervisor, not admin | Reject | Allow (already) |
| Admin / Super Admin, including on the Accounts team | Allow (explicit override) | Allow (already) |
| Ordinary employee | Reject | Reject |
| Unauthenticated / invalid or expired session / no effective user | Reject | Reject |
| Self / out of scope | Reject | Reject |

Admin override is explicit and already used for Payroll Received via `hasEffectiveRoleFullAccess`. Accounts team + admin stays admin, not Accounts-only.

The two gates stay independent. A successful `/process` must not set Payroll Received. A rejected `/process` must not change either gate.

View As keeps using the effective role already returned by `getEffectiveRole()`. Client body fields (`role`, `user_id`, and similar) are never authority. `expected_status` stays an optimistic concurrency check only.

Residual that evidence already supports and this plan will not tighten: an Accounts **employee** (role name `employee`) is not an Accounts override. If they somehow have authorise scope, the shipped UI treats them as manager-kind. Do not invent a ban.

## Authoritative role/permission source

Canonical sources, in order:

1. Live UI contract: `resolveApprovalsActorKind` + `getTimesheetApprovalActionVisibility` in `lib/utils/approvals-action-visibility.ts`. Manager Approved is shown to admin or manager-kind; hidden from Accounts-only. Detail page: `canMarkAsProcessed = showManagerApproved && canAuthoriseThisTimesheet`.
2. Accounts override definition: `hasAccountsTimesheetFullVisibilityOverride` — team name `Accounts` and role name `manager` or `supervisor`. Same rule in SQL `effective_accounts_timesheet_full_visibility_override()`.
3. Payroll Received server lock (the other gate, already done): `canCurrentActorMarkTimesheetPayrollReceived` on `/approve`.
4. Operator FAQ `timesheet-statuses`: “Only Accounts/Admin can mark [Payroll Received]”; “Manager Approved — a manager has signed the week”; “Team managers never see Payroll Received.”
5. Help copy in `scripts/help/faq-catalogue/articles-core.ts` matching that FAQ.

`PRODUCT.md` does not define this matrix. Do not treat older “any authoriser may process” source-scan tests as product authority.

## Architecture gate

- Status: approved with conditions by independent architecture-gate `0fcb18d7-8e6e-4bae-9ea4-774ae1783e0e`.
- Source: independent premium architecture-gate subagent.
- Proven identity: `(admin OR manager) AND C` = `C AND (A OR NOT X)` where `C` is scoped authorise, `A` is `hasEffectiveRoleFullAccess`, `X` is Accounts manager/supervisor override. One effective-role snapshot. Residual Accounts employee with authorise stays ALLOW.
- The reviewer must confirm the matrix above, especially: `/process` is Manager Approved, not Payroll Received; Accounts Manager/Supervisor are denied; admin override remains; `/approve` and submit are untouched.
- Operator addendum (approved): the server allow rule must be **proven equivalent** to the shipped UI/product Manager Approved rule. Do not implement the final authority as merely `admin OR not Accounts override` unless this gate proves that, together with the existing scoped-authoriser check, it is exactly that intended set.
- Prefer one canonical server helper `canCurrentActorMarkTimesheetManagerApproved(...)` (or the existing local naming equivalent) that is authoritative. UI stays presentation only.
- Required helper semantics to prove and then implement:
  - scoped legitimate Manager Approved actor → allow
  - Accounts Manager / Accounts Supervisor without admin override → deny
  - Admin / Super Admin → allow
  - ordinary employee / insufficient authoriser → deny
  - out-of-scope actor → deny
  - unauthenticated / invalid session → deny (route 401 before mutation)
- Explicitly keep and test the residual Accounts **employee** case: do not silently broaden or narrow it versus the shipped UI.
- Proposed conditions for the gate to lock:
  - Authorisation fails closed before `applyTimesheetManagerApproved`.
  - One canonical Manager Approved helper is the server authority. Do not reuse `canCurrentActorMarkTimesheetPayrollReceived` as the allow rule.
  - Do not change mutation SQL, status transition rules, or idempotency unless a defect is proven in this path.
  - Do not migrate `/process` onto the newer Timesheet Submit session helper. Keep `getUser()` + `getEffectiveRole()`.
  - No schema/RLS/migration unless the gate finds a shared write contract that this API actually uses. Current evidence says none.
  - Rewrite `PAY-PROCESS-MANAGER-001` to the new contract; do not leave it asserting the hole.
- Re-plan only if this architecture/scope materially changes.

## Recommended build model

- Implementation: economical Cursor Grok default after the architecture gate. The coding change is mechanical once the matrix is approved.
- Mandatory premium gates: architecture-gate before implementation; premium final-diff after frozen-candidate verification.
- Switch timing: not applicable; parent is already economical.
- Execution mode: Agent. One authorisation contract; no parallel implementation streams.
- Fallback: stop and report if the gate rejects the matrix, or if implementation would need submit/approvals/RLS/payroll contract changes.

## Implementation contract

### Invariants

- Server authorisation is authoritative. Hiding the Manager Approved button is not security.
- A user must not gain Manager Approved by calling `/process` directly.
- Payroll Received and Manager Approved stay independent unless a later product rule says otherwise. This plan does not say otherwise.
- Do not broaden manager or admin permissions. Do not give Accounts Manager/Supervisor Manager Approved.
- Do not trust client-supplied role, user id, or access level.
- Keep the existing login / session / `getEffectiveRole()` checks.
- Failed authorisation (401/403) must not call the mutation and must leave both gates unchanged.
- Valid scoped manager-kind and admin processing must still work, including `submitted` → `manager_approved` and `approved` → `processed`.
- Existing complete / conflict / stale-status behaviour stays: processed or already Manager Approved is idempotent success; draft/rejected/adjusted and stale `expected_status` stay fail-closed without a write.
- Audit remains the timesheet columns `manager_approved_by` / `manager_approved_at` (first actor wins via `COALESCE`). Do not add a new history table or notification in this task.
- Do not launch a third premium review for the same CRITICAL continuation. Routing or split does not reset this budget.
- The active descendant owns remaining work. After two failed premium rounds, remaining work is routing, isolation, or proven removal from release — not another normal final-diff pass. A split child inherits the lineage-scoped budget and must not re-enter `initialized` / preflight to mint a new `first` review.

### Boundaries

- In scope: `/process` route, sibling Manager Approved helper next to the existing payroll helper, targeted tests, and the `PAY-PROCESS-MANAGER-001` contract rewrite.
- Out of scope: Approvals UI polish, Timesheet Submit RLS/session work, Scheduling, workflow/TEE runtime, unrelated auth cleanup, `/approve`, `/reject`, payroll-edit, absence process, FAQ copy unless a test forces a source-scan mention.
- Do not attach this lineage to completed release-blocker workstreams.
- No production data change. No deploy. Push only if a later user phrase authorises it.

### Rollback

- Revert the implementation commit(s) on this branch. No migration is planned, so revert restores the previous (over-broad) `/process` lock and nothing in the database.
- If a migration is later required by the architecture gate, it must be a new forward file with its own rollback note; do not edit applied dual-gate or submit migrations.

### Migration / RLS / audit

- Migration: none expected. The write already uses direct Postgres after application authz.
- RLS: none expected for this lock. Authoriser UPDATE policies already stop at draft/rejected; this API is the write path for Manager Approved.
- Audit: keep `manager_approved_by` / `manager_approved_at` / `processed_at` behaviour. No separate audit row exists on this path today; do not invent one.

## Required tests

Stable IDs. Exercise the real `POST` handler in `app/api/timesheets/[id]/process/route.ts` (auth → authorisation → mutation mock or equivalent), not only isolated helpers. Helper unit tests may support, but cannot replace, the route IDs.

1. `TS-PROC-MANAGER-ALLOW-001` — intended manager-kind authoriser can process.
2. `TS-PROC-EMPLOYEE-DENY-001` — ordinary employee cannot process.
3. `TS-PROC-ACCOUNTS-DENY-001` — Accounts Manager/Supervisor (non-admin) cannot process.
4. `TS-PROC-ADMIN-ALLOW-001` — admin / Super Admin can process (explicit override), including admin on Accounts.
5. `TS-PROC-UNAUTH-001` — unauthenticated request is 401 and does not mutate.
6. `TS-PROC-SESSION-001` — invalid/expired session or missing effective user is 401 and does not mutate.
7. `TS-PROC-UI-BYPASS-001` — direct API call by an Accounts-only actor cannot bypass the hidden UI action.
8. `TS-PROC-REJECT-NO-MUTATE-001` — 401/403 leaves Manager Approved and Payroll Received unchanged (mutation not called).
9. `TS-PROC-MUTATE-MANAGER-GATE-001` — success changes only the Manager Approved gate/state (`manager_approved_*`; status `manager_approved` or `processed` as the current gate function already defines).
10. `TS-PROC-PAYROLL-INDEPENDENT-001` — Payroll Received fields stay untouched; `/approve` still requires the payroll-received helper.
11. `TS-PROC-COMPLETE-001` — already `processed` / already Manager Approved stays idempotent; no rewrite of `manager_approved_by`.
12. `TS-PROC-SCOPE-001` — out-of-team / all-scope miss / self is 403.
13. `TS-PROC-CLIENT-IDENTITY-001` — body `user_id` / `role` / similar cannot override server authority; actor comes from session / `getEffectiveRole()`.
14. `TS-PROC-AUDIT-001` — successful write records `manager_approved_by` as the effective session actor.
15. `TS-PROC-REGRESSION-001` — valid manager workflow still works (`submitted` → `manager_approved`, `approved` → `processed` when payroll is already set).
16. `PAY-PROCESS-MANAGER-001` — source-scan rewritten: `/process` uses the canonical Manager Approved helper; it still must not treat payroll-received as the allow rule.
17. `TS-PROC-ACCOUNTS-EMPLOYEE-001` — Accounts role=`employee` (not manager/supervisor override) matches the shipped UI residual: allow only when they are a scoped authoriser (manager-kind); deny without authorise scope. Do not silently broaden or narrow.
18. `TS-GATE-001` — existing Manager Approved status-machine cases stay green.
19. `TS-GATE-004` — existing stale `expected_status` fail-closed mutation case stays green.

## Implementation sequence

After operator approval only:

1. `npx tsx scripts/workflow-protocol.ts init --workstream ws_303cb13a69947b08 --plan plans/timesheet-process-manager-approved-lock.md --base-commit c8e9020b890fb8d414422201b1dbdcefa611eabf`
2. Independent architecture gate. Record result on the workstream. Do not implement if blocked.
3. Add one canonical helper `canCurrentActorMarkTimesheetManagerApproved` whose allow-set the architecture gate has proven equivalent to the shipped UI Manager Approved rule (scope + actor kind). Do not ship a loose `admin OR not Accounts override` shortcut unless that proof is recorded.
4. In `/process`, fail closed with 401/403 from session + that helper before `applyTimesheetManagerApproved`. Do not parse the client as authority.
5. Rewrite `PAY-PROCESS-MANAGER-001`. Add `tests/unit/timesheet-process-route.test.ts` (follow `timesheet-payroll-edit-route.test.ts`).
6. Focused vitest for the new/changed files, then freeze the candidate and complete every required ID.
7. One bounded economical challenge (V2.4.1 eight categories, single pass + one repair + one re-check).
8. Compact premium-review-packet. Premium `first` review. Closure only if first genuinely fails.
9. Local commit after the change is complete. `npm run finalise` only when asked. No push and no deploy unless a later authorised phrase says so.

## Verification

- Deterministic route + helper tests for every required ID.
- Typecheck if TypeScript contracts in `lib/utils/timesheet-visibility.ts` / `lib/server/timesheet-approval-scope.ts` change.
- No application production build unless the user authorises a test build.
- Browser check is not the security proof. Optional later acceptance: confirm the Manager Approved button still works for a team manager and stays hidden for Accounts.

## Economical challenge focus

Before premium final-diff, one bounded challenge. For this task, look hardest at:

- Validation before authority-changing mutation (403/401 before `applyTimesheetManagerApproved`).
- Producer → consumer symmetry (UI actor kinds vs server helpers; `/approve` vs `/process`).
- Client identity override and View As effective role.
- Complete Git candidate scope (do not silently edit submit/approvals/UI).
- Evidence convergence on the same HEAD/fingerprint after tests.

The challenge is not approval and does not consume a premium review round.

## Final review

- Independent premium final-diff after every required ID is completed or explicitly unresolved.
- Reviewer starts from a compact packet and may inspect any relevant file. Packet green is not a pass.
- Surfaces: `/process` route, new helper, `/approve` left unchanged, mutation helper left unchanged unless proven, tests, `PAY-PROCESS-MANAGER-001`.
- Bounded `two-pass-v1`: first review; at most one consolidated blocker-family fix; one closure review.
- Do not launch a third premium review for the same CRITICAL continuation. Routing or split does not reset this budget.
- After two failed premium rounds the lineage is `routing_required`. That state is terminal for the normal review loop and is not `finalised`, `review_closed`, or `finalise_ready`.

Happy path to aim for: plan approval → architecture gate → implementation → focused tests → frozen candidate → complete required verification → one economical challenge → compact packet → premium first PASS → finalise.

## Commit and handoff

- Commit: pending until implementation is finished; then local commit and authorised mutating finalise.
- Handoff: pending.
- Finalise: after successful review, `status --blocking`, dry-run, `finalise-start`, then mutating `npm run finalise`. Report `docs_private/automation/runs/finalise/*.md`.
- Push: authorised by the operator for a normal fast-forward to `origin/main` after successful finalise. No deploy.
- Before push: state branch, commits, and files.

<!-- plan-contract-marker:v1
{
  "schemaVersion": "1",
  "registryVersion": "2",
  "workstreamId": "ws_303cb13a69947b08",
  "taskId": "timesheet-process-manager-approved-lock",
  "taskType": "change",
  "risk": "high",
  "initialParentTier": "economical",
  "routingDecision": "economical_default",
  "recommendedBuildModel": {
    "implementation": {
      "role": "economical-default",
      "tier": "economical",
      "family": "cursor-grok"
    },
    "premiumGates": [
      {
        "phase": "architecture-gate",
        "role": "premium-architecture-gate",
        "tier": "premium",
        "mandatory": true
      },
      {
        "phase": "final-diff-reviewer",
        "role": "premium-final-review",
        "tier": "premium",
        "mandatory": true
      }
    ],
    "switchTiming": "not_applicable",
    "rationale": "Current parent is already economical. Implementation is mechanical after the architecture gate confirms the Manager Approved actor matrix.",
    "fallbackEscalation": "Stop and report if the architecture gate rejects the matrix or if implementation would change submit, Approvals UI, payroll-received, RLS, or schema contracts."
  },
  "architectureGate": "approved_with_conditions",
  "architectureReviewSource": "independent_subagent",
  "independentReviewRequired": true,
  "independentReviewReasons": [
    "server-authorisation-boundary",
    "timesheet-approval-gate-mismatch"
  ],
  "requiredTests": [
    { "id": "TS-PROC-MANAGER-ALLOW-001", "status": "unresolved" },
    { "id": "TS-PROC-EMPLOYEE-DENY-001", "status": "unresolved" },
    { "id": "TS-PROC-ACCOUNTS-DENY-001", "status": "unresolved" },
    { "id": "TS-PROC-ADMIN-ALLOW-001", "status": "unresolved" },
    { "id": "TS-PROC-UNAUTH-001", "status": "unresolved" },
    { "id": "TS-PROC-SESSION-001", "status": "unresolved" },
    { "id": "TS-PROC-UI-BYPASS-001", "status": "unresolved" },
    { "id": "TS-PROC-REJECT-NO-MUTATE-001", "status": "unresolved" },
    { "id": "TS-PROC-MUTATE-MANAGER-GATE-001", "status": "unresolved" },
    { "id": "TS-PROC-PAYROLL-INDEPENDENT-001", "status": "unresolved" },
    { "id": "TS-PROC-COMPLETE-001", "status": "unresolved" },
    { "id": "TS-PROC-SCOPE-001", "status": "unresolved" },
    { "id": "TS-PROC-CLIENT-IDENTITY-001", "status": "unresolved" },
    { "id": "TS-PROC-AUDIT-001", "status": "unresolved" },
    { "id": "TS-PROC-REGRESSION-001", "status": "unresolved" },
    { "id": "PAY-PROCESS-MANAGER-001", "status": "unresolved" },
    { "id": "TS-PROC-ACCOUNTS-EMPLOYEE-001", "status": "unresolved" },
    { "id": "TS-GATE-001", "status": "unresolved" },
    { "id": "TS-GATE-004", "status": "unresolved" }
  ],
  "unresolvedRisks": [
    {
      "id": "accounts-employee-residual",
      "note": "Accounts role=employee is not the Accounts override. If such a user has authorise scope, shipped UI treats them as manager-kind. This plan does not invent a tighter ban."
    },
    {
      "id": "auth-helper-left-unchanged",
      "note": "Process keeps getUser plus getEffectiveRole and is not migrated onto the newer Timesheet Submit session helper."
    },
    {
      "id": "R-DETAIL-ACTOR-SOURCE-001",
      "note": "Detail page may classify Accounts from nullable effectiveRole; server remains authoritative. UI fix is out of scope."
    },
    {
      "id": "R-EMPLOYEE-AUTHORISER-001",
      "note": "Delegated employee-role authorisers remain allowed to match shipped actor-kind semantics."
    }
  ],
  "finalReviewRequired": true,
  "finalReviewSource": "independent_subagent",
  "commit": "pending",
  "handoff": "pending",
  "reviewClosureProtocol": "two-pass-v1",
  "implementationContract": {
    "invariants": [
      "Server authorisation is authoritative; hidden UI is not security.",
      "canCurrentActorMarkTimesheetManagerApproved must be proven equivalent to the shipped UI Manager Approved allow-set.",
      "Direct /process must not grant Manager Approved to Accounts-only or non-authorising actors.",
      "Payroll Received and Manager Approved remain independent.",
      "No broadening of manager or admin permissions.",
      "Client-supplied identity or role is not authority.",
      "Existing getUser and getEffectiveRole checks remain.",
      "Failed authorisation does not mutate either gate.",
      "Valid manager-kind and admin processing continues to work.",
      "Complete, conflict, and stale-status behaviour remains fail-closed or idempotent as today.",
      "Audit remains manager_approved_by/at on the timesheet row.",
      "Do not launch a third premium review for the same CRITICAL continuation. Routing or split does not reset this budget.",
      "The active descendant owns remaining work. After two failed premium rounds, remaining work is routing, isolation, or proven removal from release — not another normal final-diff pass."
    ],
    "boundaries": [
      "Only /process authorisation, sibling helper, and targeted tests.",
      "Do not change Approvals UI, Timesheet Submit, Scheduling, workflow runtime, /approve behaviour, or payroll-edit.",
      "Do not attach to completed release-blocker workstreams.",
      "No migration or RLS change unless architecture proves a shared write contract.",
      "No deploy. Fast-forward push to origin/main is authorised after successful finalise."
    ],
    "rollback": "Revert the implementation commit(s). No database rollback is required if no migration is added."
  }
}
-->
