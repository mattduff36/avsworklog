---
name: update help faqs
overview: Review and update the live `/help` FAQ content in the correct Supabase project, add missing module FAQs from the current app surface, and enforce module-based FAQ visibility server-side and in the editor.
todos:
  - id: export-faq
    content: Export and review the full current FAQ catalogue from the correct Supabase DB.
    status: pending
  - id: compare-modules
    content: Compare FAQs against current navigation, module permissions, routes, and report/API features.
    status: pending
  - id: schema-visibility
    content: Add and backfill FAQ category module gates, then enforce `/api/faq` server-side filtering.
    status: pending
  - id: admin-editor
    content: Update FAQ editor/API/types so category module gates are manageable.
    status: pending
  - id: content-updates
    content: Update stale FAQ content and add missing module/feature articles.
    status: pending
  - id: verify-summary
    content: Run focused verification and produce the manual review summary.
    status: pending
isProject: false
---

# Update `/help` FAQs And Visibility

## Scope

- Use only Supabase project `supabase-fuchsia-yacht` / `lrhufzqfzeutgvudcowy`.
- Treat the current live FAQ data as the content source: 15 categories and 64 published articles.
- Apply the strict visibility approach: FAQ content for restricted modules should not be returned from `/api/faq` unless the user can access the relevant module.

## Implementation Plan

- Re-read the migration guide before any database change: [docs/guides/HOW_TO_RUN_MIGRATIONS.md](../docs/guides/HOW_TO_RUN_MIGRATIONS.md).
- Export and review the full current FAQ catalogue from `faq_categories` and `faq_articles`, not just excerpts, then compare it against current navigation, pages, and APIs.
- Add a proper `module_name` field to `faq_categories` with values matching `ModuleName` from [types/roles.ts](../types/roles.ts), then backfill each existing category with the correct module where applicable. General categories like Getting Started and Troubleshooting can remain public.
- Update FAQ admin tooling so editors can assign a module gate when creating/editing categories:
  - [app/(dashboard)/admin/faq/page.tsx](../app/(dashboard)/admin/faq/page.tsx)
  - [app/api/admin/faq/categories/route.ts](../app/api/admin/faq/categories/route.ts)
  - [app/api/admin/faq/categories/[id]/route.ts](../app/api/admin/faq/categories/[id]/route.ts)
  - [types/faq.ts](../types/faq.ts)
- Update [app/api/faq/route.ts](../app/api/faq/route.ts) to filter categories and articles server-side using the same effective permission model as the rest of the app, so direct API calls only receive allowed FAQ content.
- Keep the `/help` page client filter as a UI safeguard, but align it with the shared permission snapshot/full-access behavior where needed.
- Update stale FAQ articles and add missing ones for current modules/features, especially Reports, split van/plant/HGV checks, absence reports, quotes, fleet asset history, inventory, maintenance vs workshop tasks, toolbox talk reports, and admin settings.
- Fix obvious `/help` FAQ-adjacent drift found during review, including the Errors tab loading bug where the code checks `activeTab === 'my-errors'` even though the real tab is `errors`.
- Verify with focused lint/type checks for edited files and a read-only DB check confirming categories have expected module gates and FAQ articles remain published/ordered.

## Content Review Focus

- Update outdated wording around "RAMS" versus current "Projects" navigation where the app now labels the module as Projects.
- Replace older "Vehicle Inspections" wording with the current split modules: Van Daily Checks, Plant Daily Checks, and HGV Daily Checks.
- Replace old Reports FAQ wording about generic Excel/bulk PDFs with the current reports hub: weekly timesheet summary, payroll export, daily checks compliance, defects log, bulk PDFs, absence bookings, allowance snapshot, weekly absence print PDF, and report suggestions.
- Correct Fleet/Maintenance wording so Fleet, Maintenance, asset history, and Workshop Tasks match the current routes and permission modules.
- Add missing coverage for Quotes, Inventory, Admin Settings, FAQ visibility/editor behavior, and Help support tools if absent from the current FAQ set.

## Manual Check Summary To Provide Afterwards

- List every changed FAQ article with old issue and new meaning.
- List every newly added FAQ article and its category/module gate.
- List category visibility gates so you can manually confirm the right users see the right FAQs.
- Highlight any content that still needs business confirmation rather than guessing.
