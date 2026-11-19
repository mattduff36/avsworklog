# Proportionate fixerrors resolution

## Goal and authority

Matt approved implementation and deployment of this policy. Lower-impact incidents may be resolved after reasonable investigation and useful tested, deployed diagnostic improvements, even when their original cause remains unknown. The next fixerrors run belongs to Matt; this change must not resolve current production records during implementation or deployment.

## Plan

1. Add an optional, strict resolution object to existing decisions. Support Fixed, Mitigated, Diagnostics improved, Expected behaviour and Reviewed unable to reproduce. Preserve legacy packets and hashes when the field is absent.
2. Apply the shared policy to chat-led, worker-led and native batch paths. Retain serious impact, critical work, continuing failures and recurrence after a previous diagnostic closure for concrete investigation.
3. Keep local diagnostic improvements outstanding until deployment is verified. For an already deployed change, independently verify production identity, Git ancestry and relevant tested source. For a native release, retain the existing exact candidate, approval, check and database receipt binding.
4. Reassess old deployment holds without repeating their repair. Record deployed-but-unverified work clearly. Reserve Fixed for verification relevant to the original defect.
5. Persist accepted reasons and deployment evidence in existing lifecycle JSON. Preserve diagnostics, previous repair evidence, history, exact IDs, target/hash/expiry guards, locking, transactions and idempotent receipts. No database migration.
6. Show Resolved with the reason in both debug list layouts and summaries. Keep ordinary historical archival distinct from reviewed resolution.
7. Verify policy boundaries, deployed versus local improvement, recurrence capture, native release binding and exact-row PostgreSQL mutation/replay. Run typecheck, affected-file lint and the canonical release gates, obtain an independent risk review, then deploy and verify the serving revision.

## Acceptance

- A low/medium-impact diagnostic improvement remains open before deployment and can resolve after relevant tests and independent deployment proof, without reproducing the original intermittent failure.
- An investigated unreproducible historical incident can resolve with its uncertainty recorded.
- Serious, critical, continuing or recurring incidents cannot use the proportionate closure path.
- A new occurrence is captured normally and cannot reuse its previous diagnostic closure as a resolution.
- No incident is labelled Fixed solely because its code deployed or its diagnostics improved.
- Existing plan recovery and unrelated incident rows remain protected.
- Implementation/deployment does not run fixerrors or mutate incident records.

## Existing native review boundary

Native release reconciliation can close new verified diagnostic improvements through its exact approved deployed candidate. A native report-only review of an older externally deployed change still lacks device-to-server Git/source proof; it retains the incident for the chat-led review path. Do not weaken native admission or treat a claimed change commit as deployment evidence. The normal chat-led CLI independently verifies that existing change.

## Verification record

Implementation and independent risk review are complete. Focused checks cover closure eligibility, all five reasons, ordinary 403 versus serious impact, historical volume versus post-closure recurrence, source changes, passing assertion receipts, deployed identity/ancestry, both UI branches and legacy compatibility. Real disposable PostgreSQL verified exact-row updates, preserved diagnostics/history/dependents, transactional rollback and receipt replay (18 tests). The native aggregate suite passed all 8 tests, including a real synthetic two-repair candidate with diagnostics metadata and genuine subprocess check receipts. TypeScript checking and affected-file ESLint passed.

The elevated Windows test fixture now assigns only its disposable cache files to the test account before subsequent cache operations; production ownership checks are unchanged. No model was launched or release performed by that fixture.

The canonical finalise adapter records production build, commit/release metadata and push results under docs_private/automation/runs/finalise. The serving production commit and deployment identity will be checked against that release before reporting completion. No fixerrors execution or current incident-record mutation is part of this release.
