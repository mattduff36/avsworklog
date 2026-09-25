# Squires workflow runtime

One job: adapt the global TEE safety/quality contract to this repository's existing review and finalisation runtime. Load for TEE-FULL, an existing protocol record, review exhaustion, or release; ordinary DIRECT/FAST changes do not create protocol state.

## Inputs

Current request and authorization; Git status/HEAD; matching workstream identity and unresolved blockers if one exists; relevant tests and current source. Global TEE contracts define policy; `scripts/automation` implements this repository's mechanical gates.

## Do NOT load

Unrelated workstream histories, all automation runs, customer logs, secrets, or the full documentation tree. Historical V2.4 records are evidence, not active topology policy.

## Process

- Keep this checkout/branch. Risk is distinct from ceremony; use the global model registry, never repeat model versions in project prose.
- TEE-FULL uses first review, one consolidated repair, then closure per generation. Split/new IDs do not reset budget. Exhaustion preserves failed evidence; an explicit owner-authorized successor can continue in the same checkout/branch with inherited blockers. Use `workflow-protocol successor-authorize`, not hand-edited JSON.
- Owner-authorized DIRECT/TEE-LIGHT continuation is supported by the runtime. Resolve inherited blockers with evidence before `finalise-start`; never label the predecessor passed. Do not infer continuation authorization from this guide.
- Keep review evidence bound to HEAD/tree. Drift requires the runtime's delta review; malformed/cyclic/orphan records still block. Parked ancestors and valid exhausted predecessors remain history.
- Before mutating finalise, run `npm run workflow-protocol -- status --blocking`. Missing expected identity is an omission to diagnose, not authority to reconstruct a fictional pass. Normal finalise checks still apply to every continuation.
- Legacy closure uses the evidence-backed `reconcile-legacy` command and preserves old lifecycle fields; it cannot authorize release or skip current review.
- Stop hooks produce local telemetry and bounded follow-ups; they do not grant release permission. Governance suggestions are not safety approvals. Use `/workflow-review` for their inspection.

## Outputs

Existing plain-text/JSON protocol and evidence artifacts under `docs_private/automation`, accurate verification results, unresolved blockers and the next legal action. Do not add a parallel ledger.

## Human approval

Required for another exhausted review generation, optional Git topology changes, production/destructive actions and push as defined by their canonical contracts. Ordinary edits and targeted local checks need no new approval.
