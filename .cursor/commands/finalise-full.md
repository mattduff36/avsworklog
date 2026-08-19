# /finalise-full

This command authorizes full local finalisation and commit, but not push.

1. Check for an active Agent Review or finalise terminal and wait if one is running.
2. A CRITICAL workstream must already have been initialized after plan approval. If expected identity is missing at finalisation, stop and report the protocol omission instead of reconstructing it retroactively. For a registered CRITICAL workstream whose review is closed, run `npx tsx scripts/workflow-protocol.ts finalise-start --workstream <id>`.
3. Run `npm run finalise:full`.
4. Classify a deterministic failure repair from its own delta, not from the original feature lane. Type-narrowing, lint, test-fixture, and build-only repairs remain FAST/STANDARD and do not reopen architecture review unless the repair itself changes a CRITICAL contract.
5. For a safely repairable step, inspect `docs_private/automation/finalise-last-failure.json`, fix it, and run `npm run finalise:repair`. Repeat only that targeted check until stable, then run `npm run finalise:full` once for closure.
6. Never generically repair migration/database, commit, push, unknown, stale, or destructive steps. Stop for genuine blockers.
7. Resolve any printed pending monthly follow-up through the established approve/reject/skip flow.
