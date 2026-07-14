# Inventory Hardware Stock PRD

## Purpose

Add quantity-based, non-serialised Hardware stock to the Inventory module without changing the existing one-row-per-asset model used by Small Tools and Minor Plant.

## Requirements

### HW-001: Shared catalogue

- Managers and admins can add, rename, reorder, and archive Hardware item types.
- An item type cannot be archived while any location has a non-zero balance.
- The initial active catalogue is:
  1. Heras fencing
  2. Cones
  3. Cone tops
  4. Road plates
  5. Derv tank
  6. Machine breaker
  7. Floor saw
  8. Generator
  9. Tamp
- Initial balances are zero.

### HW-002: Location balances

- Each Hardware item type has a non-negative whole-number balance at each active Inventory location.
- All active location types are eligible.
- Managers and admins can view company totals and per-location balances.
- Zero balances remain available in management views but are hidden from employee views.

### HW-003: Stock adjustments

- Managers and admins can apply atomic multi-row Add, Remove, and Recount operations.
- Every adjustment requires a standard reason: Delivery, Return, Used, Lost, Scrapped, Damaged, Stocktake correction, or Other.
- Other requires a note. Notes are optional for standard reasons.
- Removing more stock than is available is rejected.

### HW-004: Transfers

- Managers and admins can transfer stock between any two active Inventory locations.
- Employees can transfer stock only between their valid primary location and assigned secondary Site locations.
- Transfers are atomic, reject insufficient stock, and preserve company-wide totals.

### HW-005: Audit history

- Every adjustment and transfer records the actor, time, operation, reason, note, item, location, quantity delta, and before/after balances.
- Transfer history records paired source and destination entries in one batch.
- Transaction history is immutable through normal application access.

### HW-006: Manager experience

- Inventory Overview includes a Hardware tab beside Small Tools and Minor Plant.
- The tab shows one row per active Hardware type, its company-wide total, and expandable non-zero location balances.
- Inventory Settings includes Hardware Stock management for catalogue maintenance, filtering, stock matrix operations, and transfers.

### HW-007: Employee experience

- Standard employee Inventory views include a separate Hardware section.
- Positive balances are grouped by the employee's primary location and assigned secondary Site locations.
- Employees can transfer quantities only between those responsible locations.

### HW-008: Access control

- Reading Hardware requires Inventory module access.
- Catalogue and adjustment writes require manager/admin Inventory access.
- Transfer authorization is revalidated by the API for every request.

## Non-goals

- Hardware does not use serial numbers, PAT/service checks, retirement, item groups, or the serialized item claim workflow.
- Hardware balances are not merged into `inventory_items`.
