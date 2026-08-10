# Token-Efficient Engineering V2 Implementation Plan

Prepared from `avsworklog-llm-review-bundle-2026-08-10T15-34-03Z.zip`.

## 1. Objective

Reduce the fixed workflow cost of simple and moderate coding tasks while preserving the existing high-quality controls for database, security, permissions, money, production data, migrations, concurrency, irreversible operations, and broad regression risk.

The guiding rule for V2 is:

> Use the lightest execution lane that can safely prove the requested change is correct. Escalate on evidence, not merely because the task is substantive.

This migration is primarily a rules, skills, commands, automation, and verification refactor. It must not change application behaviour, production data, database schema, or business logic except where automation code itself needs adjustment.

---

## 2. Problems V2 must solve

The current system has several sources of fixed overhead:

- The global TEE User Rule and global TEE Skill both contain substantial overlapping procedure.
- Squires adds another always-loaded TEE rule containing much of the same procedure.
- `.cursorrules` is legacy and contains an unrelated Lyra prompt-optimisation framework, mandatory conversation behaviour, and duplicated engineering rules.
- `createinvoice.mdc` and `finalise-commands.mdc` are `alwaysApply: true` even though they only matter for explicit commands.
- All substantive work, including very small UI edits, is routed through TEE.
- Routine work under a premium parent can trigger a model-switch question even when switching models costs more time than the task itself.
- A single low-severity characteristic such as shared layout can trigger premium review.
- The `minimal-diffs` rule requires refactoring any file over 800 lines before a feature edit. The bundle contains many such files, so a local change can expand into an unrelated refactor.
- Finalise currently encourages `fix -> rerun complete finalise -> fix -> rerun complete finalise` loops.
- Non-protocol finalise reuse relies partly on recent-run/mtime heuristics rather than exact input fingerprints.
- High-risk review preflight runs full repository ESLint even when the review concerns a small changed scope.
- Workflow self-review runs after only five qualifying tasks.
- Stop-hook processing performs more work synchronously than is necessary for normal task completion.
- `fixerrors` treats the report as one workflow instead of routing independent error clusters by risk.
- Large volumes of historical automation logs remain available to normal Cursor indexing/search even when a deterministic script is the better consumer.
- The workflow completion marker is disproportionately large for trivial work.

V2 should address these without weakening critical safeguards.

---

# 3. Target architecture: Global versus Squires-only

## 3.1 Global layer

The global layer must contain only behaviour that is useful across all software projects.

### Global User Rule

Keep the Cursor User Rule very small because it is always added to context.

Recommended replacement:

```text
For codebase-specific implementation, debugging, planning, testing, refactoring, migration, or review work, use the `token-efficient-engineering` Skill when relevant. Before substantive work, choose the lightest safe lane: FAST, STANDARD, GUARDED, or CRITICAL. Escalate only when scope, risk, failures, or uncertainty justify it. CRITICAL includes persistence/migrations, auth/security/permissions, money, concurrency, irreversible operations, production-data risk, broad regression risk, or explicit user request. Keep context narrow, verify deterministically, and never weaken safety or required tests to save tokens. Project rules and explicit user instructions take precedence.
```

Do not put detailed procedures, marker schemas, model lists, finalise instructions, Git rules, project migration rules, or planning templates in the global User Rule.

### Global Skill

Keep one global `token-efficient-engineering` skill as the reusable procedural source of truth.

Expected location should be discovered rather than assumed. A likely Windows location is under the user's Cursor skills directory, but the implementation must inspect the live Cursor environment and locate the actual active skill before writing.

The current bundled skill snapshot has SHA-256:

`69347ed86fd082932eadac05734dcf9bc3d73208e951906d8732492fe97417b0`

The current bundled User Rule snapshot has SHA-256:

`7edd2c04200f6e2fb52fe6360352ed35960c01882b7e902a83bd3dae20158ce9`

If the live global skill differs from the bundled snapshot, inspect and merge the differences rather than overwriting blindly.

### Global Skill responsibility

The V2 Skill should own:

- the four-lane classifier;
- generic context discipline;
- generic model/subagent routing;
- generic planning requirements by lane;
- deterministic verification order;
- review escalation rules;
- compact/full completion evidence rules;
- generic repair-loop behaviour;
- rules for escalating a task between lanes.

It must not own:

- Squires migration commands;
- Squires production DB assumptions;
- Squires commit/push phrases;
- Squires `finalise`, `fixerrors`, invoice, or cleanup commands;
- Squires page-shell/tab styling;
- Squires-specific test commands.

---

## 3.2 Squires project layer

The Squires repository should contain only Squires-specific policy and reusable explicit commands.

Target structure:

```text
.cursor/
  commands/
    finalise.md
    fap.md
    finalise-full.md
    ffap.md
    fixerrors.md
    createinvoice.md
    workflow-review.md
    cleancodebase.md
  rules/
    squires-core.mdc
    database-migrations.mdc
    app-page-shell.mdc
    tabs-styling.mdc
    [other genuinely scoped rules]
  hooks/
    workflow-stop.mjs
```

The following current files should be removed or replaced as part of the migration:

- `.cursorrules` -> remove after preserving any still-useful Squires-specific requirements.
- `.cursor/rules/token-efficient-engineering.mdc` -> remove, or replace with an extremely small Squires override only if a project bridge is still demonstrably needed.
- `.cursor/rules/finalise-commands.mdc` -> migrate into commands.
- `.cursor/rules/createinvoice.mdc` -> migrate into a command.
- `.cursor/rules/fixerrors.mdc` -> migrate into a command.
- `.cursor/rules/workflow-review.mdc` -> migrate into a command.
- `.cursor/rules/cleancodebase.mdc` -> migrate into a command.
- `.cursor/rules/minimal-diffs.mdc` -> remove duplication or replace with a short scoped rule that does not force refactoring based on file length.

Keep `app-page-shell.mdc` and `tabs-styling.mdc` as scoped project rules because they are compact and tied to relevant files.

---

# 4. Four execution lanes

## FAST

Use FAST when all of the following are true:

- the change is local and reversible;
- normally one or two files, occasionally three tightly related files;
- there is no database/persistence/schema/migration effect;
- there is no auth, security, permission, money, concurrency, production-data, or irreversible effect;
- it does not intentionally change a shared behavioural/public contract;
- it does not add a dependency or alter global build/runtime configuration;
- the expected fix is obvious or follows an immediately visible local pattern;
- deterministic focused verification is available.

Typical FAST work:

- copy/text changes;
- colour, spacing, border, size, alignment, and other local styling;
- local responsive tweak where the behaviour is already established;
- a missing import;
- a simple null guard;
- a very small bug with an obvious cause;
- a focused test assertion update caused by an intentional local change.

FAST workflow:

1. Inspect the target code.
2. Read one canonical local example only if needed.
3. Make the smallest patch.
4. Run the narrowest meaningful deterministic check.
5. Inspect the final diff.
6. Complete the project-specific commit/handoff if required.
7. Do not create a workstream, architecture gate, formal plan, premium reviewer, or model-switch interruption unless the task escalates.

A premium parent should normally just complete FAST work. Do not interrupt a 30-second edit to ask the user to switch models.

## STANDARD

Use STANDARD for ordinary feature work or bug fixes that remain well understood and reversible but need more coordination than FAST.

Typical indicators:

- several related files;
- normal CRUD/UI/data-flow work with an established pattern;
- a focused new component or hook;
- a moderate bug whose behaviour is understood;
- ordinary tests and type checks are sufficient proof.

STANDARD workflow:

1. Search narrowly.
2. Inspect the relevant implementation and one canonical pattern.
3. Make a concise implementation plan internally if useful. Do not force a formal planning artifact.
4. Implement cohesively.
5. Run targeted tests/checks, followed by broader checks only where they add evidence.
6. Inspect the diff.
7. Use local review by default.
8. Commit/handoff according to project rules.

No premium reviewer by default. No architecture subagent by default.

If the current parent is premium, do not ask to switch merely because STANDARD is economical. Only offer a switch before work when the task is clearly large enough that switching has meaningful benefit, for example a multi-file implementation expected to produce substantial code. Never repeatedly ask within the same task.

## GUARDED

Use GUARDED when the task is not intrinsically critical but contains enough integration or reasoning risk to justify stronger controls.

Examples:

- broad shared UI behaviour;
- a public/shared contract used by multiple modules;
- cross-module logic;
- unfamiliar architecture;
- a meaningful new abstraction;
- difficult debugging with uncertain root cause;
- repeated verification failures;
- a significant accessibility or responsive behavioural change across shared components;
- a broad refactor that remains reversible and does not touch CRITICAL categories.

GUARDED workflow:

- concise plan required;
- stable required-test IDs where appropriate;
- workstream ID recommended;
- architecture review may be parent-structured or independent depending on uncertainty;
- premium final review is based on a weighted escalation score, not one low-severity trigger;
- deterministic verification remains mandatory;
- bounded review closure applies if premium review is invoked.

## CRITICAL

CRITICAL immediately applies when work touches any of:

- persistence or schema migration;
- authentication;
- authorization;
- security boundaries;
- permissions/RLS;
- money/billing/pay calculations;
- concurrency or transactional integrity;
- irreversible/destructive operations;
- production-data changes or risk;
- broad regression risk where failure could materially affect many users;
- an explicit user request for independent architecture/final review.

CRITICAL keeps the strongest parts of current TEE:

- workstream ID;
- structured plan contract;
- independent architecture gate before implementation;
- invariants, boundaries, rollback, stable required-test IDs;
- deterministic verification;
- independent final-diff review;
- bounded two-pass review closure;
- no open-ended premium reviewer loop;
- finalise checkpointing;
- explicit unresolved-risk reporting.

---

# 5. Escalation model

A task starts in the lightest lane supported by known evidence and can only move upward when evidence justifies it.

Immediate escalation to CRITICAL uses the CRITICAL triggers above.

For STANDARD -> GUARDED premium-review decisions, use a weighted score rather than a single trigger.

Suggested scoring:

```text
+1  edits a shared component or shared layout
+1  meaningful responsive behaviour across more than one surface
+1  more than three materially changed files
+1  local pattern is unfamiliar or inconsistent
+2  changes a cross-module or public behavioural contract
+2  introduces a meaningful new abstraction
+2  changes accessibility semantics across shared behaviour
+2  deterministic verification repeatedly fails for non-trivial reasons
+2  local final review remains materially uncertain
```

Recommended premium final-review threshold: `>= 3`.

A CRITICAL trigger bypasses the score and immediately uses CRITICAL.

Untouched legacy debt must never contribute to the score.

A large file must never contribute to the score merely because it is large.

---

# 6. Planning rules by lane

## FAST

No formal plan. No workstream ID. No plan marker.

## STANDARD

No formal plan unless the user asks or the implementation genuinely benefits from coordinated steps. A short chat plan is enough.

## GUARDED

Use a concise plan containing scope, important invariants, required checks, and escalation/review decision. Machine-readable plan metadata may be compact.

## CRITICAL

Keep the existing full plan contract behaviour, including stable required-test IDs, architecture review source, rollback, final review, workstream ID, and recommended model roles.

Do not force the CRITICAL plan schema onto FAST or STANDARD work.

---

# 7. Global Skill V2 requirements

Rewrite the global TEE Skill to be materially shorter than the current ~15 KB skill and make the four-lane routing the first decision.

Target approximately 5-8 KB unless additional content is demonstrably necessary.

The Skill should state these key rules:

1. Classify lane before broad exploration.
2. FAST and STANDARD are direct-execution lanes.
3. Do not invoke subagents merely because a task is substantive.
4. Do not interrupt FAST tasks with model-switch questions.
5. Use premium reasoning where it adds quality, not as a fixed tax.
6. CRITICAL always gets independent architecture and final review regardless of parent model.
7. GUARDED uses weighted escalation and uncertainty.
8. Search before broad reads.
9. One canonical pattern is normally enough.
10. Avoid rereading unchanged code.
11. Make cohesive patches.
12. Large-file size is advisory only.
13. Verify the narrowest useful check first.
14. During repair loops, rerun the failing check, not an entire pipeline.
15. Run a final closure check once after repairs stabilize.
16. Keep the current bounded two-pass premium review protocol for CRITICAL work.
17. Project rules and explicit user instructions override global procedure.

The detailed Squires completion-marker schema must not live in the global User Rule. A generic compact completion-evidence description may remain in the global Skill.

---

# 8. Large-file policy replacement

Delete this behaviour:

> If a file is over 800 lines, refactor it into smaller components/hooks before feature edits.

Replace it with:

```text
Large file size alone must never expand the scope of a local task. Prefer extraction only when the requested change naturally exposes a coherent boundary, the same region has repeatedly required edits, or extraction materially simplifies the requested implementation without increasing risk. Otherwise make the smallest local change and record refactoring as optional technical debt. Never refactor first merely to satisfy a line-count threshold.
```

This policy can live in the global Skill instead of a duplicated project rule unless Squires needs extra constraints.

---

# 9. Commands instead of always-loaded procedural rules

Create project commands for explicit workflows.

Recommended user-facing commands:

```text
/finalise
/fap
/finalise-full
/ffap
/fixerrors
/createinvoice
/workflow-review
/cleancodebase
```

Each command file should contain only the procedure for that command.

The old bare aliases may be documented as deprecated. Do not keep several thousand tokens of always-loaded rule context solely to support bare `fap` or `createinvoice` input.

`/fap` and `/ffap` remain explicit push authorisation for the current branch.

`/finalise` and `/finalise-full` remain explicit local commit/finalisation authorisation without push.

---

# 10. Squires project rules redesign

## `squires-core.mdc`

Keep this `alwaysApply: true`, but make it short.

It should contain only durable Squires-wide constraints such as:

- stay on the current branch unless explicitly instructed otherwise;
- completed coding tasks are committed locally unless the task is review/planning only or the user says otherwise;
- never push except via explicit approved push instruction/command;
- production data must not be destructively changed without explicit permission;
- database/persistence work is CRITICAL and must load the database migration guide/rule before action;
- use the project's existing stack and patterns;
- project-specific rules override generic TEE where they are stricter.

Do not duplicate the global TEE workflow here.

## `database-migrations.mdc`

Move detailed migration procedure out of the always-loaded core rule.

Use either Agent Requested or appropriate auto-attachment globs so it loads for database/migration work. Its description must make it easy for the agent to request when the user describes schema or data work before a migration file is opened.

Keep the current requirements such as reading the migration guide, using the approved `pg` pattern, protecting production data, and not inventing alternate migration methods.

## Existing UI rules

Keep `app-page-shell.mdc` and `tabs-styling.mdc` scoped as they currently are unless a code audit finds obsolete instructions.

---

# 11. Completion evidence V4

The existing V3 completion marker is too expensive for FAST tasks.

Implement a backward-compatible V4 marker that allows a compact base payload with optional detailed sections.

Suggested base form:

```text
<!-- workflow-completion-marker:v4
{"schemaVersion":"4","lane":"fast","taskId":"...","taskType":"change","verification":"passed","commit":"completed","handoff":"completed"}
-->
```

For STANDARD it may add routing/check information only when relevant.

For GUARDED/CRITICAL it may include:

- workstream ID;
- parent/execution tier;
- routing decision;
- architecture status/source/reasons;
- required tests;
- unresolved risks;
- final review status/source/reasons;
- review passes;
- review closure state;
- plan recommendation adherence.

Requirements:

- V1-V3 markers remain readable.
- V4 normalizes into existing workflow analytics so historical reporting remains intact.
- Map FAST/STANDARD to existing `routine` analytics where old reports need a binary risk value.
- Map GUARDED/CRITICAL to existing `high` analytics where old reports need a binary risk value.
- Add native `lane` to new telemetry so future analysis no longer has to infer it.
- Missing optional V4 sections must not be treated as failures when they are not required for that lane.
- CRITICAL evidence requirements must remain at least as strong as current V3 requirements.

---

# 12. Finalise V2: stop using full finalise as the debugger

This is a high-priority optimisation.

## Desired behaviour

Initial command:

```text
/finalise or /finalise-full
```

If it passes, finish normally.

If it fails at a safely repairable step:

1. Persist the exact failing step and command in a machine-readable failure artifact.
2. Diagnose and fix the issue.
3. Rerun only the failing check/step.
4. Repeat `fix -> failing check` until that check is stable.
5. Run the original mapped finalise command once as closure.
6. Closure finalise must use exact fingerprints to reuse any still-valid successful steps.
7. Stop only for a genuine blocker.

Do not use:

```text
fix -> full finalise -> fix -> full finalise -> ...
```

as the normal repair loop.

## Suggested implementation

Add or extend a machine-readable artifact such as:

`docs_private/automation/finalise-last-failure.json`

Suggested fields:

```json
{
  "schemaVersion": "1",
  "originalMode": "finalise|finalise-full|fap|ffap",
  "failedStep": "build|test-run|testsuite|db-validate|migration|other",
  "command": "npm run test:run",
  "inputFingerprint": "...",
  "workstreamId": null,
  "createdAt": "..."
}
```

Add a deterministic repair command if it simplifies reuse, for example:

```text
npm run finalise:repair
```

It should read the artifact and rerun only the recorded failing step. It must refuse to execute stale/destructive steps if the current input no longer matches the safe assumptions.

For migration/database failures, do not automatically repair through this generic path. Route them as CRITICAL blockers unless the existing protocol explicitly permits the action.

---

# 13. Universal exact finalise fingerprints

Retire the 45-minute recent-run/mtime heuristic as the normal skip mechanism.

Generalize the existing protocol finalise checkpoint/fingerprint logic so all finalise runs can reuse exact successful verification steps.

A reusable result must be keyed to relevant inputs, including at minimum:

- current HEAD;
- dirty tree content hash;
- package lock;
- package.json;
- TypeScript config;
- Next config;
- migration fingerprint when relevant;
- safe environment fingerprint;
- required artifact hashes where relevant.

Use task-specific fingerprints when possible so a change that cannot affect a step does not invalidate unrelated evidence unnecessarily, but prefer safety over aggressive reuse.

Protocol-managed workstreams should continue to work. Do not weaken their existing strict checkpoint behaviour.

Remove or demote the mtime fallback after the exact cache is proven by tests.

Add tests for:

- unchanged inputs reuse a passed step;
- changed source invalidates relevant build/test evidence;
- changed package/config invalidates appropriate evidence;
- failed evidence is never reused;
- missing/corrupt artifacts invalidate reuse;
- protocol workstreams still resume correctly;
- non-protocol runs no longer depend on a 45-minute window for correctness.

---

# 14. Review preflight optimisation

Current review evidence can execute full `npm run lint` (`eslint .`).

For review preflight, change the default to changed-scope checks:

1. full typecheck for GUARDED/CRITICAL TypeScript work unless demonstrably unnecessary;
2. `oxlint` over changed lintable files;
3. ESLint over changed lintable files;
4. required targeted tests by stable IDs;
5. full repository lint only at explicit full finalisation/CI or when changed-scope evidence indicates a repository-wide issue.

The preflight evidence manifest must record exactly which files/checks ran.

If there are no lintable changed files, record the lint step as skipped with a deterministic reason rather than running `eslint .`.

Do not weaken CRITICAL behavioural tests.

---

# 15. Premium reviewer policy

Keep the current bounded two-pass review closure protocol.

Do not change this safety invariant:

- first premium review;
- one consolidated blocker-family fix;
- one closure/delta review;
- after two failed premium rounds, stop and route/split rather than endlessly re-reviewing.

Change only the entry criteria so FAST/STANDARD work does not reach premium review too easily.

Reviewer scope should also be constrained:

> Inspect adjacent surfaces only where the changed contract can plausibly propagate. Do not turn a final-diff review into a repository redesign or technical-debt hunt.

Untouched legacy debt is report-only unless it directly invalidates the requested change.

---

# 16. Workflow review frequency and anomaly detection

Change normal workflow self-review threshold from 5 qualifying tasks to 25.

Keep telemetry collection on every qualifying task, but perform expensive review only when:

- 25 new qualifying tasks accumulate; or
- a scheduled/monthly review is explicitly run; or
- an anomaly trigger fires.

Suggested anomaly triggers:

- FAST or STANDARD unexpectedly invokes premium architecture/final review;
- a task escalates to CRITICAL after implementation begins;
- more than two targeted repair cycles occur for the same failure family;
- two premium review passes fail;
- a finalise run exceeds a defined high-duration threshold;
- the same broad exploration is repeated without a recorded reason;
- malformed/missing required CRITICAL workflow evidence;
- a protocol invariant is violated.

An anomaly should produce a small pending review signal. It should not automatically launch broad LLM analysis during normal task completion unless the current tooling can do so cheaply and deterministically.

---

# 17. Stop-hook redesign

Make the synchronous stop hook a collector first.

The fast path should:

- parse the completion marker if present;
- record task/model/lane/workstream/basic timings and evidence state;
- update a small counter/state file;
- detect deterministic anomaly flags;
- return promptly.

Heavy review generation, historical aggregation, suggestion generation, and monthly analysis should happen only on threshold/anomaly/manual workflow review.

Preserve fail-open behaviour so telemetry failure never prevents normal development completion.

Add a performance test or timing assertion for the normal no-review stop path.

---

# 18. `fixerrors` V2

Move `fixerrors` to `/fixerrors` command context.

After the deterministic error-analysis script generates its report:

1. Group errors by probable root-cause family.
2. Classify each family independently into FAST/STANDARD/GUARDED/CRITICAL/report-only.
3. Do not allow one RLS/auth/database error to force unrelated UI/network errors into the same critical workflow.
4. Process safe independent families separately.
5. External/network/user-input patterns that do not represent a code defect remain report-only.
6. CRITICAL clusters must use the normal CRITICAL TEE gates.
7. Commit a coherent set of related fixes. If clusters are unrelated, keep their evidence distinct even if one final commit is appropriate.

The report should show the lane and action for each cluster.

---

# 19. Cursor indexing/context exclusions

Extend `.cursorignore` so high-volume historical automation output does not participate in ordinary semantic context.

Recommended candidates:

```text
docs_private/automation/runs/**
docs_private/automation/workflow-events/**
docs_private/automation/reviews/*/20*/events.json
.cursor/debug*.log
```

Do not ignore the active automation source code.

Keep important compact knowledge/protocol files accessible where the agent needs them, for example current workstream protocol state or curated automation knowledge.

Automation scripts can still read ignored historical files directly from the filesystem when deterministic history processing is required.

Before committing this change, verify that no Cursor command/rule relies on semantic indexing of an ignored history path.

---

# 20. Model-routing changes

The global Skill should use role/tier concepts rather than hard-coded model IDs wherever possible.

Recommended behaviour:

- FAST: current parent, no model-switch prompt, no subagent.
- STANDARD: current parent by default. If current parent is premium and the task is clearly substantial, one optional switch prompt may be used before work. Do not ask for small/moderate tasks merely to save tokens.
- GUARDED: economical implementation remains acceptable when the plan makes implementation routine; premium reasoning/review only at justified gates.
- CRITICAL: premium independent architecture and final review are mandatory. Implementation can still use an economical parent when the approved plan makes the coding mechanical, subject to existing policy.

A premium parent must not spawn redundant premium subagents when it can safely perform a non-independent gate itself. CRITICAL categories still require independent reviewers.

Subagents must have isolated, narrow jobs. Do not use exploration subagents for known paths or obvious local style references.

---

# 21. Git and safety rules for this migration

This TEE V2 migration itself is tooling/process work. It must not touch production application behaviour or production data.

Before editing:

1. Record current branch and HEAD.
2. Ensure no unrelated uncommitted changes will be overwritten.
3. Create a timestamped backup of every project rule/command/hook/automation file that will be changed.
4. Back up the live global TEE Skill before modifying it.
5. Do not modify undocumented Cursor settings files in order to change the global User Rule.
6. Instead, write the proposed global User Rule to a clear staging text file and give the user the one manual Cursor Settings step at the end, unless Cursor exposes an official supported User Rule editing mechanism in the live environment.
7. Never run a DB migration.
8. Never change `.env` values.
9. Never push unless explicitly authorized.

If the live global skill cannot be safely located or differs materially from the bundled snapshot, stage the proposed V2 skill inside the repository and report the exact manual copy destination instead of risking an overwrite.

---

# 22. Implementation sequence

Implement in this order so each stage can be validated independently.

## Phase A — Baseline and backups

- Capture branch, HEAD, working tree status, hashes, and current rules/skill inventory.
- Back up live project automation/rule files.
- Locate and back up the active global TEE Skill.
- Save current global User Rule text if it is accessible through a supported interface. Otherwise use the bundled snapshot as the migration reference only.
- Record baseline tests for workflow marker parsing, finalise checkpointing, workflow protocol, and review evidence.

## Phase B — Context architecture

- Remove legacy `.cursorrules` after migrating necessary project-specific content.
- Replace the global User Rule with a staged V2 text artifact for manual setting if necessary.
- Rewrite global TEE Skill to V2.
- Slim Squires always-loaded rules.
- Remove duplicated Squires TEE procedure.
- Correct the large-file rule.
- Move explicit workflows to `.cursor/commands`.

## Phase C — Four-lane telemetry

- Add lane types and classifier policy.
- Add V4 compact completion marker support with V1-V3 backward compatibility.
- Normalize lane into legacy risk analytics where necessary.
- Add unit tests.

## Phase D — Finalise repair/cache

- Implement structured failure artifact.
- Implement targeted repair-step runner or equivalent deterministic mechanism.
- Generalize exact fingerprint checkpoint/cache to ordinary finalise runs.
- Remove full-finalise retry instructions from commands/rules.
- Keep one closure finalise after targeted repair stabilizes.
- Add comprehensive cache invalidation and repair-loop tests.

## Phase E — Review preflight

- Replace full-repo ESLint preflight with changed-scope oxlint + ESLint.
- Keep full typecheck/required tests where risk requires them.
- Preserve full final checks where appropriate.
- Add evidence-manifest tests.

## Phase F — Workflow telemetry

- Raise normal review threshold to 25.
- Add anomaly triggers.
- Make stop-hook normal path lightweight.
- Keep expensive analysis for manual/threshold/anomaly runs.
- Add tests around state advancement and failure-open behaviour.

## Phase G — Fixerrors and indexing

- Route `/fixerrors` clusters independently by lane.
- Add report metadata for lane/action.
- Update `.cursorignore` for historical logs.
- Verify scripts still access ignored filesystem history as required.

## Phase H — End-to-end validation

Run targeted automation tests first, then broad project checks once.

Do not repeatedly run the full finalise pipeline while fixing tests. Use the new targeted repair principle during the migration itself once that mechanism is available.

---

# 23. Acceptance tests

The migration is complete only when these scenarios work.

### A. Tiny styling task

Prompt equivalent to:

> Make this button border slightly less bright.

Expected:

- FAST;
- no formal plan;
- no AskQuestion model switch;
- no subagent;
- inspect target and optional canonical style only;
- small edit;
- focused lint/check;
- diff inspection;
- compact completion evidence;
- project commit behaviour retained.

### B. Moderate normal feature

Expected:

- STANDARD;
- no architecture gate by default;
- no premium final review by default;
- targeted tests/typecheck based on scope;
- local diff review;
- no full planning contract unless requested or needed.

### C. Shared multi-module non-critical behaviour

Expected:

- STANDARD or GUARDED depending on score;
- premium review only when weighted threshold/uncertainty justifies it;
- no CRITICAL architecture gate solely because a shared component changed.

### D. RLS/persistence change

Expected:

- CRITICAL immediately;
- load Squires DB migration rule/guide;
- workstream and full plan contract;
- independent architecture gate;
- deterministic tests;
- independent final review;
- bounded two-pass closure;
- production-data protections unchanged or stronger.

### E. Large-file copy change

Expected:

- FAST when otherwise safe;
- no forced refactor merely because the file exceeds 800 lines.

### F. Finalise test failure

Expected:

- initial finalise reaches failing test;
- failure artifact identifies the step;
- code is repaired;
- only failing test/check is rerun during the repair loop;
- once stable, original finalise runs once for closure;
- exact fingerprints determine what can safely be reused;
- no endless whole-pipeline loop.

### G. Review preflight

Expected:

- changed-scope lint only by default;
- manifest lists files checked;
- required behavioural tests still run;
- full repository lint is not paid for every premium review.

### H. Workflow stop

Expected:

- ordinary completion records telemetry quickly;
- no expensive review every five tasks;
- threshold is 25;
- anomaly triggers still surface important workflow problems.

### I. Old telemetry

Expected:

- V1, V2, V3 historical markers/reviews remain parseable;
- existing workstream histories remain usable;
- V4 lane data appears in new diagnostics.

### J. Explicit commands

Expected:

- `/finalise`, `/fap`, `/finalise-full`, `/ffap`, `/fixerrors`, `/createinvoice`, `/workflow-review`, `/cleancodebase` are available and contain their procedures only when invoked.

---

# 24. Success metrics after rollout

Record the following for at least 25 substantive tasks after V2:

- lane distribution;
- number of subagents per lane;
- premium reviewer rate per lane;
- median task completion time by lane;
- median finalise duration;
- number of complete finalise reruns after a failure;
- targeted repair cycles per finalise failure;
- preflight lint duration;
- stop-hook duration;
- malformed/missing evidence rate;
- post-change regression/rollback count;
- user-invoked corrections after completion.

The optimisation succeeds if FAST/STANDARD completion time and premium/subagent use materially fall without increasing regressions or unresolved verification failures.

Do not optimize toward token savings alone.

---

# 25. Rollback strategy

Every migration phase must remain reversible.

Keep:

- timestamped backups of all old project rules;
- backup of old global Skill;
- old global User Rule text;
- V1-V3 parser compatibility;
- protocol workstream records;
- the ability to restore old finalise behaviour if exact caching is found unsafe.

If a V2 optimisation causes ambiguity or skips required safety evidence, restore the affected V1 behaviour only for that risk area rather than reverting all routing improvements.

---

# 26. Recommended one-chat implementation method

This migration is safe to run in one Cursor chat **provided the agent treats it as a controlled tooling migration rather than application feature work**.

The one unavoidable manual item may be the global Cursor User Rule because Cursor documents User Rules as a Settings-level global feature rather than a project file. Do not edit undocumented internal settings storage just to avoid one manual paste.

The global Skill can be updated automatically if the active file is safely located, backed up, and inspected first.

Everything inside the Squires repository can be implemented, tested, and committed in the same chat.

If any application/database behaviour changes unexpectedly appear in the diff, stop and revert those unrelated changes before continuing.

---

# 27. MASTER CURSOR PROMPT — copy/paste this into a new Squires Cursor chat

I want you to implement the Token-Efficient Engineering V2 migration described in the file `TEE_V2_IMPLEMENTATION_PLAN.md`.

**BOOTSTRAP AUTHORISATION FOR THIS MIGRATION**

This message is my explicit approval and one-line confirmation to perform the complete tooling/process migration described in the approved plan.

Do not create another implementation plan or ask me to reconfirm the migration. Treat `TEE_V2_IMPLEMENTATION_PLAN.md` as the already-approved architecture and implementation specification.

The existing TEE workflow may still perform any genuinely mandatory independent architecture and final-diff reviews required because this task changes global engineering behaviour, but do not launch redundant exploratory/planning sub-agents, recreate the implementation plan, or restart planning from first principles.

Do not ask me to switch models during this migration. I have deliberately selected the model for this task.

Continue autonomously unless one of the genuine blocker conditions listed below occurs.

Treat `TEE_V2_IMPLEMENTATION_PLAN.md` as the implementation specification and source of truth for this task. Read it in full before editing anything, then inspect the current live files it references. The plan was produced from the 2026-08-10 Squires review bundle, so the live repository/global Cursor files may have changed slightly since the bundle. Never blindly overwrite a newer live file: inspect and merge any differences.

## GOAL

Reduce fixed LLM/context/workflow overhead for simple and moderate tasks while preserving or strengthening safety for database, migration, auth, security, permissions, money, production data, concurrency, irreversible operations, and broad regression risk.

This is a tooling/process migration. Do not change application features, business behaviour, production data, schema, or environment values unless a tooling test fixture absolutely requires a non-production change. Never run a production migration during this task.

## AUTONOMY

Run this migration end-to-end in this chat. Do not stop for routine decisions that the plan resolves. Use reasonable engineering judgment and continue autonomously.

Only stop and ask me if there is a genuine blocker that cannot safely be resolved from the repository and plan, especially:

* a material conflict between the live global TEE Skill and the bundled/reference version where overwriting could lose newer policy;
* inability to locate the active global Skill safely;
* unrelated uncommitted changes that would be overwritten;
* a request would require changing undocumented Cursor internal settings storage;
* a change would affect production data/schema/application behaviour unexpectedly.

Do NOT ask broad planning questions. The plan is already approved for implementation.

## SAFETY / BACKUP FIRST

Before editing:

1. Record current branch, HEAD, and git status.
2. Inspect all relevant `.cursor` rules/hooks/commands, automation scripts, package scripts, and the current global TEE Skill.
3. Create timestamped backups of every project file you will replace/remove, preserving relative paths under a private backup folder such as `docs_private/automation/tee-v2-migration/<timestamp>/project-backup/`.
4. Locate the active global `token-efficient-engineering` Skill using the live Cursor environment rather than assuming a path. Back it up before editing.
5. Compare the live global Skill with the bundled reference if `_external/token-efficient-engineering-skill` exists. If it differs, preserve newer useful changes while implementing the V2 design.
6. Do not modify an undocumented Cursor settings file to change the global User Rule. Instead generate the exact replacement text as `docs_private/automation/tee-v2-global-user-rule.txt` unless there is an official supported mechanism available to this agent.
7. Never push during this migration unless I separately issue explicit push authorisation.

## IMPLEMENTATION SCOPE

Implement every applicable section of `TEE_V2_IMPLEMENTATION_PLAN.md`, including:

### A. Global architecture

* Replace the large global User Rule concept with the concise V2 text from the plan, staged as a text artifact if it cannot be changed through an official mechanism.
* Rewrite the active global TEE Skill around FAST / STANDARD / GUARDED / CRITICAL.
* Remove Squires-specific procedure from the global Skill.
* Do not interrupt FAST tasks with a model-switch question.
* Keep CRITICAL independent architecture/final review mandatory.

### B. Squires context/rules

* Remove legacy `.cursorrules` after migrating any still-useful Squires-specific constraints.
* Slim always-loaded project rules aggressively.
* Remove duplicated TEE procedure from the Squires project layer.
* Split detailed DB/migration procedure out of always-loaded core context while ensuring database intent still reliably triggers/loads it.
* Replace the >800-line forced-refactor rule with the advisory large-file policy in the plan.
* Keep genuinely useful scoped rules such as page-shell/tab styling.

### C. Commands

* Create `.cursor/commands` workflows for `/finalise`, `/fap`, `/finalise-full`, `/ffap`, `/fixerrors`, `/createinvoice`, `/workflow-review`, and `/cleancodebase`.
* Migrate command-only procedure out of always-loaded/agent-requested rules where appropriate.
* Preserve commit/push semantics. `/fap` and `/ffap` are explicit push authorisation; the non-push commands are not.

### D. Lane/evidence model

* Add four-lane support to workflow telemetry.
* Implement backward-compatible `workflow-completion-marker:v4` with a compact payload for FAST/STANDARD and detailed optional evidence for GUARDED/CRITICAL.
* V1-V3 must remain readable.
* Preserve legacy risk reporting by normalizing FAST/STANDARD to routine and GUARDED/CRITICAL to high where required, while storing native lane on new events.
* Add/update unit tests.

### E. Finalise V2

* Stop using the entire finalise pipeline as the normal repair loop.
* Persist structured failure-step evidence.
* During repair, rerun only the failed deterministic check until stable.
* Then run the original mapped finalise once for closure.
* Generalize exact content/fingerprint-based checkpoint reuse to ordinary finalise runs.
* Retire/demote the 45-minute mtime heuristic after exact reuse is proven.
* Keep protocol-managed CRITICAL checkpoints at least as strict as today.
* Add cache invalidation, failure, stale-artifact, and protocol compatibility tests.

### F. Review preflight

* Replace full-repository ESLint in normal review preflight with changed-file oxlint + changed-file ESLint.
* Keep full typecheck and required behavioural tests where risk requires them.
* Record exact checks/files in evidence.
* Full repository lint remains available for explicit full finalisation/CI or justified broad checks.

### G. Workflow review/stop hook

* Change normal workflow review threshold from 5 to 25 qualifying tasks.
* Add deterministic anomaly triggers described in the plan.
* Make the normal stop-hook path collector-first and fast.
* Move expensive aggregation/suggestion generation to threshold/anomaly/manual review.
* Preserve fail-open behaviour.
* Add tests for state progression and no-review fast path.

### H. Fixerrors

* Move the workflow to `/fixerrors` command context.
* Cluster error patterns by root cause and classify each cluster independently by TEE lane.
* Do not let one CRITICAL database/RLS/auth error escalate unrelated routine patterns.
* Keep external/network/user-input patterns report-only when appropriate.

### I. Indexing

* Add the historical automation/debug exclusions recommended in the plan to `.cursorignore` after verifying no semantic-context dependency is broken.
* Do not hide active automation source or required current protocol knowledge.

## IMPLEMENTATION STYLE

* Make cohesive patches rather than dozens of tiny speculative edits.
* Search narrowly and do not repeatedly rediscover the same files.
* Reuse existing automation helpers where safe instead of creating duplicate frameworks.
* Preserve backwards compatibility for historical workflow data.
* Keep implementation understandable. This V2 migration is intended to reduce orchestration complexity, so do not replace it with a larger framework than necessary.
* Large file size is not permission to refactor unrelated application code.

## TESTING STRATEGY

Use targeted tests while implementing each phase. Do not repeatedly run the entire finalise pipeline while debugging individual failures.

At minimum validate:

* V1/V2/V3 marker parsing plus V4 compact/detailed markers;
* lane normalization and analytics;
* CRITICAL evidence requirements;
* exact finalise fingerprint reuse/invalidation;
* failed/stale evidence is never reused;
* targeted finalise repair behaviour;
* protocol-managed workstream compatibility;
* changed-scope review linting;
* workflow threshold/anomaly logic;
* stop-hook fast/fail-open path;
* command files exist and old always-loaded procedural rules are gone;
* no forced large-file refactor rule remains.

After targeted checks are green, run one appropriate broad final verification. If broad verification fails, use targeted repair loops and only rerun broad closure after the failing check stabilizes.

## SELF-AUDIT BEFORE COMPLETION

Before committing, inspect the complete diff and explicitly verify:

* no application/business/database behaviour was unintentionally changed;
* no secrets were copied into backups or artifacts;
* global versus Squires-only responsibilities match the plan;
* always-loaded rule content has materially decreased;
* explicit command procedures are no longer paid in unrelated task context;
* FAST can genuinely complete without plan/subagent/premium reviewer/model-switch interruption;
* CRITICAL protections have not weakened;
* finalise no longer mandates full-pipeline retry for every repair;
* old workflow history remains readable.

Generate a small before/after report containing:

* always-loaded project-rule byte/character totals before and after;
* global User Rule size before/reference and proposed V2 size;
* global Skill size before and after;
* command/rule files migrated;
* test results;
* any deliberate deviations from the plan and why.

## COMMIT / HANDOFF

Commit the repository changes locally with a clear commit message when all relevant checks pass. Do not push.

Global Skill changes live outside the repo, so report their backup path and resulting path/hash separately.

If the global User Rule could not be changed through a supported interface, finish by showing me ONLY the one manual action I need to take in Cursor Settings and point me to `docs_private/automation/tee-v2-global-user-rule.txt`.

Do not create extra follow-up work unless something genuinely could not be completed safely.

---

# 28. Expected manual step after the one-chat build

If Cursor cannot change the global User Rule through a documented/supported interface, the intended final manual action is simply:

1. Open Cursor Settings -> Rules.
2. Replace the current global User Rule with the contents of `docs_private/automation/tee-v2-global-user-rule.txt`.

That is preferable to having an agent manipulate undocumented internal Cursor configuration files.

---

# 29. Final recommendation

Use the master prompt above in a fresh Cursor chat from the Squires repository, with `TEE_V2_IMPLEMENTATION_PLAN.md` placed in the repository root or another obvious project location.

A single implementation chat is reasonable because this migration is reversible tooling work and the plan supplies explicit boundaries. The global User Rule should remain the only likely manual post-step.

The key success condition is not merely fewer tokens. It is that simple tasks become simple again while CRITICAL tasks retain the evidence, review, rollback, and database/security safeguards that made TEE valuable in the first place.

## Classification

- Task type: change
- Risk: high / CRITICAL due to broad engineering-workflow regression risk
- Initial parent tier: premium
- Routing decision: explicit premium selection by the user
- Workstream: `ws_tee_v2_20260810`

## Recommended build model

- Implementation role: `premium-planning`, premium tier, GPT Sol family/display
- Architecture gate: `premium-architecture-gate`, premium tier, mandatory before implementation
- Final review: `premium-final-review`, premium tier, mandatory after deterministic verification
- Switch timing: not applicable because the user explicitly selected the current model
- Fallback: stop for approved blockers; use bounded fix routing after reviewer findings

## Architecture gate

- Decision: approved with conditions
- Source: independent subagent
- Independent review reason: broad regression risk
- Conditions: activate V4 readers before emitters, keep lane separate from legacy risk, reject generic DB/migration repair, and use conservative exact fingerprints

## Implementation contract

- Preserve V1-V3 history and keep CRITICAL evidence at least as strict as V3.
- Do not change application, database, production-data, schema, environment, deployment, or push behaviour.
- Generic repair may execute only allowlisted deterministic non-database checks.
- Rollback restores timestamped project/global backups and disables exact reuse so finalise runs every check.

## Required tests

- `TEE-V2-MARKER-COMPAT-001`
- `TEE-V2-LANE-NORMALIZE-001`
- `TEE-V2-CRITICAL-EVIDENCE-001`
- `TEE-V2-FINALISE-REUSE-001`
- `TEE-V2-FINALISE-INVALIDATE-001`
- `TEE-V2-FINALISE-STALE-001`
- `TEE-V2-REPAIR-001`
- `TEE-V2-PROTOCOL-COMPAT-001`
- `TEE-V2-PREFLIGHT-SCOPE-001`
- `TEE-V2-REVIEW-TRIGGERS-001`
- `TEE-V2-STOP-HOOK-001`
- `TEE-V2-COMMANDS-RULES-001`
- `TEE-V2-LARGE-FILE-001`
- `TEE-V2-SCOPE-SAFETY-001`
- `TEE-V2-ROLLBACK-001`
- `TEE2-CACHE-002`

## Final review

- Required: yes
- Source: independent final-diff reviewer
- Closure: bounded `two-pass-v1`

## Commit and handoff

- Commit completed repository changes locally; never push without separate authorization.
- Emit `workflow-completion-marker:v4` with detailed CRITICAL evidence at handoff.

<!-- plan-contract-marker:v1
{
  "schemaVersion": "1",
  "registryVersion": "2",
  "workstreamId": "ws_tee_v2_20260810",
  "taskId": "tee-v2-migration",
  "taskType": "change",
  "risk": "high",
  "initialParentTier": "premium",
  "routingDecision": "explicit_premium",
  "recommendedBuildModel": {
    "implementation": {
      "role": "premium-planning",
      "tier": "premium",
      "family": "gpt-sol"
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
    "rationale": "The user explicitly selected the current premium parent for this broad workflow migration.",
    "fallbackEscalation": "Stop only for the approved blocker categories or route bounded closure findings through premium-fix-routing."
  },
  "architectureGate": "approved_with_conditions",
  "architectureReviewSource": "independent_subagent",
  "independentReviewRequired": true,
  "independentReviewReasons": [
    "broad-regression"
  ],
  "requiredTests": [
    {"id": "TEE-V2-MARKER-COMPAT-001", "status": "unresolved"},
    {"id": "TEE-V2-LANE-NORMALIZE-001", "status": "unresolved"},
    {"id": "TEE-V2-CRITICAL-EVIDENCE-001", "status": "unresolved"},
    {"id": "TEE-V2-FINALISE-REUSE-001", "status": "unresolved"},
    {"id": "TEE-V2-FINALISE-INVALIDATE-001", "status": "unresolved"},
    {"id": "TEE-V2-FINALISE-STALE-001", "status": "unresolved"},
    {"id": "TEE-V2-REPAIR-001", "status": "unresolved"},
    {"id": "TEE-V2-PROTOCOL-COMPAT-001", "status": "unresolved"},
    {"id": "TEE-V2-PREFLIGHT-SCOPE-001", "status": "unresolved"},
    {"id": "TEE-V2-REVIEW-TRIGGERS-001", "status": "unresolved"},
    {"id": "TEE-V2-STOP-HOOK-001", "status": "unresolved"},
    {"id": "TEE-V2-COMMANDS-RULES-001", "status": "unresolved"},
    {"id": "TEE-V2-LARGE-FILE-001", "status": "unresolved"},
    {"id": "TEE-V2-SCOPE-SAFETY-001", "status": "unresolved"},
    {"id": "TEE-V2-ROLLBACK-001", "status": "unresolved"},
    {"id": "TEE2-CACHE-002", "status": "unresolved"}
  ],
  "unresolvedRisks": [
    {
      "id": "TEE-V2-RISK-GLOBAL-ACTIVATION-001",
      "note": "The global User Rule requires a final manual Cursor Settings paste because no supported editing interface is available."
    },
    {
      "id": "TEE-V2-RISK-ENV-CACHE-001",
      "note": "Any unrecognized environment dependency must conservatively disable exact cache reuse."
    },
    {
      "id": "TEE-V2-RISK-STOP-LATENCY-001",
      "note": "Real host process-start latency remains observable after deterministic stop-hook tests."
    }
  ],
  "finalReviewRequired": true,
  "finalReviewSource": "independent_subagent",
  "commit": "pending",
  "handoff": "pending",
  "implementationContract": {
    "invariants": [
      "V1-V3 history remains readable and CRITICAL evidence remains at least as strict as V3.",
      "No application, database, production-data, schema, environment, deployment, or push behavior changes.",
      "Generic repair executes only allowlisted deterministic non-database checks."
    ],
    "boundaries": [
      "Only Cursor policy, workflow/finalise automation, tests, indexing exclusions, private migration evidence, package scripts, and the active global Skill may change.",
      "Capability is activated before V4 policy emission.",
      "Native lane remains distinct from legacy binary risk analytics."
    ],
    "rollback": "Restore timestamped project and global Skill backups, revert repository changes, disable exact-cache reuse, and fall back to running every finalise check."
  },
  "reviewClosureProtocol": "two-pass-v1"
}
-->
