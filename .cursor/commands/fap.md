# /fap

This command explicitly authorizes local finalisation, commit, and pushing the current branch.

1. State the current branch and a short summary of what will be pushed.
2. Check for an active Agent Review or finalise terminal and wait if one is running.
3. A CRITICAL workstream must already have been initialized after plan approval. If expected identity is missing at finalisation, stop and report the protocol omission instead of reconstructing it retroactively. For a registered CRITICAL workstream whose review is closed, run `npx tsx scripts/workflow-protocol.ts finalise-start --workstream <id>`.
4. Run `npm run finalise:push`.
5. Classify a deterministic failure repair from its own delta, not from the original feature lane. Type-narrowing, lint, test-fixture, and build-only repairs remain FAST/STANDARD and do not reopen architecture review unless the repair itself changes a CRITICAL contract.
6. For a safely repairable step, inspect `docs_private/automation/finalise-last-failure.json`, fix it, and run `npm run finalise:repair`. Repeat only that targeted check until stable, then run `npm run finalise:push` once for closure so the original push intent is preserved.
7. Never generically repair migration/database, commit, push, unknown, stale, or destructive steps. Stop for genuine blockers.
8. Resolve any printed pending monthly follow-up through the established approve/reject/skip flow.
