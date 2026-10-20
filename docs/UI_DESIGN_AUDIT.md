# UI design audit — 20 October 2026

Scope: source-pattern inventory of every `app/**/page.tsx` file, with targeted inspection of shared chrome, canonical Timesheets table, Policies workspace and External Documents workspace. This is a quick consistency audit, **not a browser inspection of every route**, exhaustive component review or accessibility certification. Pattern absence is a review lead, not automatically a defect. No company document contents were used.

## Review backlog

| ID | Priority | Evidence / inconsistency | Recommendation / status |
| --- | --- | --- | --- |
| B1 | High | `Navbar.tsx` has separate active/icon colour functions; `forms.ts`, `navigation.ts`, route accents, loader palettes and `MODULE_CSS_VAR` duplicate module presentation. Dashboard specially sorts Reminders first. | Consolidate presentation and primary ordering in a separate scoped change; retain permission and route distinctions. Policies colour omission fixed locally; global ordering remains deferred. |
| B2 | Medium | External Documents used plain loading paragraphs, raw dates, equal table columns and a decorative header icon. | Aligned list/detail loaders, dates, status and filters to the management-list recipe. Port-4000 desktop/mobile empty library and Add dialog checked; populated/reader/error views remain unverified in browser. |
| B3 | Medium | Fleet, Maintenance, Projects, all three inspection index pages, FAQ and Suggestions use manual headers despite shared shells; Workshop has custom chrome. | Review spacing/action alignment with screenshots before gradual adoption of AppPageHeader; do not rewrite domain workflows. |
| B4 | Medium | Fleet history, customer history, timesheet and inspection form/detail routes use bespoke headers/widths; some use fullscreen PageLoader for content fetches. | Compare detail/form families separately; retain back navigation, signatures and inspection workflows. |
| B5 | Medium | `globals.css` globally shrinks mobile font/spacing; Inventory has custom mobile nav and h-11 touch targets. | Browser audit at small widths and tablet mode before changing global sizing. Never infer accessible target sizes from desktop classes alone. |
| B6 | Low | Reports route accent differs from navbar management-yellow mapping; toolbox-talk tabs are a hard-coded red exception. | Resolve intended identity with owner, then unify mappings; do not silently recolour existing modules. |
| B7 | Medium | Existing registration tests cover permissions/metadata, not rendered navigation order or visual quality. | Add focused shared-presentation contract tests when centralising; keep screenshot review for layouts/states. |
| B8 | Medium | Policies used plain fetch loading, hand-built search, crowded actions and default statuses. | Addressed in this pass with existing primitives; browser results reported separately. |
| B9 | Medium | Daily Allocation put the latest publication on the header details line and truncated the publish-disabled reason. Legacy board and issued cards used brighter default status chips. | Moved publication metadata into actions, retained full publish reason and muted issued metadata. Port-4000 desktop board/history checked read-only. Follow-up corrected stale interaction fixtures and reused provisional plan identity; all 40 board/header UI tests pass. |

## Intentional exceptions

Authentication, offline/PDF screens, kiosk pairing/recovery and workshop display board have different jobs from management lists. Daily Allocation remains a schedule board; only its header, legacy controls and issued cards were aligned. Profile is a hub; Inventory includes specialist mobile navigation. These are not generic templates and should not be standardised blindly. Legacy `/rams` routes and routing aliases do not require duplicate UI.

## Complete page-file inventory

77 page files inventoried. Components below are detected in route source; delegated implementations are identified where examined. All routes remain subject to visual review unless explicitly verified in the task result.

| Route | Source | Family | Shared components in route | Review note |
| --- | --- | --- | --- | --- |
| `/change-password` | `app/(auth)/change-password/page.tsx` | Authentication | PageLoader | Intentional standalone shell; preserve password/mobile behaviour. |
| `/login` | `app/(auth)/login/page.tsx` | Authentication | Custom / delegated | Intentional standalone shell; preserve password/mobile behaviour. |
| `/absence/archive-report` | `app/(dashboard)/absence/archive-report/page.tsx` | Module / list | AppPageShell, PageLoader | Review manual header / shell consistency; absence of shared import is a signal, not proof of a defect. |
| `/absence/manage` | `app/(dashboard)/absence/manage/page.tsx` | Module / list | AppPageShell, AppPageHeader, AppPageLoadingShell | Shared shell/header present; visual verification pending. |
| `/absence` | `app/(dashboard)/absence/page.tsx` | Module / list | AppPageShell, AppPageHeader, AppPageLoadingShell | Shared shell/header present; visual verification pending. |
| `/actions` | `app/(dashboard)/actions/page.tsx` | Module / list | AppPageShell, AppPageHeader, AppPageLoadingShell | Shared shell/header present; visual verification pending. |
| `/admin/errors/manage` | `app/(dashboard)/admin/errors/manage/page.tsx` | Module / list | AppPageShell, AppPageLoadingShell, PanelLoader | Review manual header / shell consistency; absence of shared import is a signal, not proof of a defect. |
| `/admin/faq` | `app/(dashboard)/admin/faq/page.tsx` | Module / list | AppPageShell, AppPageLoadingShell, PanelLoader | Review manual header / shell consistency; absence of shared import is a signal, not proof of a defect. |
| `/admin/settings` | `app/(dashboard)/admin/settings/page.tsx` | Module / list | AppPageShell, AppPageLoadingShell, PanelLoader | Review manual header / shell consistency; absence of shared import is a signal, not proof of a defect. |
| `/admin/users` | `app/(dashboard)/admin/users/page.tsx` | Module / list | AppPageShell, AppPageHeader, PanelLoader, PageLoader | Shared shell/header present; visual verification pending. |
| `/admin/vehicles` | `app/(dashboard)/admin/vehicles/page.tsx` | Redirect / routing | PageLoader | No standalone visual standard required; verify destination. |
| `/approvals` | `app/(dashboard)/approvals/page.tsx` | Module / list | AppPageShell, AppPageHeader, AppPageLoadingShell, SectionLoader, DataViewToggle | Shared shell/header present; visual verification pending. |
| `/customers/[id]/history` | `app/(dashboard)/customers/[id]/history/page.tsx` | Detail / form | PageLoader | Review manual header / shell consistency; absence of shared import is a signal, not proof of a defect. |
| `/customers` | `app/(dashboard)/customers/page.tsx` | Module / list | AppPageShell, AppPageHeader, PageLoader | Shared shell/header present; visual verification pending. |
| `/daily-allocation/jobs/[code]` | `app/(dashboard)/daily-allocation/jobs/[code]/page.tsx` | Detail / form | AppPageShell, AppPageHeader, AppPageLoadingShell | Shared shell/header present; visual verification pending. |
| `/daily-allocation/my` | `app/(dashboard)/daily-allocation/my/page.tsx` | Module / list | AppPageShell, AppPageHeader, AppPageLoadingShell | Issued-card hierarchy updated in source (B9). Browser verification not run. |
| `/daily-allocation` | `app/(dashboard)/daily-allocation/page.tsx` | Allocation board | AppPageShell, AppPageHeader, AppPageLoadingShell | Specialist full-width board retained. Header publication label and publish reason updated in source (B9). Browser verification not run. |
| `/dashboard` | `app/(dashboard)/dashboard/page.tsx` | Module / list | AppPageShell, AppPageLoadingShell, SectionLoader | Review manual header / shell consistency; absence of shared import is a signal, not proof of a defect. |
| `/debug` | `app/(dashboard)/debug/page.tsx` | Module / list | AppPageShell, PanelLoader, PageLoader | Review manual header / shell consistency; absence of shared import is a signal, not proof of a defect. |
| `/errors/manage` | `app/(dashboard)/errors/manage/page.tsx` | Redirect / routing | PageLoader | No standalone visual standard required; verify destination. |
| `/external-documents` | `app/(dashboard)/external-documents/page.tsx` | Module / list | AppPageShell, AppPageHeader, AppPageLoadingShell | Delegates ExternalDocumentsWorkspace. List/detail loading, dates, status and filters aligned in source (B2). Browser verification not run. |
| `/fleet/hgvs/[hgvId]/history` | `app/(dashboard)/fleet/hgvs/[hgvId]/history/page.tsx` | Detail / form | PanelLoader | Review manual header / shell consistency; absence of shared import is a signal, not proof of a defect. |
| `/fleet` | `app/(dashboard)/fleet/page.tsx` | Module / list | AppPageShell, PanelLoader, PageLoader | Review manual header / shell consistency; absence of shared import is a signal, not proof of a defect. |
| `/fleet/plant/[plantId]/history` | `app/(dashboard)/fleet/plant/[plantId]/history/page.tsx` | Detail / form | Custom / delegated | Review manual header / shell consistency; absence of shared import is a signal, not proof of a defect. |
| `/fleet/vans/[vanId]/history` | `app/(dashboard)/fleet/vans/[vanId]/history/page.tsx` | Detail / form | PanelLoader | Review manual header / shell consistency; absence of shared import is a signal, not proof of a defect. |
| `/fleet/vehicles/[vehicleId]/history` | `app/(dashboard)/fleet/vehicles/[vehicleId]/history/page.tsx` | Redirect / routing | Custom / delegated | No standalone visual standard required; verify destination. |
| `/help` | `app/(dashboard)/help/page.tsx` | Module / list | PanelLoader, SearchInput | Review manual header / shell consistency; absence of shared import is a signal, not proof of a defect. |
| `/help/version-history` | `app/(dashboard)/help/version-history/page.tsx` | Module / list | AppPageShell, AppPageHeader | Shared shell/header present; visual verification pending. |
| `/hgv-inspections/[id]` | `app/(dashboard)/hgv-inspections/[id]/page.tsx` | Detail / form | PageLoader | Review manual header / shell consistency; absence of shared import is a signal, not proof of a defect. |
| `/hgv-inspections/new` | `app/(dashboard)/hgv-inspections/new/page.tsx` | Detail / form | PageLoader | Review manual header / shell consistency; absence of shared import is a signal, not proof of a defect. |
| `/hgv-inspections` | `app/(dashboard)/hgv-inspections/page.tsx` | Module / list | AppPageShell, AppPageLoadingShell, PanelLoader, DataViewToggle | Review manual header / shell consistency; absence of shared import is a signal, not proof of a defect. |
| `/inventory/items/[itemId]` | `app/(dashboard)/inventory/items/[itemId]/page.tsx` | Specialist module | AppPageShell, AppPageHeader, PageLoader | Shared shell plus custom mobile/navigation; preserve until separately reviewed. |
| `/inventory/kiosk-control` | `app/(dashboard)/inventory/kiosk-control/page.tsx` | Redirect / routing | Custom / delegated | No standalone visual standard required; verify destination. |
| `/inventory` | `app/(dashboard)/inventory/page.tsx` | Specialist module | AppPageShell, AppPageHeader, AppPageLoadingShell, PanelLoader | Shared shell plus custom mobile/navigation; preserve until separately reviewed. |
| `/maintenance` | `app/(dashboard)/maintenance/page.tsx` | Module / list | AppPageShell, PanelLoader, PageLoader | Review manual header / shell consistency; absence of shared import is a signal, not proof of a defect. |
| `/notifications` | `app/(dashboard)/notifications/page.tsx` | Module / list | PanelLoader | Review manual header / shell consistency; absence of shared import is a signal, not proof of a defect. |
| `/pdf-viewer` | `app/(dashboard)/pdf-viewer/page.tsx` | Utility / viewer | PageLoader | Purpose-specific screen; do not force management-list chrome. |
| `/plant-inspections/[id]` | `app/(dashboard)/plant-inspections/[id]/page.tsx` | Detail / form | PageLoader | Review manual header / shell consistency; absence of shared import is a signal, not proof of a defect. |
| `/plant-inspections/new` | `app/(dashboard)/plant-inspections/new/page.tsx` | Detail / form | PageLoader | Review manual header / shell consistency; absence of shared import is a signal, not proof of a defect. |
| `/plant-inspections` | `app/(dashboard)/plant-inspections/page.tsx` | Module / list | AppPageShell, AppPageLoadingShell, PanelLoader, DataViewToggle | Review manual header / shell consistency; absence of shared import is a signal, not proof of a defect. |
| `/policies-procedures` | `app/(dashboard)/policies-procedures/page.tsx` | Module / list | AppPageLoadingShell | Delegates PoliciesWorkspace; plain loader/search/row actions addressed in this pass. |
| `/profile` | `app/(dashboard)/profile/page.tsx` | Specialist module | AppPageShell, PanelLoader | Shared shell plus custom mobile/navigation; preserve until separately reviewed. |
| `/projects/[id]` | `app/(dashboard)/projects/[id]/page.tsx` | Detail / form | PageLoader | Review manual header / shell consistency; absence of shared import is a signal, not proof of a defect. |
| `/projects/[id]/read` | `app/(dashboard)/projects/[id]/read/page.tsx` | Detail / form | PageLoader | Review manual header / shell consistency; absence of shared import is a signal, not proof of a defect. |
| `/projects/manage` | `app/(dashboard)/projects/manage/page.tsx` | Module / list | AppPageShell, AppPageLoadingShell, PanelLoader | Review manual header / shell consistency; absence of shared import is a signal, not proof of a defect. |
| `/projects` | `app/(dashboard)/projects/page.tsx` | Module / list | AppPageShell, AppPageLoadingShell | Review manual header / shell consistency; absence of shared import is a signal, not proof of a defect. |
| `/projects/settings` | `app/(dashboard)/projects/settings/page.tsx` | Module / list | PageLoader | Review manual header / shell consistency; absence of shared import is a signal, not proof of a defect. |
| `/quotes/overview/[reference]` | `app/(dashboard)/quotes/overview/[reference]/page.tsx` | Detail / form | AppPageShell, AppPageHeader, PageLoader | Shared shell/header present; visual verification pending. |
| `/quotes` | `app/(dashboard)/quotes/page.tsx` | Module / list | AppPageShell, PageLoader | Review manual header / shell consistency; absence of shared import is a signal, not proof of a defect. |
| `/quotes/work-calendar` | `app/(dashboard)/quotes/work-calendar/page.tsx` | Module / list | AppPageShell, AppPageHeader, PageLoader | Shared shell/header present; visual verification pending. |
| `/rams/[id]` | `app/(dashboard)/rams/[id]/page.tsx` | Detail / form | Custom / delegated | Review manual header / shell consistency; absence of shared import is a signal, not proof of a defect. |
| `/rams/[id]/read` | `app/(dashboard)/rams/[id]/read/page.tsx` | Detail / form | Custom / delegated | Review manual header / shell consistency; absence of shared import is a signal, not proof of a defect. |
| `/rams/manage` | `app/(dashboard)/rams/manage/page.tsx` | Module / list | Custom / delegated | Review manual header / shell consistency; absence of shared import is a signal, not proof of a defect. |
| `/rams` | `app/(dashboard)/rams/page.tsx` | Module / list | Custom / delegated | Review manual header / shell consistency; absence of shared import is a signal, not proof of a defect. |
| `/reminders` | `app/(dashboard)/reminders/page.tsx` | Module / list | AppPageShell, AppPageHeader, AppPageLoadingShell, PanelLoader | Shared shell/header present; visual verification pending. |
| `/reports` | `app/(dashboard)/reports/page.tsx` | Module / list | AppPageShell, AppPageHeader, AppPageLoadingShell, PanelLoader | Shared shell/header present; visual verification pending. |
| `/suggestions/manage` | `app/(dashboard)/suggestions/manage/page.tsx` | Module / list | AppPageShell, AppPageLoadingShell, PanelLoader | Review manual header / shell consistency; absence of shared import is a signal, not proof of a defect. |
| `/test-error-logging` | `app/(dashboard)/test-error-logging/page.tsx` | Diagnostic | PageLoader | Not a reference for new modules. |
| `/timesheets/[id]` | `app/(dashboard)/timesheets/[id]/page.tsx` | Detail / form | PageLoader | Review manual header / shell consistency; absence of shared import is a signal, not proof of a defect. |
| `/timesheets/new` | `app/(dashboard)/timesheets/new/page.tsx` | Detail / form | PageLoader | Review manual header / shell consistency; absence of shared import is a signal, not proof of a defect. |
| `/timesheets` | `app/(dashboard)/timesheets/page.tsx` | Module / list | AppPageShell, AppPageHeader, AppPageLoadingShell, PanelLoader, DataViewToggle | Shared shell/header present; visual verification pending. |
| `/toolbox-talks` | `app/(dashboard)/toolbox-talks/page.tsx` | Module / list | AppPageShell, AppPageHeader, AppPageLoadingShell | Shared shell/header present; visual verification pending. |
| `/training` | `app/(dashboard)/training/page.tsx` | Module / list | AppPageShell, AppPageHeader, AppPageLoadingShell, PanelLoader | Shared shell/header present; visual verification pending. |
| `/van-inspections/[id]` | `app/(dashboard)/van-inspections/[id]/page.tsx` | Detail / form | PageLoader | Review manual header / shell consistency; absence of shared import is a signal, not proof of a defect. |
| `/van-inspections/new` | `app/(dashboard)/van-inspections/new/page.tsx` | Detail / form | PageLoader | Review manual header / shell consistency; absence of shared import is a signal, not proof of a defect. |
| `/van-inspections` | `app/(dashboard)/van-inspections/page.tsx` | Module / list | AppPageShell, AppPageLoadingShell, PanelLoader, DataViewToggle | Review manual header / shell consistency; absence of shared import is a signal, not proof of a defect. |
| `/workshop-tasks` | `app/(dashboard)/workshop-tasks/page.tsx` | Module / list | AppPageLoadingShell, PanelLoader | Review manual header / shell consistency; absence of shared import is a signal, not proof of a defect. |
| `/displayboard-workshop` | `app/displayboard-workshop/page.tsx` | Kiosk / display board | Custom / delegated | Intentional device/full-screen layout; assess touch and recovery separately. |
| `/offline` | `app/offline/page.tsx` | Utility / viewer | Custom / delegated | Purpose-specific screen; do not force management-list chrome. |
| `/` | `app/page.tsx` | Redirect / routing | Custom / delegated | No standalone visual standard required; verify destination. |
| `/pwa-debug/bank-holiday-e2e` | `app/pwa-debug/bank-holiday-e2e/page.tsx` | Diagnostic | Custom / delegated | Not a reference for new modules. |
| `/pwa-debug` | `app/pwa-debug/page.tsx` | Diagnostic | Custom / delegated | Not a reference for new modules. |
| `/yard-kiosk/install` | `app/yard-kiosk/install/page.tsx` | Kiosk / display board | Custom / delegated | Intentional device/full-screen layout; assess touch and recovery separately. |
| `/yard-kiosk/native` | `app/yard-kiosk/native/page.tsx` | Kiosk / display board | Custom / delegated | Intentional device/full-screen layout; assess touch and recovery separately. |
| `/yard-kiosk` | `app/yard-kiosk/page.tsx` | Redirect / routing | Custom / delegated | No standalone visual standard required; verify destination. |
| `/yard-kiosk/pair` | `app/yard-kiosk/pair/page.tsx` | Kiosk / display board | Custom / delegated | Intentional device/full-screen layout; assess touch and recovery separately. |
| `/yard-kiosk/recover` | `app/yard-kiosk/recover/page.tsx` | Kiosk / display board | Custom / delegated | Intentional device/full-screen layout; assess touch and recovery separately. |


## Policies implementation verification

- Application `npm run typecheck`: passed.
- `tee-v2-context`, `policies-procedures-access`, `policies-procedures`: 13 tests passed across three files.
- Chrome against isolated local preview on port 4002: populated desktop list (73 documents), shared loading indicator, row action menu, history dialog, no search matches and clear filters, mobile list at requested 390x844 viewport (browser-reported CSS width 355), reader-only published document and denied-access screen checked. Viewport restored afterwards. No records were published/archived/uploaded during this UI pass.
- Reader preview used its existing single published fixture; shared database publication state was not changed.
- Retry/error and completely empty-library presentation are implemented and source-reviewed but not browser-forced. Production PIN/auth and full app navbar were not re-exercised; server/access logic unchanged. No production build or deployment.
- Policies-only navbar palette entries and shared loader palette added. Global navigation-order consolidation remains B1. External Documents and Daily Allocation were updated in a later source pass (B2, B9); that pass did not repeat this browser check.
- Local direct runner hit environment EPERM errors; focused verification succeeded through the existing authorised Desktop Commander connection without changing permission configuration.
