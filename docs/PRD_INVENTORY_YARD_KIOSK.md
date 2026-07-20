# Inventory Yard Kiosk PRD

## Purpose

Provide a dedicated landscape-tablet workflow at Yard for quickly transferring
serialized Inventory items and quantity-based Hardware between Yard and another
active Inventory location.

## Requirements

### YK-001: Dedicated kiosk identity

- The kiosk is a private authenticated route used by one dedicated profile.
- The authorised profile is configured directly in the database and must have
  Inventory module access.
- An Inventory manager or administrator may pair a browser installation as a
  trusted Yard kiosk device through Inventory Settings. Pairing uses a
  short-lived, manager-confirmed code and never collects a hardware MAC address
  or browser fingerprint.
- A paired, active device visiting `/yard-kiosk` authenticates as the configured
  kiosk profile without entering that profile's password. An unpaired device
  continues through the normal password or biometric login.
- Successful password or biometric login for the configured profile launches
  `/yard-kiosk` before any general redirect target.
- If automatic launch does not complete, the configured kiosk profile alone
  sees a primary-dashboard `Launch Kiosk` tile linking to `/yard-kiosk`.
- If the configured kiosk profile remains on `/dashboard`, the dashboard
  automatically replaces that route with `/yard-kiosk` after 10 seconds.
  Navigating elsewhere during the delay cancels the fallback launch.
- On `/yard-kiosk`, the configured kiosk profile is offered biometric
  enrollment when the dedicated device has no active credential and its prompt
  has not been dismissed. Enrollment and dismissal remain bound to that single
  device.
- Kiosk transfers record that profile as the actor. The kiosk does not collect
  an individual employee identity.
- An unconfigured, disabled, or different profile cannot load kiosk stock or
  submit kiosk transfers.

### YK-002: Yard endpoint

- Exactly one active `inventory_locations` row may have `location_type = 'yard'`.
- The kiosk resolves that Yard automatically. Users never choose the Yard.
- Every kiosk transfer has Yard on exactly one side and one active non-Yard
  counterpart location on the other side.

### YK-003: Guided transfer

- A transaction begins with the user-facing choice Collect from Yard or Return
  to Yard. The Collect choice retains the internal `take` direction value.
- The user chooses one counterpart location for the whole basket.
- Collect (`take`) uses Yard as source; Return uses the counterpart as source.
- The available catalogue contains only active serialized items and positive
  Hardware balances at that source.

### YK-004: Mixed atomic basket

- A basket may contain serialized items and Hardware quantities.
- Serialized items have quantity one. Hardware quantities are positive whole
  numbers no greater than source stock.
- The complete basket succeeds or fails in one database transaction.
- Missing, duplicate, stale, moved, inactive, or insufficient-stock lines fail
  the basket without changing any inventory.

### YK-005: Safety checks

- Existing serialized movement-check rules remain mandatory.
- A serialized item cannot leave Yard when it has never been checked or its
  check is overdue.
- The kiosk identifies blocked items but cannot record or override checks.
- Hardware does not use serialized check rules.

### YK-006: Authorization and audit

- Kiosk APIs derive Yard, source, destination, and actor server-side.
- The browser cannot submit actor or per-line location identifiers.
- The configured kiosk actor may transfer Hardware between Yard and any active
  non-Yard location. This exception does not change ordinary employee access.
- One parent kiosk batch links the serialized movement batch and Hardware
  transaction batch created for the transaction.

### YK-007: Touch experience

- The UI targets landscape viewports from 1024 by 600 pixels upward.
- Android kiosk tablets may install a dedicated `Yard Inventory` PWA from the
  Yard kiosk route. It has its own install identity, opens `/yard-kiosk`, is
  scoped to `/yard-kiosk` and its child routes, and requests landscape
  orientation. The existing viewport guard remains the fallback when a browser
  or device does not enforce the manifest orientation.
- The Yard Inventory PWA prefers Android fullscreen display so the native
  light status bar does not appear above the kiosk. Browsers that do not
  support fullscreen fall back to standalone mode with the status bar, page
  theme, and launch background all set to the kiosk slate background.
- Primary controls are large labelled tiles with visible focus states and
  keyboard alternatives.
- The document does not scroll. Horizontal pagers use native touch scrolling
  with previous and next controls kept together on one horizontal row. Both
  pager controls use enlarged touch targets and remain grouped at narrower
  kiosk widths. Workflow Back and Forward controls occupy fixed header slots
  together on the right and remain distinct from content-pager controls, which
  disable at their first and last pages. No separate Back button appears beside
  the Yard Inventory logo. Pager content keeps enough inline inset for the
  first and last card borders and focus rings to remain fully visible; only
  dense inner lists may scroll.
- Every counterpart-location step places a flexible search field and an
  accessible single-select `All`, `Manual`, `Vans`, and `Sites` filter group on
  one row at kiosk widths. The four filters share one height, width, radius,
  border treatment, and consistent gaps; the search field shares their height.
  Filtering uses structured `location_type` values and combines with search
  and the transaction-local legacy-site inclusion option. Changes reset the
  pager to its first page.
- Every fresh entry or re-entry to location selection in Collect and Return
  starts at page index zero (`Pinned & recent`). Stored pin/recent identifiers
  may populate that page but never restore a stale later pager position.
- Location tiles show alphabetically ordered, deduplicated employee display
  names under separate `Primary` and `Secondary` labels, omitting empty groups.
  Names are informational only and are not included in location search.
- Location results continue through their normal tile pagination regardless of
  count.
- When more than 24 inventory items match the active item category and search,
  the item tile area asks the user to start or continue typing and hides item
  tiles and item pagination. At exactly 24 or fewer matches, normal item tiles
  and pagination are shown; zero matches retain the no-results state. Search,
  category, and threshold changes reset or clamp the item pager.
- The item picker keeps its cards, focus rings, and pager controls inside the
  bounded left content pane. They never overlap the divider or right-hand
  basket. The basket and submit action remain visible and usable while item
  results are narrowed or suppressed.
- After the initial Collect/Return screen, the location, stock-selection, and
  basket-review states show a prominent, non-blocking pill prompt with a strong
  three-pixel border and generous responsive internal spacing for three seconds
  before it fades away. The initial direction-selection screen and all states
  after the user confirms the basket have no timed prompt; submitting and
  receipt views retain their own focused status feedback. Copy reflects the
  active Collect or Return direction, rapid navigation replaces stale prompts,
  and reduced-motion settings are respected. The pill itself is an accessible
  button that dismisses immediately by tap, click, Enter, or Space without
  reappearing until a subsequent workflow-state entry.

### YK-008: Kiosk lifecycle

- The tablet relies on operating-system kiosk mode. Its browser may use the
  normal application login or a manager-approved trusted-device credential.
  Trusted-device credentials are stored only in secure HTTP-only cookies,
  remain bound to the configured kiosk profile, and can be revoked from
  Inventory Settings. Revocation invalidates sessions issued to that device.
  There is no in-app dashboard exit.
- The dedicated kiosk PWA is an online-only launcher and does not register a
  service worker or cache an offline application shell. Inventory data and
  transfers always require the live application. If a device outside the PWA
  scope requires normal login, Android opens that login in Chrome before the
  user returns to the kiosk route.
- Yard Inventory is a separate PWA from the main Squires app. Production must
  use one canonical host for the kiosk so trusted cookies and the installed
  start URL share one origin. The intended canonical address is
  `https://squiresapp.com/yard-kiosk`; this domain redirect is configured at
  the hosting layer rather than by adding an opposing application redirect.
  The main Squires PWA manifest and non-kiosk routes are unchanged.
- Stale browser session cookies must never create redirect loops. Activation
  clears invalid app-session cookies before sending the tablet to pairing or
  recovery, and authenticated login redirects into Yard kiosk go through
  `/yard-kiosk/activate`.
- Pairing shows explicit states for waiting, code confirmation, success, and
  failure. A successful pair only shows that pairing completed and the kiosk is
  starting. Failure copy uses plain English with a reference code.
- The Yard Inventory logo remains available throughout the kiosk workflow.
  Holding it for three seconds reveals a hidden admin menu containing only
  `Log out`; logout requires confirmation and returns the device to sign-in.
- Recoverable errors preserve the basket, offline state blocks submission, and
  duplicate submissions are prevented.
- Every tablet-visible failure uses a stable error code, plain-English title,
  what happened, what to do next, and a searchable diagnostic reference. The
  tablet never shows raw database, JWT, or HTTP wording as the primary message.

### YK-010: Diagnostics and remote recovery

- Online tablets send an authenticated heartbeat with phase, app/deployment
  version, and last sanitized error. Inventory managers see online/stale/offline
  presence in Inventory Settings.
- While a tablet remains online, managers may issue audited commands: ping,
  refresh status/data, refresh session, reload app, reset workflow, log out,
  and clear credentials for re-pairing. Reset, logout, and re-pair require an
  explicit confirmation warning because they can discard an unfinished basket.
- Commands are durable, expire safely, execute at most once, and record
  accepted/completed/failed status. Offline transfer queues and service-worker
  command delivery are out of scope.
- Super-admin `/debug` includes a Yard Kiosk tab with device health, command
  audit, error catalogue, and plain-English likely-cause guidance. Write
  recovery controls remain in Inventory Settings.
- In every active workflow state after the initial Collect/Return screen,
  pointer, touch, click, and keyboard activity restart a two-minute inactivity
  window. At 1 minute 45 seconds, an assertive, reduced-motion-safe warning
  displays a live 15-second countdown. Any genuine interaction dismisses the
  warning and restarts the full window. At two minutes, the kiosk returns to
  Collect/Return and uses the canonical full reset to discard all unsubmitted
  direction, location, stock, basket, quantity, search, category, pager,
  submission, error, and receipt state. The start screen has no inactivity
  warning or timer; leaving or completing a workflow cleans up all listeners
  and timers. A server transaction that already completed is never reversed.
- Success shows a large receipt and automatically resets for the next
  transaction after a short countdown.

### YK-009: Legacy quote locations

- Locations with `source_type = 'legacy_quote'` are excluded from the default
  counterpart-location list.
- The location step provides a local **Include legacy sites** control for the
  current transaction only.
- Enabling the control reloads the counterpart list with legacy locations;
  backing out, completing, or resetting the transaction restores the default
  non-legacy list.
- Legacy classification uses the canonical
  `inventory_locations.source_type = 'legacy_quote'` value. The toggle has a
  muted neutral inactive state, a highlighted active state, and exposes its
  state with `aria-pressed`.
- A selected legacy counterpart remains valid for the current basket,
  submission, and receipt. Server-side location-ID authorization remains
  unchanged.

## Non-goals

- MAC-address authentication, browser fingerprinting, or network-address
  allow-listing.
- Barcode or QR scanning.
- Individual employee identification, PIN entry, or badge entry.
- Recording checks or manager overrides from the kiosk.
- Transfers that do not involve Yard.
- Offline transfer queues.
