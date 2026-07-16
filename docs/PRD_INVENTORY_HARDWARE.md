# Inventory Hardware Stock PRD

## Purpose

Add quantity-based, non-serialised Hardware stock to the Inventory module without changing the existing one-row-per-asset model used by Small Tools and Minor Plant.

## Requirements

### HW-001: Shared catalogue

- Managers and admins can add, rename, and delete unused Hardware item types.
- The catalogue is ordered alphabetically by name; manual sort order is not exposed or accepted by the application.
- An item type cannot be deleted after a balance or immutable audit-history record
  references it.
- The initial active catalogue contains Heras fencing, Cones, Cone tops, Road plates,
  Derv tank, Machine breaker, Floor saw, Generator, and Tamp.
- Initial balances are zero.

### HW-002: Location balances

- Each Hardware item type has a non-negative whole-number balance at each active Inventory location.
- All active location types are eligible.
- Managers and admins can view company totals and per-location balances.
- Employee views show positive balances only.
- The management Hardware Overview shows one expandable row per Hardware item,
  including items with zero company-wide stock. A missing Yard balance record is
  treated as zero.
- Overview search and location filters do not impose a Yard-balance or company-total
  filter. Expanded rows show positive location balances; zero balances are omitted.
- The Settings Hardware Stock Matrix shows one grouped row per active item,
  including items with zero company-wide stock. Expanded matrix rows show positive
  balances at every active location; missing and zero balances are omitted.

### HW-003: Stock adjustments

- Managers and admins can apply atomic Add, Remove, and Recount operations directly
  from each item's Actions column.
- Manager and admin adjustment workflows are available from Inventory Settings >
  Hardware Stock Matrix, not Inventory Overview.
- Remove prompts for one of the item's positive stock locations. Recount prompts for
  any active Inventory location. Expandable rows display location balances but do not
  require selection before an adjustment.
- Managers and admins can record an incoming Delivery directly from any
  matrix item, including items with zero company-wide stock, by selecting an
  active destination location and entering a positive whole-number quantity.
- Every adjustment requires a standard reason: Delivery, Return, Used, Lost, Scrapped, Damaged, Stocktake correction, or Other.
- Other requires a note. Notes are optional for standard reasons.
- Removing more stock than is available is rejected.

### HW-004: Transfers

- Managers and admins can transfer stock between any two active Inventory locations.
- Manager and admin transfer workflows are available from Inventory Overview >
  Hardware.
- Employees can transfer stock between any active Inventory locations when at
  least one side is their valid primary location or an assigned secondary Site
  location. This supports collecting stock into, or dispatching stock from,
  locations they are responsible for without permitting unrelated third-party
  transfers.
- The database-configured Yard kiosk actor is a narrow exception: it can transfer
  stock only when exactly one side is the active Yard and the other side is an
  active non-Yard location, as defined by `YK-002` and `YK-006`.
- Transfers are atomic, reject insufficient stock, and preserve company-wide totals.

### HW-005: Audit history

- Every adjustment and transfer records the actor, time, operation, reason, note, item, location, quantity delta, and before/after balances.
- Transfer history records paired source and destination entries in one batch.
- Transaction history is immutable through normal application access.

### HW-006: Manager experience

- Inventory Overview includes a Hardware tab beside Small Tools and Minor Plant.
- The Overview tab shows every active Hardware type, its company-wide total,
  expandable non-zero location balances, search and location filters, and transfers.
  It does not expose stock adjustment or Add stock actions.
- Inventory Settings includes the all-item grouped Hardware Stock Matrix for
  per-item stock entry and bulk adjustments, plus the Hardware Catalogue area for
  adding, renaming, and deleting unused Hardware item types.
- The Hardware catalogue remains complete and actionable when an item has zero
  company-wide stock. Incoming stock is recorded from the active matrix item row.
  The zero-total omission applies to location result sets, not catalogue entries.
- Hardware locations with a zero aggregate quantity are not materialised in Overview
  balance result sets.

### HW-007: Employee experience

- Standard employee Inventory views include a separate Hardware section.
- Positive balances remain grouped by the employee's primary location and
  assigned secondary Site locations.
- The transfer picker can use company-wide positive balances as sources and any
  active location as the destination, while the API requires one side of every
  line to be a location the employee is responsible for.

### HW-008: Access control

- Reading Hardware requires Inventory module access.
- Catalogue create, rename, delete, and adjustment writes require manager/admin
  Inventory access.
- Transfer authorization is revalidated by the API for every request.
- Yard kiosk authorization is revalidated independently and does not grant its
  profile manager, catalogue, adjustment, or ordinary unrestricted transfer access.

## Non-goals

- Hardware does not use serial numbers, PAT/service checks, retirement, item groups, or the serialized item claim workflow.
- Hardware balances are not merged into `inventory_items`.
