# Workshop Task Data Integrity Issue - YS23 KUN
**Date:** 2026-01-26  
**Vehicle:** YS23 KUN (Adrian Spencer)  
**Task ID:** `3f6f0866-64ad-465f-92dc-f24a1ec12452`

---

## 🔍 Investigation Summary

### Issues Found

#### 1. ❌ Missing Completion Timestamp
**Problem:** Task is marked as `status: 'completed'` but has **NO `actioned_at` timestamp**

**Database State:**
```
Task ID: 3f6f0866-64ad-465f-92dc-f24a1ec12452
Status: completed ✓
Category: Service
Comments: "oil and air filter changed new N/S front tyre fitted"

Timestamps:
  ✓ created_at:  16/01/2026, 15:59:20
  ✗ logged_at:   NOT SET
  ✗ actioned_at: NOT SET  ⚠️ MISSING!
```

#### 2. ✓ No Attachments (Expected)
**Result:** 0 attachments found for this task
- This is correct - the task genuinely has no attachments
- The paperclip icon correctly does NOT show

---

## 🧩 Why This Causes Display Issues

### How Completion Dates Work

The `WorkshopTaskTimeline` component (used on the Vehicle History page) builds the timeline from two sources:

1. **`status_history` array** (if it exists) - Contains all status changes
2. **Fallback to individual fields** - Uses `logged_at` and `actioned_at` if no status_history

**Relevant Code:**
```tsx
// From WorkshopTaskTimeline.tsx line 108
const buildFallbackStatusHistory = (task) => {
  const items = [];
  if (task.logged_at) {
    items.push({ status: 'logged', created_at: task.logged_at, ... });
  }
  if (task.actioned_at) {  // ← This check fails when actioned_at is NULL
    items.push({ status: 'completed', created_at: task.actioned_at, ... });
  }
  return items;
};
```

**Result:** No "Completed" event appears in the timeline because `actioned_at` is `NULL`.

---

## 🔎 Root Cause Analysis

### How Did This Happen?

This data inconsistency (status='completed' but actioned_at=NULL) could occur through:

1. **Manual Database Update** - Task status changed directly in database without setting timestamp
2. **Old Code Bug** - Earlier version of completion workflow didn't set the field
3. **Incomplete Migration** - Task migrated from old system without full data
4. **Interrupted Transaction** - Database update partially failed

### Current Completion Workflow (Correct)

The current code in `app/(dashboard)/workshop-tasks/page.tsx` properly sets both fields:

```tsx
// Line 752-762
const { error } = await supabase
  .from('actions')
  .update({
    status: 'completed',           // ✓ Sets status
    actioned: true,
    actioned_at: new Date(...),    // ✓ Sets timestamp
    actioned_by: user?.id,
    actioned_comment: data.completedComment,
    status_history: nextHistory,
  })
  .eq('id', taskId);
```

**This task was likely completed before this code was in place or through a different method.**

---

## 🔧 Solution

### Option 1: Fix This Specific Task (Quick Fix)

Run this SQL to set the `actioned_at` to match when it was likely completed:

```sql
UPDATE actions
SET 
  actioned_at = created_at,  -- Use creation date as fallback
  actioned_by = created_by,  -- Set same user who created it
  actioned_comment = COALESCE(workshop_comments, 'Task completed')
WHERE id = '3f6f0866-64ad-465f-92dc-f24a1ec12452';
```

### Option 2: Fix ALL Affected Tasks (Comprehensive)

Find and fix all tasks with this same issue:

```sql
-- First, identify all affected tasks
SELECT 
  id,
  vehicle_id,
  status,
  created_at,
  actioned_at,
  workshop_comments
FROM actions
WHERE status = 'completed'
  AND actioned_at IS NULL;

-- Then fix them
UPDATE actions
SET 
  actioned_at = created_at,  -- Use creation date as best guess
  actioned_by = created_by,
  actioned_comment = COALESCE(
    actioned_comment, 
    workshop_comments, 
    'Task completed (timestamp backfilled)'
  )
WHERE status = 'completed'
  AND actioned_at IS NULL;
```

### Option 3: Add Data Validation (Preventive)

Add a database constraint to prevent this in the future:

```sql
-- Add a check constraint
ALTER TABLE actions
ADD CONSTRAINT completed_must_have_actioned_at
CHECK (
  (status = 'completed' AND actioned_at IS NOT NULL)
  OR (status != 'completed')
);
```

---

## 📊 Impact Assessment

### Current Impact
- ✓ Task shows as completed (status badge works)
- ✓ Task appears in completed list
- ✗ **No completion date shown in timeline**
- ✗ Cannot see who completed it (actioned_by is also NULL)
- ✗ Missing completion comment (actioned_comment is also NULL)

### If Fixed
- ✓ Completion date will appear in timeline
- ✓ Full audit trail restored
- ✓ Historical records complete

---

## 🎯 Recommendation

**Recommended Actions:**

1. **Immediate:** Run Option 2 to fix ALL affected tasks
   - This ensures data integrity across the entire system
   - Uses `created_at` as a reasonable fallback for `actioned_at`
   
2. **Short-term:** Review the migration/import scripts if this task came from another system
   - Ensure all required fields are populated
   
3. **Long-term:** Consider adding the constraint from Option 3
   - Prevents this issue from happening again
   - Enforces data integrity at the database level

---

## 📝 Testing After Fix

After applying the fix, verify:

1. ✅ Navigate to: `/fleet/vehicles/2cee9b69-3d24-4e71-8fbb-c2d3c1701724/history`
2. ✅ Expand the "YS23 KUN (Adrian Spencer)" task
3. ✅ Timeline should now show:
   - "Task created" event (16/01/2026, 15:59:20)
   - "Marked complete" event (with timestamp)
4. ✅ Verify on `/workshop-tasks` page that completed date appears

---

## 🔍 Additional Notes

- **No attachments:** Confirmed that this task genuinely has 0 attachments
- **Status history:** This task also has no `status_history` array, so it relies entirely on the individual timestamp fields
- **Other fields:** `logged_at` is also NULL, meaning this task went directly from pending to completed without the "in progress" state
