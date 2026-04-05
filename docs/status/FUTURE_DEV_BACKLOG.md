# Future Dev Backlog

This document tracks higher-risk work that was intentionally deferred during the safe wins and validation pass. These items were kept out of the current batch because they either change runtime semantics, touch broad architectural boundaries, or need a dedicated validation plan before implementation.

## Deferred Items

### `app/layout.tsx` `force-dynamic`
- Why deferred: changing root rendering and caching behavior can affect auth hydration, layout data freshness, and route-level server/client boundaries across the whole app.
- Likely payoff: lower server work on repeat navigations and better cacheability if parts of the tree can be made more static.
- Prerequisites:
  - profile which layouts and providers actually require dynamic rendering
  - confirm auth, lock, and session behavior under alternative caching strategies
  - validate with a clean production build plus route-by-route smoke coverage

### `components/layout/Navbar.tsx`
- Why deferred: this is a large client-heavy surface with multiple responsibilities including navigation, permissions, notifications, and PWA-related interactions.
- Likely payoff: fewer re-renders, smaller client cost, and easier targeted testing.
- Prerequisites:
  - capture current render triggers and critical user flows
  - identify safe split points that do not change permission, notification, or navigation behavior
  - add focused regression coverage around menu visibility and role-based nav state

### `components/layout/DashboardLayoutClient.tsx` beyond safe cleanup
- Why deferred: anything beyond timing constant extraction and cleanup hardening starts changing telemetry behavior, heartbeat cadence, or route tracking semantics.
- Likely payoff: reduced telemetry overhead and cleaner dashboard-shell runtime behavior.
- Prerequisites:
  - define the intended page-visit semantics explicitly
  - compare current behavior against analytics expectations
  - validate route changes, tab visibility changes, and background/foreground transitions

### Oversized inspection creation flows
- File areas:
  - `app/(dashboard)/van-inspections/new/page.tsx`
  - `app/(dashboard)/plant-inspections/new/page.tsx`
  - `app/(dashboard)/hgv-inspections/new/page.tsx`
- Why deferred: these are large, user-critical forms with substantial business logic and a higher regression risk than the safe-win batch allowed.
- Likely payoff: smaller bundles, less client-side work, and easier maintenance in the inspection workflow.
- Prerequisites:
  - map each page's current responsibilities and shared logic
  - isolate test coverage for create, save, validation, and submit flows
  - plan extraction work in small behavior-preserving slices

### `lib/providers/auth-provider.tsx` and provider/server-client boundary work
- Why deferred: auth and provider boundaries affect app-wide session state, redirects, role switching, and hydration.
- Likely payoff: improved startup behavior, cleaner ownership of auth state, and potentially less client work at the root.
- Prerequisites:
  - document current auth state transitions and redirect rules
  - confirm which state truly needs to live on the client
  - validate lock, switch-account, and permission-sensitive routes after any change

### `components/messages/MessageBlockingCheck.tsx` route-scope broadening
- Why deferred: broadening the current `/dashboard` gating changes where blocking message checks can run and may alter when users see password-change, toolbox talk, or reminder flows.
- Likely payoff: more complete enforcement coverage if product intent is to cover additional dashboard-layout routes.
- Prerequisites:
  - confirm intended route coverage with product expectations
  - identify all routes sharing the dashboard shell but not the `/dashboard` prefix
  - validate blocking priority order and redirect behavior after any scope change
