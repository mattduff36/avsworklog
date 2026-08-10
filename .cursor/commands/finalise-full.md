# /finalise-full

This command authorizes full local finalisation and commit, but not push.

1. Check for an active Agent Review or finalise terminal and wait if one is running.
2. For a protocol-managed CRITICAL workstream whose review is closed, run `npx tsx scripts/workflow-protocol.ts finalise-start --workstream <id>`.
3. Run `npm run finalise:full`.
4. If a safely repairable deterministic step fails, inspect `docs_private/automation/finalise-last-failure.json`, fix it, and run `npm run finalise:repair`. Repeat only that targeted check until stable, then run `npm run finalise:full` once for closure.
5. Never generically repair migration/database, commit, push, unknown, stale, or destructive steps. Stop for genuine blockers.
6. Resolve any printed pending monthly follow-up through the established approve/reject/skip flow.
