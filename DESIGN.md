# Design (current UI)

This is the live Squires visual contract. It is not a generic shadcn/Tailwind style guide. Inspect one named reference page before inventing chrome.

The app is a **dark-only authenticated PWA**. `html` is forced `class="dark"` with `color-scheme: dark`. Light-mode classes exist as leftovers; do not design for a light theme.

## Visual principles

- Dense operational UI: lists, filters, tabs, and dialogs over marketing layout.
- Slate surfaces on a fixed slate gradient body (`from-slate-800 via-slate-900 to-slate-950` in the dashboard shell; body also paints `#0f172a` → slate-800).
- AVS yellow is brand chrome. Module colour is route accent, not a second theme.
- Desktop prefers tables and compact controls. Mobile is intentionally compressed by a global scale-down, then some newer pages add larger touch targets.
- Reuse `components/ui/*` and `AppPageShell`. Do not invent a parallel card/header system.

## Theme and tokens

Canonical tokens live in [`app/globals.css`](app/globals.css).

Semantic HSL tokens (used as `hsl(var(--token))`): `--background`, `--foreground`, `--card`, `--popover`, `--primary` (AVS yellow by default), `--secondary`, `--muted`, `--accent` (slate, not module colour), `--destructive`, `--success`, `--warning`, `--error`, `--border`, `--input`, `--ring`, `--radius` (`0.625rem`).

Brand yellow utilities (hex, not HSL): `.bg-avs-yellow` `#F1D64A`, `.bg-avs-yellow-hover` `#d1b82f`, `.text-avs-yellow`, `.border-avs-yellow`. CSS variables `--avs-yellow` / `--avs-yellow-hover` / `--avs-yellow-light` also exist.

Font: Inter via `--font-inter` on `body`. Headings on standard pages are `text-3xl font-bold text-foreground`. Descriptions are `text-sm text-muted-foreground`.

`--top-nav-h` is `68px`, plus safe-area in standalone PWA.

## Module accent

`DashboardLayoutClient` sets `data-accent={getAccentFromRoute(pathname)}` on the dashboard root. That remaps `--primary` and `--ring` for the route.

Verified route keys in `lib/theme/getAccentFromRoute.ts`:

| Accent key | Routes |
| --- | --- |
| `timesheets` | `/timesheets` |
| `inspections` | `/van-inspections` |
| `plant-inspections` | `/plant-inspections` |
| `hgv-inspections` | `/hgv-inspections` |
| `rams` | `/projects`, `/rams` (middleware 301s `/rams` → `/projects`) |
| `absence` | `/absence` |
| `maintenance` | `/maintenance` |
| `workshop` | `/workshop-tasks` |
| `inventory` | `/inventory` |
| `reminders` | `/reminders` |
| `daily-allocation` | `/daily-allocation` |
| `external-documents` | `/external-documents` |
| `policies-procedures` | `/policies-procedures` |
| `debug` | `/debug` |
| `fleet` | `/fleet` |
| `brand` | everything else, including `/reports`, `/dashboard`, `/help`, `/approvals`, `/actions`, `/toolbox-talks`, `/suggestions/manage`, `/admin/*`, `/quotes`, `/customers`, `/profile` |

`/reports` uses brand yellow with dark `--primary-foreground`. The `reports` accent key remains only for legacy loader mapping. `--report-primary`, `--report-light`, `--report-dark`, and `[data-accent="reports"]` match that yellow and dark foreground; they are not a green reports accent.

Live primary hues (do not trust stale comments): timesheets blue; van inspections orange; plant inspections brown-orange; HGV inspections deep orange; RAMS/projects green; absence purple; maintenance red; debug red; **fleet teal** (`190 70% 42%`, not rust); workshop clay; inventory slate-blue; reminders cyan; daily allocation blue. Brand yellow, including Reports, keeps dark `--primary-foreground`; other module accents use light foreground.

Each module also has `.bg-*`, `.bg-*-light`, `.bg-*-dark`, `.text-*`, `.border-*` utilities. Inventory, reminders, and daily allocation also have `.bg-*-soft`.

`lib/utils/module-brand-presentation.ts` supplies tinted card/thumbnail classes for dashboard tiles. `types/roles.ts` `MODULE_CSS_VAR` maps permission modules to CSS variables; Reports and several other management modules point at `--avs-yellow`. **Route accent wins for `data-accent`, and `/reports` is brand.**

**How to use colour**

- Navbar wordmark and house icon stay AVS yellow. Standard module headers omit decorative icons; where a specialist header icon is explicitly approved, its `AppPageHeader` icon well defaults to `bg-avs-yellow/15 text-avs-yellow` unless overridden.
- Primary in-page actions on a coloured module should use that module utility (`bg-inventory`, `bg-workshop`, …) with explicit light text. Do not assume `bg-primary` is readable: module `--primary-foreground` is light, brand yellow’s is dark.
- Do not flood a page with module colour. Use it for selected tabs, primary CTAs, loaders, and a few tinted chips.

Active tabs are globally forced to `--primary` in `globals.css` (`[role="tab"][data-state="active"]`). Toolbox-talk tabs are a hard-coded red exception.

## Page shell and header

Stable recipe for a new dashboard page:

1. `AppPageShell` (`mx-auto w-full space-y-6`, default `max-w-6xl`). Widths: `narrow` 4xl, `medium` 5xl, `default` 6xl, `wide` 7xl, `full` none.
2. `AppPageHeader` with `title`, one optional short `description`, optional `actions`, and Beta badge in `titleMeta` when applicable. Standard module title bars have no decorative icon or extra information/footer line. Icon/footer slots are for explicitly approved specialist exceptions, not the new-module default. Match the loading header to the same convention.
3. `Card` / table / tabs below.

The dashboard content column is separately capped at `max-w-7xl mx-auto px-4 sm:px-6 lg:px-8` in `DashboardContent`, except:

- user widescreen preference (`app-widescreen-enabled`)
- `/daily-allocation` manager board (`isDashboardFullWidthPath`)

Never wrap a page in a bare `max-w-*` without `mx-auto`. That left-aligns inside the app column.

Header surface: `rounded-lg border border-border bg-white dark:bg-slate-900` plus `p-6` (or `p-4` when a footer strip is used). In this dark-only app that is a slate-900 card.

Loading counterpart: `AppPageLoadingShell` (same header + `SectionLoader`).

Auth routes use `app/(auth)/layout.tsx` with no dashboard chrome. Login opts out of the global mobile scale-down.

## Shared primitives

Copy from `components/ui/` unless a named reference already specialises:

- Canonical: `button`, `card`, `input`, `select`, `dialog`, `alert-dialog`, `tabs`, `table`, `badge`, `search-input`, `status-filter`, `multi-select-filter`, `data-view-controls`, `sonner`, `page-loader` / `page-loading-screen`, `service-unavailable-state`.
- Specialised — do not generalise: `once-ui` (add-asset), `selectable-card` (RAMS/timesheet/inspection/absence pickers), Inventory mobile chrome.

`Badge` is small but its default variant uses the route primary colour. Use explicit semantic variants/classes for status; do not treat every status as a primary action. Put status colour on the badge or a chip, not on the whole card. Dashboard home tiles use `lib/utils/module-brand-presentation.ts` for tinted surfaces; that helper is for the home grid, not a second page-card system. Do not invent a matching tile kit on other routes.

**Fleet service-type badges:** Reuse `components/fleet/ServiceTypeBadge.tsx` in fleet tables and cards. The approved style has square corners, a `#1e293b` slate background, `#64748b` border and `#f1f5f9` text. Keep the compact 10px semibold label, 16px line height, 6px horizontal padding, and a 6px circular marker with a 4px gap. Marker colours are Basic A `#00ffcc`, Basic B `#3399ff`, Full `#c77dff`, needs choosing `#ffd400`, and unrecognised types `#f8fafc`. Mark the decorative dot `aria-hidden`; always retain the service label. This styling is specific to service types; mileage/date status badges retain their separate urgency colours.

## Surfaces and borders

- Default card: `rounded-lg border bg-slate-900` (`components/ui/card.tsx`). Prefer adding `border-border` or `border-slate-700` explicitly on new cards.
- Softer experimental surfaces (Inventory): `border-slate-700/60 bg-slate-900/60` or `bg-slate-900/70`. Do not make that the default.
- Dialogs: `globals.css` forces `[role="dialog"]` / `[role="alertdialog"]` to card background, `1px` border, `z-index: 200`. Dropdowns/popovers sit at `z-250`.
- Dropdown menus must have an opaque slate surface (`bg-popover`), readable foreground, border and visible focus state. Tailwind v4 semantic utilities must be registered in `@theme inline`; defining the raw CSS token alone does not generate a utility. Let Radix position its content within its portal wrapper: never force `position: fixed` on `[data-side]`. Verify the menu opens beside its trigger, stays inside the viewport, and closes with Escape with focus returned to the trigger.
- Border strength is usually `border-border` (slate-800) or `border-slate-600` / `border-slate-700` on controls.

## Typography

- Page title: `text-3xl font-bold`.
- Card title primitive: `text-2xl font-semibold`.
- Body / table: `text-sm`. Inputs are `text-base` on small screens and `md:text-sm` to avoid iOS zoom.
- Muted: `text-muted-foreground` or `text-slate-300` / `text-slate-400`.
- Table helper/secondary lines (references, categories, file formats and supporting metadata) use `text-xs text-muted-foreground` (light grey/slate-400), visibly quieter than the primary title/value. Check the computed colour in the browser; a smaller font alone is not a muted hierarchy. Preserve explicit status and overdue colours.
- Placeholders are forced muted/slate-400.

A `@media (max-width: 768px)` block in `globals.css` shrinks `html` to `12.8px` and overrides many spacing/type utilities. Profile mobile text-size steps (`data-mobile-text-size`, 1–5) further scale `html` under `767px`. Display-board text size is a separate `data-display-board-text-size` scale.

## Buttons and actions

`Button` variants: `default` (primary), `destructive`, `outline`, `secondary`, `ghost`, `link`. Sizes: `default` `h-9`, `sm` `h-8`, `lg` `h-10`, `icon` `h-9`.

Desktop module CTAs are often `h-8`–`h-9`. Inventory’s documented escape hatch is **`h-11` on mobile / `h-8` on `md+`**. The global mobile CSS remaps `.h-8`, `.h-10`, `.h-12`, `.h-14` but **not `.h-11`**, which is why Inventory uses it for touch.

Primary actions inside dark dialogs need explicit background and foreground. Page-level `data-accent` can make the default `Button` unreadable on the dialog surface. Prefer a concrete pair such as `bg-emerald-600 text-white` or the module’s dark utility. Cancel stays `variant="outline"`.

Do not use `alert()` / `confirm()`. Use Sonner (`toast` from `sonner`) and `AlertDialog`.

## Tabs and navigation

Canonical desktop tabs: `Tabs` / `TabsList` / `TabsTrigger` from `components/ui/tabs.tsx`. `TabsList` is `min-h-9`, `flex-wrap`, `bg-muted`, `p-1`. **No inter-tab gap** on standard lists (`gap-0` or default). `gap-2` belongs on `TabsTrigger` (icon + label), not on `TabsList`, unless the component already branches on tablet mode (`flex-wrap gap-2 p-1.5`).

Navbar (`components/layout/Navbar.tsx`) is the global chrome: SQUIRES wordmark, module links from `lib/config/navigation.ts`, notifications, tablet toggle, profile. Manager/admin users also get `SidebarNav` (icon rail; content offsets with `md:pl-16`).

`MobileNavBar` currently **returns `null`**. Do not treat a bottom app tab bar as shipped chrome.

Inventory replaces desktop tab rows with custom mobile primary/secondary nav. That is module-specific. See “Inventory” below.

## Search, filters, view controls

Canonical shared controls:

- `SearchInput` — `h-10`, search icon, `text-[16px]` on mobile / `md:text-sm`.
- `StatusFilter` — wrap of outline `sm` buttons; selected is `bg-white text-slate-900`.
- `MultiSelectFilter` — multi-value filter dropdown.
- `DataViewToggle` + `ColumnVisibilityMenu` (`data-view-controls.tsx`) — table/cards switch and column picker.
- `Select` trigger is `h-9`. `Input` is `h-10`.

URL tab/filter state uses `nuqs` only on some pages (inspections, approvals, reports, notifications, profile), each wrapping `NuqsClientAdapter` locally. Other pages use `useSearchParams` / local state. Follow the page you are editing.

## Tables versus cards

Desktop management lists are tables (`components/ui/table.tsx`, `text-sm`). Cards are for:

- dashboard tiles
- employee issued views (Daily Allocation `/my`)
- mobile list alternatives (Projects manage has `ProjectsDocumentsMobileCards`)
- summary metrics

Timesheets is a table + `DataViewToggle` reference (its current saved/default view may be cards); copy the relevant table component, not the whole page. Inventory’s desktop table is fine to copy; its mobile cards/nav are not the default.

## Forms and dialogs

Most forms are controlled React state plus Zod on the server. `react-hook-form` exists only in a few maintenance/fleet dialogs — do not mandate it.

Use `Dialog` / `AlertDialog`. `DialogContent` supports `size`, `scroll`, `mobileKeyboardSafe`, and visual-viewport compensation for the mobile keyboard. Keep dialogs inside `100dvh` and safe-area insets. Destructive confirms use `AlertDialog`.

`OnceDialog` (`components/ui/once-ui.tsx`) is only for the add-asset flow. Do not use it on new pages.

`SelectableCard` is a specialised picker (RAMS/timesheet/inspection/absence variants), not a general list row.

## States

| State | Current representation |
| --- | --- |
| Full-page auth/boot | `PageLoader` → `PageLoadingScreen` (shared animated progress bar with route accent) |
| Page ready, body loading | `AppPageLoadingShell` or `SectionLoader` / `PanelLoader` |
| Empty | in-page muted copy or an empty `Card`, not a shared empty component |
| Service outage | `ServiceUnavailableState` (amber card) and `DatabaseOutageBlocker` |
| Inline error | `ErrorMessage` / `ErrorDetailsModal`; toast for failed mutations |
| No module access | `usePermissionCheck` toast + redirect, or an `AppPageHeader` explanation (Daily Allocation) |
| Sensitive modules | `SensitiveModuleGate` PIN wall (users, quotes, debug, …) |

Fail closed while permission snapshots are loading.

## Responsive, tablet, PWA

- Viewport: `device-width`, `viewportFit: "cover"`, theme colour `#0f172a`.
- Standalone PWA: `data-standalone-pwa`, extra top safe-area, `--top-nav-h` includes `env(safe-area-inset-top)`.
- Date/time inputs are width-constrained for iOS.
- Pull-to-refresh exists in the dashboard shell.
- Tablet mode (`data-tablet-mode="on"`) is opt-in and still labelled incomplete in the info dialog. Larger `min-h-11` controls and wrapping tabs appear only where the page already branches on `useTabletMode()`.
- Widescreen is a user preference, not a page default, except the Daily Allocation board.

Keep `16px` text on focused mobile inputs. Inventory sticky mobile nav must sit under `top: var(--top-nav-h)`.

## Accessibility and motion

Focus rings are already on the primitives (`focus-visible:ring-ring`). Preserve them. Icon-only controls need `aria-label`. Selected toggles use `aria-pressed`.

Motion is mostly `transition-colors` / `transition-all duration-200`. Dialog overlay uses Radix animate-in/out. Do not add decorative animation. `active:scale-95` appears on some module CTAs; optional, not required.

## Inventory: reusable versus experimental

Reusable: `AppPageShell` on the list/detail routes; compact header `p-4`; module-coloured CTA (`bg-inventory`); `h-11` / `md:h-8` touch split; desktop summary cards; desktop `Tabs` with no list gap; `SearchInput` + filters; focus rings using inventory.

Page-specific / do not copy as default: custom mobile header card (`rounded-xl`, `text-lg` title); mobile primary nav that paints **AVS yellow** underlines while CTAs stay inventory; secondary 2-column nav; sticky blurred nav; portal’d mobile chrome; summary cards hidden on mobile in favour of chips.

## Anti-patterns

- Hand-rolling a header that copies Workshop (`bg-white dark:bg-slate-900` block instead of `AppPageHeader`).
- Treating Inventory mobile chrome, Profile settings tiles, or the Daily Allocation board as the generic page template.
- Using `OnceDialog` outside add-asset.
- Adding `gap-2` to a normal `TabsList`.
- Assuming light theme or `bg-white` text colours without `dark:` counterparts.
- Using `bg-primary` for a dialog save button without checking contrast.
- Introducing a bottom mobile nav (`MobileNavBar` is unused).
- New left-aligned `max-w-*` page wrappers.
- Broad UI migrations “to match Inventory”.

## New-page recipe

1. Read this file and `.cursor/rules/app-page-shell.mdc`.
2. Copy the closest named reference, not a random large page.
3. Wrap with `AppPageShell` + `AppPageHeader`.
4. Gate with `usePermissionCheck` / `useModuleAccessLevel` for UX; enforce on the server.
5. Use `SearchInput` and the appropriate shared filters. Add `DataViewToggle` only when both views solve a real task; it is not required on every list.
6. Desktop management table; on mobile preserve essential information and usable actions with a deliberate compact layout or cards. Never squeeze an action-heavy desktop table to fit.
7. Tabs: no list gap unless tablet mode already wraps.
8. Toasts + `AlertDialog`; loaders from `AppPageLoadingShell` / `PanelLoader`.
9. Keep module colour on primary CTA and active tab; keep header icon yellow unless the reference overrides it.

## Canonical references

**Use**

- New standard module page: `app/(dashboard)/timesheets/page.tsx`
- Tabbed asset module: `app/(dashboard)/fleet/page.tsx` (tabs/organisation only; its manual header is legacy, use AppPageHeader)
- Employee issued/read view: `app/(dashboard)/daily-allocation/my/page.tsx`
- Dense admin table + dialogs: `app/(dashboard)/admin/users/page.tsx`
- Shared shell primitives: `components/layout/AppPageShell.tsx`, `components/layout/AppPageLoadingShell.tsx`
- Shared list controls: `components/ui/search-input.tsx`, `components/ui/status-filter.tsx`, `components/ui/data-view-controls.tsx`

**Do not treat as the default template**

- `app/(dashboard)/workshop-tasks/page.tsx` — hand-rolled header; tablet experiments
- `app/(dashboard)/inventory/page.tsx` and `app/(dashboard)/inventory/components/InventoryPageChrome.tsx` — mixed successful and experimental mobile chrome
- `app/(dashboard)/profile/page.tsx` — hub/tile navigation
- `app/(dashboard)/daily-allocation/page.tsx` — schedule board; follow `PRODUCT.md` for behaviour
- `components/daily-allocation/LegacyDailyAllocationManager.tsx` — legacy board
- `components/ui/once-ui.tsx` — add-asset only
- `components/layout/MobileNavBar.tsx` — not shipped


## Required composition for new management lists

This is the target for new and substantially revised UI. Existing exceptions are tracked in [UI_DESIGN_AUDIT.md](docs/UI_DESIGN_AUDIT.md); their presence is not permission to copy them. A library import alone does not meet this standard.

- **Header:** AppPageShell + AppPageHeader; title, one short optional description, optional Beta badge in titleMeta, one clear primary action. No decorative title icon or additional information/footer line on standard modules. Put essential workflow help beside the relevant control or inside its dialog. No invented statistics or decorative metric cards.
- **List surface:** one bordered Card containing a consistently padded toolbar and list; avoid nested cards on desktop. SearchInput grows, labelled Select/MultiSelectFilter controls wrap. Keep refresh separate from destructive actions. Show result count and a clear-filter action when filtered.
- **Table:** use components/ui/table, text-sm, muted header and aligned cells. Give the main entity the most width; title is prominent, reference/category secondary. Keep dates/version/status compact. Use explicit semantic status chips (published/success, draft/neutral, archived/muted) with text as well as colour. Format dates for en-GB; distinguish missing dates from overdue dates. Do not turn every status into a bright primary badge.
- **Actions:** keep the main read/open action visible; group secondary actions in the existing DropdownMenu with a record-specific accessible name. Separate destructive/archive actions and retain AlertDialog confirmation. Hide actions unavailable to the effective access level; server enforcement remains essential. Do not make a clickable row the only way to open an item.
- **Mobile:** preserve document identity, status and primary action; combine secondary metadata or use a deliberate card view. Avoid horizontal page overflow and long rows of buttons. Allow long names/references to wrap. Controls must remain usable under the app's global mobile scaling.
- **States:** AppPageLoadingShell for initial page readiness, PanelLoader/SectionLoader for content loading. Never introduce plain loading paragraphs or a new loader for ordinary module fetches. Inline button spinners remain appropriate for mutations. Keep errors distinct from empty results, supply Retry, and never display an error as a zero-result success. Empty library, filtered zero-results and no published reader documents need different copy/actions. Clear filters only clears view state.
- **Dialogs:** use shared Dialog/AlertDialog, title and description, bounded scroll and explicit readable primary colours. Preserve focus return and Escape behaviour. Version history needs readable status/date hierarchy too. Loading, denial and mutation-disabled states must remain distinct.

### Module identity and navigation contract

Module links in the navbar must match their dashboard tile's identity; modules present in both surfaces must retain the same relative order after permission filtering. Home, management-only links and role-specific destinations are deliberate exceptions, not reasons to maintain arbitrary ordering. The navbar wordmark may remain AVS yellow; the entire bar need not be flooded with route colour.

Current implementation still duplicates mappings in forms/navigation, Navbar, route accents, roles, tile presentation and loader CSS. A consolidated presentation registry is **planned, not shipped**. Until then, check every applicable mapping when adding a module. Do not change permissions or collapse different route thresholds while unifying presentation.

### Working references by concern

| Concern | Reference | Boundary |
| --- | --- | --- |
| Standard shell and actions | components/layout/AppPageShell.tsx | Prefer its slots over manual headers. |
| Compact list, secondary actions and states | components/policies-procedures/PoliciesWorkspace.tsx | First implementation of this recipe; desktop/mobile checked, owner visual approval pending. Do not copy document domain logic. |
| Sortable operational table | app/(dashboard)/timesheets/components/TimesheetsListTable.tsx | Reuse composition; column visibility and multiple views are optional. |
| Search and filters | components/ui/search-input.tsx, status-filter.tsx, multi-select-filter.tsx | Choose controls for the actual filter semantics. |
| Loading | components/layout/AppPageLoadingShell.tsx, components/ui/panel-loader.tsx | Use registered module accent, preserve existing animation. |

### Visual acceptance before calling a module complete

1. Check desktop and narrow mobile, long titles, populated lists and open action menus/dialogs. Verify keyboard focus and record-specific labels; colour must not be the only status indicator.
2. Check loading, failure/retry, empty library and no matches; confirm no content flash while permissions load. Check reader/controller/denied views without modifying live records.
3. Compare navbar icon/active colour, dashboard identity and relative order. If shared implementation is deferred, record it explicitly rather than claiming consistency.
4. Preserve existing data/API/permission behaviour; run typecheck and focused affected tests. Visual checks complement them, not replace them. No production build or deployment is implied by UI work.
5. Report exactly which states/viewports were inspected and which remain unverified. A source inventory is not a browser audit. Do not impose screenshot tests on every small change.
