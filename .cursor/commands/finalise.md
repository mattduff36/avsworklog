# /finalise

This command authorizes local finalisation and commit, but not push.

1. Check for an active Agent Review or finalise terminal and wait if one is running.
2. For a protocol-managed CRITICAL workstream whose review is closed, run `npx tsx scripts/workflow-protocol.ts finalise-start --workstream <id>`.
3. Run `npm run finalise`.
4. If a safely repairable deterministic step fails, inspect `docs_private/automation/finalise-last-failure.json`, fix the issue, and run `npm run finalise:repair`. Repeat only that targeted check until stable, then run `npm run finalise` once for closure.
5. Never use generic repair for migration/database, commit, push, unknown, stale, or destructive steps. Stop for merge conflicts, missing access/environment, production-data risk, PRD drift, or broad ambiguous fixes.
6. Resolve any printed pending monthly follow-up through the established approve/reject/skip flow.
