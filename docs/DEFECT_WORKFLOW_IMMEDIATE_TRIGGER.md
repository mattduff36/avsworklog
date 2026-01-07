# Defect Workflow Immediate Trigger - Implementation

**Date:** January 7, 2026  
**Status:** ✅ Complete

---

## Problem Statement

The client reported that workshop tasks were only being created when inspections were **submitted**, not when they were saved as **drafts**. This meant:

- User reports defect on Monday → saves as draft
- Workshop staff get NO notification
- User finally submits inspection on Friday
- Workshop staff only see the defect on Friday (4 days late!)

This caused delays in vehicle repairs and maintenance response times.

---

## Solution Implemented

Modified the defect reporting workflow to trigger **immediately** when:
1. An inspection is saved as a **draft** with defects
2. An inspection is **submitted** with defects

### Key Changes

#### 1. **Action Creation for Both Draft and Submitted**
**Files Changed:**
- `app/(dashboard)/inspections/new/page.tsx` (lines 912-1068)
- `app/(dashboard)/inspections/[id]/page.tsx` (handleSave and handleSubmit)

**Before:**
```typescript
// Only when submitting
if (status === 'submitted' && insertedItems) {
  // Create actions...
}
```

**After:**
```typescript
// For both draft and submitted
if (insertedItems && insertedItems.length > 0) {
  // Create/update actions...
}
```

#### 2. **Duplicate Prevention**
Added logic to check for existing actions before creating new ones:

```typescript
// Check for existing actions
const { data: existingActions } = await supabase
  .from('actions')
  .select('id, inspection_item_id, status')
  .eq('inspection_id', inspection.id)
  .eq('action_type', 'inspection_defect');

// Create map of existing actions
const existingActionsMap = new Map();
existingActions?.forEach(action => {
  if (action.inspection_item_id) {
    existingActionsMap.set(action.inspection_item_id, { 
      id: action.id, 
      status: action.status 
    });
  }
});
```

#### 3. **Update vs Create Logic**
For each defect, the system now:
- **Creates** a new action if none exists
- **Updates** the existing action if one exists (and not completed)
- **Skips** if action is already completed

```typescript
if (existingAction && existingAction.status !== 'completed') {
  // Update existing action
  actionsToUpdate.push({ id, updates: { title, description, ... }});
} else if (!existingAction) {
  // Create new action
  actionsToCreate.push({ action_type: 'inspection_defect', ... });
}
```

#### 4. **Resolution Workflow Enhanced**
The auto-completion of resolved defects now works for both draft and submitted:

```typescript
// Before: only submitted
if (status === 'submitted' && resolvedItems.size > 0) { ... }

// After: both draft and submitted
if (resolvedItems.size > 0 && vehicleId) { ... }
```

---

## Workflow Examples

### Example 1: Draft Saved on Monday
**Timeline:**
1. **Monday 9am**: User marks "Wipers" as defective → saves draft
   - ✅ Workshop task created immediately (status: pending)
   - Workshop staff can see it and start working

2. **Monday 2pm**: User adds "Lights" defect → saves draft again
   - ✅ NEW workshop task created for lights
   - ✅ Existing "Wipers" task updated with latest info

3. **Friday**: User submits inspection
   - ✅ Both tasks already exist, just updated if needed
   - No duplicate tasks created

### Example 2: False Alarm Correction
**Timeline:**
1. **Monday**: User marks "Horn" as defective → saves draft
   - ✅ Workshop task created

2. **Tuesday**: User tests horn again, it works → marks as OK → saves draft
   - ✅ Workshop task automatically completed with resolution comment
   - Status changed to "completed"

### Example 3: Editing Existing Draft
**Timeline:**
1. **Inspection exists** with defect for "Brakes"
   - ✅ Workshop task exists (ID: abc123)

2. **User reopens draft**, adds comment to "Brakes" defect → saves
   - ✅ Existing workshop task (abc123) is updated (not duplicated)
   - Updated description includes new comment

---

## Technical Details

### Defect Grouping
Defects are grouped by `item_number` and `item_description` to consolidate duplicates:

```typescript
const groupedDefects = new Map<string, { 
  item_number: number; 
  item_description: string; 
  days: number[]; 
  comments: string[];
  item_ids: string[];
}>();
```

This ensures:
- ONE action per unique defect item
- Multiple days with same defect are consolidated (e.g., "Mon-Fri")
- All related comments are captured

### Action Properties
Each created action includes:
- **action_type**: `'inspection_defect'`
- **inspection_id**: Links to the inspection
- **inspection_item_id**: Links to the first occurrence of the defect
- **vehicle_id**: Links to the vehicle
- **workshop_category_id**: Defaults to "Uncategorised"
- **title**: Format: `"{VehicleReg} - {ItemName} ({DayRange})"`
- **description**: Full details including item number, name, days, comments
- **priority**: `'high'` (all inspection defects are high priority)
- **status**: `'pending'` (new defects) or updated existing status
- **created_by**: User who created the inspection

---

## Testing Checklist

To verify the implementation:

- [ ] Create new inspection with defect → save as draft
  - [ ] Verify workshop task created in Workshop Tasks module
  - [ ] Verify task shows in "Pending" section
  
- [ ] Reopen same draft → add another defect → save
  - [ ] Verify NEW task created for new defect
  - [ ] Verify existing task updated (not duplicated)
  
- [ ] Mark existing defect as "OK" (with comment) → save draft
  - [ ] Verify task auto-completed with resolution comment
  
- [ ] Submit inspection with defects (never saved as draft before)
  - [ ] Verify tasks created on submission
  
- [ ] Submit draft that already has tasks
  - [ ] Verify NO duplicate tasks created
  - [ ] Verify existing tasks updated if needed

---

## Database Impact

### Tables Modified
- **actions**: Workshop tasks are created/updated more frequently

### Performance Considerations
- Extra queries per save: ~3-5 (check existing, create/update actions)
- Minimal performance impact due to indexed lookups
- Action creation errors don't block inspection save (try-catch wrapper)

### RLS Policies
No RLS changes needed - existing policies already allow authenticated users to create actions (as per `fix-additional-rls.sql`).

---

## Related Files

### Modified
1. `app/(dashboard)/inspections/new/page.tsx`
   - Lines 912-1068: Action creation/update workflow
   - Lines 1007-1059: Resolution workflow

2. `app/(dashboard)/inspections/[id]/page.tsx`
   - handleSave: Added action creation for drafts
   - handleSubmit: Added action creation for submission

### Referenced
- `app/(dashboard)/workshop-tasks/page.tsx`: Workshop task management UI
- `app/(dashboard)/actions/page.tsx`: Manager actions overview
- `supabase/create-actions-table.sql`: Actions table schema
- `supabase/fix-additional-rls.sql`: RLS policies for actions

---

## Migration Notes

No database migration required. This is a **code-only change** that modifies when actions are created, not the schema.

---

## User Impact

### Positive
✅ **Immediate visibility**: Workshop staff see defects as soon as they're reported  
✅ **Faster repairs**: No waiting days for final inspection submission  
✅ **Better tracking**: All defects tracked from the moment they're identified  
✅ **No duplicates**: Smart logic prevents duplicate workshop tasks  
✅ **Accurate status**: Tasks auto-complete when issues resolved

### Neutral
⚠️ **More notifications**: Workshop staff may receive more notifications (but this is the desired behavior)  
⚠️ **False alarms**: If user reports defect then marks OK before submitting, task is auto-completed (handled gracefully)

---

## Future Enhancements

Potential improvements for future consideration:

1. **Notification System**: Add real-time notifications to workshop staff when new defects reported
2. **Priority Intelligence**: Auto-adjust priority based on defect severity/vehicle usage
3. **Defect History**: Track how long defects remain unresolved
4. **Bulk Operations**: Allow managers to bulk-assign workshop tasks to technicians
5. **Mobile Alerts**: Push notifications to workshop staff mobile devices

---

## Commit Reference

**Commit:** 7a3ea9c  
**Message:** "feat(inspections): trigger workshop task workflow on draft save AND submit"

**Files Changed:**
- `app/(dashboard)/inspections/new/page.tsx` (+271, -20 lines)
- `app/(dashboard)/inspections/[id]/page.tsx` (+90, -7 lines)

---

## Conclusion

The defect workflow now triggers **immediately** when defects are reported, whether in draft or submitted inspections. This ensures workshop staff can act on vehicle issues as soon as they're identified, improving response times and vehicle safety.

