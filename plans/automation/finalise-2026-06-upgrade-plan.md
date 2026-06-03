---
name: finalise 2026-06 automation upgrades
overview: Implement approved monthly automation advisor suggestions from docs_private/automation/reviews/finalise/2026-06/review.md.
todos:
  - id: add-timing-summaries
    content: Add targeted timing summaries around slow finalise steps
    status: completed
isProject: false
---

# finalise 2026-06 Automation Upgrade Plan

## Source Artifacts

- Advisor review: docs_private/automation/reviews/finalise/2026-06/review.md
- Suggestions JSON: docs_private/automation/reviews/finalise/2026-06/suggestions.json
- Plan path: plans/automation/finalise-2026-06-upgrade-plan.md

## Approved Suggestions

### 1. Add targeted timing summaries around slow finalise steps

- ID: finalise-add-timing-summaries
- Reason: Slowest step was Run clean production build at 4.8m.
- Evidence: Run clean production build: 286755ms

## Implementation Steps

1. Read the advisor review and suggestions JSON listed above, then inspect the current automation implementation before editing.
2. Implement only the approved finalise suggestion(s) listed in this plan.
3. Keep changes scoped to the automation script, shared automation helpers, and focused tests needed for the approved suggestion(s).
4. Add or update focused tests for the changed automation behavior.
5. Run the focused test command(s) that cover the changed behavior.

## Completion Requirements

- Keep this plan file todo metadata aligned with the build work so Cursor can show completion state correctly.
- Do not run `npm run build`, commit, or push as part of this upgrade unless the user explicitly asks.
- Report the changed files and verification commands when done.
