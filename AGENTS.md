# Squires agent router

AVS Worklog (Squires) is the A&V Squires internal operations PWA. Select context by task; do not read this table as a reading list.

| Task | Load only what applies |
| --- | --- |
| Tiny copy/style fix or ordinary bug | Affected code and targeted tests; attached scoped rules. `docs/DEVELOPMENT.md` for commands/commit policy. |
| Substantial UI, page chrome or responsive work | `DESIGN.md` relevant sections and `.cursor/rules/ui-design.mdc`; shell/tabs rules when in scope. |
| Daily Allocation behaviour | `PRODUCT.md` allocation invariants, live board and transactional RPCs; security/database routes below when affected. |
| New route, provider, service, shared state or module boundary | `ARCHITECTURE.md` and `.cursor/rules/architecture.mdc`. |
| Auth, permissions, APIs, RLS, money or sensitive data | `docs/SECURITY.md` and `.cursor/rules/security-data.mdc`. |
| Database, persistence, schema or backfill intent | `.cursor/rules/database-migrations.mdc` and its named migration guides before acting. |
| Finalise, finalise full, `fap` / `/fap`, `ffap` / `/ffap` | `.cursor/rules/finalise-commands.mdc`; invoke the matching command adapter. |
| Existing TEE-FULL workstream or exhausted review | `docs/WORKFLOW.md`; inspect only its identified protocol/evidence. |

`PRODUCT.md` owns product/domain truth, `DESIGN.md` visual truth, and the named engineering documents their respective contracts. Live code/migrations are implementation evidence: investigate discrepancies rather than silently choosing one. Module PRDs/runbooks apply only to their module. Preserve mixed-generation domain behaviour and data-access patterns; generic new UI follows DESIGN's canonical references.

TEE's global skill owns proportional safety/quality and its model registry. This router does not redefine them. The always-attached core supplies the project entry constraints.

## Do NOT load

Do not load the whole documentation tree, historical reports/plans, unrelated module PRDs, release machinery for ordinary edits, or protocol artifacts for a DIRECT/FAST task. `docs/README.md` is a discovery index, not another standard. Never load secrets or customer/personnel data as AI context. No new summary or stage artifacts for trivial work.

Use deliberate stages only where a handoff helps: record scope, selected inputs, evidence needed and next action in the existing task/plan. Reuse existing protocol artifacts for TEE-FULL; do not create a second state engine or a CONTEXT.md wrapper.
