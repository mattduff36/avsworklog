# Incident Report: KT24 PSX Duplicate Workshop Tasks

**Date:** January 19, 2026  
**Severity:** Medium  
**Status:** ✅ IDENTIFIED - Fix in progress

---

## Summary

Vehicle KT24 PSX (Chris Seals) has 2 duplicate workshop tasks for the same defect: "Big crack in windscreen" (Item 4 - Windows & Wipers).

## Duplicate Tasks Found

### Task 1 (Newer - Jan 19, 2026)
- **ID:** `e5f83db9-b94f-4ca6-a697-cd9ef2185f18`
- **Created:** 2026-01-19 06:52:24
- **Status:** on_hold
- **Description:** "Big crack in windscreen"
- **Category:** Uncategorised (deprecated top-level category)
- **Subcategory:** None
- **Inspection ID:** `a15ee114-f380-4c99-a824-f86eca650384`
- **Inspection Item ID:** `69c08d5b-3635-42e9-a5dc-ef11da7f95f5`

### Task 2 (Older - Jan 10, 2026)
- **ID:** `de9c4c35-e647-4481-b15f-fa3b9496ac3a`
- **Created:** 2026-01-10 08:50:05
- **Status:** on_hold
- **Description:** "Big crack in the windscreen"
- **Category:** Other (new top-level category)
- **Subcategory:** Uncategorised (now subcategory under Other)
- **Inspection ID:** `e06f641f-c851-48bd-9521-9c4a36b30e35`
- **Inspection Item ID:** `dcdd9fc2-6105-4e09-927b-e1b0aa4e8671`

## Root Cause

### Identified Issues

1. **Unstable Deduplication Key**
   - Current code uses `inspection_item_id` for deduplication
   - Draft editing workflows delete/recreate `inspection_items`, changing IDs
   - New IDs break deduplication → duplicates created

2. **Multiple Inspection Creation Paths**
   - `app/(dashboard)/inspections/new/page.tsx` (lines 990-1090)
   - `app/(dashboard)/inspections/[id]/page.tsx` (handleSave and handleSubmit)
   - Both paths directly insert `actions` rows from client-side

3. **RLS Prevents Inspector Read Access**
   - `supabase/migrations/20251217_fix_actions_rls.sql`: Only managers + workshop users can SELECT actions
   - Inspectors cannot read existing tasks to check for duplicates
   - Client-side "check existing" queries fail silently → always create new

4. **Taxonomy Inconsistency**
   - Task 1: Uses deprecated "Uncategorised" top-level category
   - Task 2: Uses new "Other → Uncategorised" subcategory
   - Shows tasks were created at different migration stages

### Code Paths Creating Duplicates

**Path 1:** `app/(dashboard)/inspections/new/page.tsx`
```typescript
// Lines 990-1060: Groups defects and checks for existing actions
const { data: existingActions } = await supabase
  .from('actions')
  .select('id, inspection_item_id, status')
  .eq('inspection_id', inspection.id)
  .eq('action_type', 'inspection_defect');

// Maps by inspection_item_id (unstable!)
existingActionsMap.set(action.inspection_item_id, { id, status });
```

**Path 2:** `app/(dashboard)/inspections/[id]/page.tsx`
```typescript
// Lines 248-326: Similar logic in handleSave
// Lines 495-569: Duplicate logic in handleSubmit
```

## Impact

- Duplicate tasks create confusion for workshop staff
- Same defect appears twice in task lists
- Potential for:
  - One task marked complete while other remains open
  - Inconsistent status tracking
  - Duplicate work or missed work

## Solution Design

### New Architecture: Server-Side Idempotent Endpoints

1. **GET /api/inspections/locked-defects?vehicleId=X**
   - Returns locked checklist items (statuses: logged, on_hold, in_progress)
   - Uses service role to bypass RLS
   - Inspector UI receives minimal data to disable items

2. **POST /api/inspections/sync-defect-tasks**
   - Idempotent upsert based on stable signature:
     - `inspection_id + item_number + item_description`
   - Uses service role to bypass RLS
   - Detects and reports existing duplicates
   - Enforces consistent taxonomy (Repair → Inspection defects)

3. **Client-Side Changes**
   - Remove direct `actions` insert/update
   - Call server endpoints only
   - UI only receives locked items list (no full task data)

### Stable Deduplication Logic

```typescript
// Stable signature (doesn't change on draft edits)
signature = `${inspectionId}-${itemNumber}-${itemDescription.trim()}`

// Match existing tasks by:
// 1. Join: actions.inspection_item_id -> inspection_items(item_number, item_description)
// 2. Fallback: Parse actions.description for "Item X - Description"
// 3. Filter: Same inspection_id OR same vehicle_id + same signature
```

## Prevention Measures

1. **Immediate:** Deploy server-side sync endpoint (in progress)
2. **Short-term:** Add duplicate detection report for admins
3. **Long-term:** Add unique constraint on task signatures in database

## Related Files

- Investigation script: `scripts/find-windscreen-duplicates.ts`
- Duplicate analysis: `scripts/analyze-duplicates-kt24-psx.ts`
- Implementation plan: `.cursor/plans/investigate-duplicate-workshop-tasks_e0cd40ec.plan.md`

## Status

- ✅ Duplicates identified
- ✅ Root cause confirmed
- 🔄 Fix in progress (server endpoints being implemented)
- ⏳ Duplicate cleanup pending (after fix deployed)

---

**Reported By:** Client (via screenshot)  
**Investigated By:** AI Assistant  
**Resolution:** In progress
