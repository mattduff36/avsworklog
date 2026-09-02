# /finalise

This command authorizes local finalisation and commit, but not push.

1. Check for an active Agent Review or finalise terminal and wait if one is running.
2. Run `npm run workflow-protocol -- status --blocking` first. Valid split ancestors are parked history. The active descendant owns remaining work. After two failed premium rounds, remaining work is routing, isolation, or proven removal from release — not another normal final-diff pass. Do not hand-edit protocol JSON.
3. A CRITICAL workstream must already have been initialized after plan approval. If expected identity is missing at finalisation, stop and report the protocol omission instead of reconstructing it retroactively. For a registered CRITICAL workstream whose review is closed, run `npx tsx scripts/workflow-protocol.ts finalise-start --workstream <id>`.
4. Run `npm run finalise`.
5. Classify a deterministic failure repair from its own delta, not from the original feature lane. Type-narrowing, lint, test-fixture, and build-only repairs remain FAST/STANDARD and do not reopen architecture review unless the repair itself changes a CRITICAL contract.
6. For a safely repairable step, inspect `docs_private/automation/finalise-last-failure.json`, fix the issue, and run `npm run finalise:repair`. Repeat only that targeted check until stable, then run `npm run finalise` once for closure.
7. Never use generic repair for migration/database, commit, push, unknown, stale, or destructive steps. Stop for merge conflicts, missing access/environment, production-data risk, PRD drift, or broad ambiguous fixes.
8. Resolve any printed pending monthly follow-up through the established approve/reject/skip flow.
