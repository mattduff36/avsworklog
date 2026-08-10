# /ffap

This command explicitly authorizes full local finalisation, commit, and pushing the current branch.

1. State the current branch and a short summary of what will be pushed.
2. Check for an active Agent Review or finalise terminal and wait if one is running.
3. For a protocol-managed CRITICAL workstream whose review is closed, run `npx tsx scripts/workflow-protocol.ts finalise-start --workstream <id>`.
4. Run `npm run finalise:full:push`.
5. If a safely repairable deterministic step fails, inspect `docs_private/automation/finalise-last-failure.json`, fix it, and run `npm run finalise:repair`. Repeat only that targeted check until stable, then run `npm run finalise:full:push` once for closure so the original push intent is preserved.
6. Never generically repair migration/database, commit, push, unknown, stale, or destructive steps. Stop for genuine blockers.
7. Resolve any printed pending monthly follow-up through the established approve/reject/skip flow.
