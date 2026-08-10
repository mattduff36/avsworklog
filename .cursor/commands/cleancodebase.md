# /cleancodebase

1. Use AskQuestion to choose:
   - Quick: `npm run audit:quick`
   - Medium: `npm run audit:medium`
   - Full: ensure the dev server is available on port 4000, then run `npm run audit:all`
2. Run the selected audit only after the choice.
3. Group findings as high, medium, or low with tool, location, description, and concrete fix.
4. Use AskQuestion for approval before editing.
5. Apply approved fixes in cohesive file groups and rerun only the affected checks until stable.
6. Commit locally with `type(scope): summary`. Never push without separate authorization.
