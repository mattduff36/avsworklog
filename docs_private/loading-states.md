# Loading States

Use the lightest loading state that matches the user impact.

## Route Or Permission Gate

Use `PageLoader` when the user cannot safely see the page yet:

- authentication or permission checks
- route-level `loading.tsx`
- required data before any meaningful shell can render

Avoid stacking multiple full-page loaders with the same message.

## Section Data Loading

Use `SectionLoader` when the page shell can render but a card, table, tab, or panel is still waiting for data.

Good examples:

- tab content loading after the page header and filters are visible
- dashboard sections waiting for counts
- table panels that are loading initial rows

## Refreshing Existing Data

When existing content is already visible, keep it visible and show a small refresh indicator instead of replacing the whole page.

Use a subtle inline chip, small spinner, or disabled button state.

## User-Triggered Actions

For save, submit, approve, delete, assign, or similar actions, use a button-level spinner and disabled state only.

Do not replace the page or section unless the action changes the whole route.

## Bootstrap Checks

Global bootstrap checks should run in the background where possible.

Only show a blocking overlay when there is a real blocking user action, such as a required toolbox talk.
