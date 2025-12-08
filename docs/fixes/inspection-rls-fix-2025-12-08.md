# Fix: Inspection Save Error - RLS Policy Violation

**Date:** 2025-12-08
**Error Code:** ERR-68CTTW
**Issue:** Users getting "new row violates row-level security policy (USING expression)" when editing and submitting draft inspections

## Root Cause

When editing and submitting a draft inspection, the code was:

1. Updating the inspection status from `'draft'` to `'submitted'`
2. Deleting existing inspection items
3. Upserting new inspection items

The RLS policies for `inspection_items` require the inspection to be in `'draft'` status for employees to:
- DELETE items: `AND vi.status = 'draft'` (line 116 in migration)
- UPDATE items: `AND vi.status = 'draft'` (line 91 in migration)

Since the status was changed to `'submitted'` BEFORE manipulating items, the RLS policies blocked the operations for non-manager users.

## Solution

Reordered the operations to:

1. **Delete** existing items (while inspection is still `'draft'`)
2. **Insert** new items (while inspection is still `'draft'`)
3. **Update** inspection status to `'submitted'` (after items are handled)

Additionally, changed from `upsert` to `insert` since we're already deleting all items first. This avoids triggering UPDATE policies entirely.

## Files Changed

- `app/(dashboard)/inspections/new/page.tsx`
  - Lines 494-529: Reordered operations to delete items before updating inspection status
  - Lines 573-578: Changed from `upsert` to `insert` for inspection items
  - Lines 592-625: Added inspection update AFTER items are inserted

## Testing

Test scenario:
1. Create a draft inspection
2. Save as draft
3. Edit the draft
4. Submit it (sign and submit)
5. Should succeed without RLS errors

## Related

- RLS Policies: `supabase/migrations/20251206_fix_inspection_items_rls.sql`
- Inspection Items Table: Lines 110-128 (DELETE policies), Lines 85-103 (UPDATE policies)
