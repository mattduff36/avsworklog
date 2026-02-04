# Bug Fix - Plant History Back Button Navigation

**Date:** 2026-02-04  
**Status:** ✅ Fixed  
**Files Modified:** 2

## Issue

When clicking on a plant machine from `/fleet?tab=plant` and opening the plant history page, the back button would return to the dashboard instead of returning to `/fleet?tab=plant`.

## Root Cause

1. The `PlantTable` component's `handleViewHistory` function navigated to `/fleet/plant/[plantId]/history` without passing the `fromTab` query parameter
2. The `backNavigation.ts` configuration didn't have a route mapping for plant history pages
3. Without the `fromTab` param, the BackButton component couldn't determine which tab to return to

## Fix

### 1. Added Plant History Route Mapping
**File:** `lib/config/backNavigation.ts`

Added configuration for plant history routes that:
- Checks for `fromTab` query parameter
- Validates it against allowed tabs
- Returns to the appropriate fleet tab
- Defaults to `/fleet?tab=plant` if no valid fromTab is provided

```typescript
// Plant history routes - always return to plant tab
if (normalizedPath.match(/^\/fleet\/plant\/[^/]+\/history$/)) {
  const fromTab = searchParams?.get('fromTab');
  // Validate fromTab to prevent injection
  const validTabs = ['maintenance', 'plant', 'vehicles', 'settings'];
  if (fromTab && validTabs.includes(fromTab)) {
    return `/fleet?tab=${fromTab}`;
  }
  // Default fallback to plant tab
  return '/fleet?tab=plant';
}
```

### 2. Updated PlantTable Navigation
**File:** `app/(dashboard)/maintenance/components/PlantTable.tsx`

Modified `handleViewHistory` to include the `fromTab=plant` query parameter:

```typescript
const handleViewHistory = (plantId: string) => {
  router.push(`/fleet/plant/${plantId}/history?fromTab=plant`);
};
```

## Navigation Flows

### Before Fix:
```
/fleet?tab=plant → click plant → /fleet/plant/[id]/history → back button → /dashboard ❌
```

### After Fix:
```
/fleet?tab=plant → click plant → /fleet/plant/[id]/history?fromTab=plant → back button → /fleet?tab=plant ✅
```

## Consistency with Vehicle History

This fix aligns plant history navigation with the existing vehicle history behavior:

**Vehicle History (existing):**
- `handleVehicleClick` includes `?fromTab=${activeTab}` (line 295 in fleet/page.tsx)
- Route mapping supports `fromTab` parameter
- Back button returns to correct tab

**Plant History (now fixed):**
- `handleViewHistory` includes `?fromTab=plant`
- Route mapping supports `fromTab` parameter
- Back button returns to plant tab

## Testing

### Scenarios Verified:

1. **Click plant from plant tab**
   - ✅ Opens `/fleet/plant/[id]/history?fromTab=plant`
   - ✅ Back button returns to `/fleet?tab=plant`

2. **Click plant from maintenance overview (via PlantOverview)**
   - ✅ Already working via `handleVehicleClick` with `fromTab=${activeTab}`
   - ✅ Back button returns to correct tab

3. **Direct navigation to plant history (no fromTab param)**
   - ✅ Back button defaults to `/fleet?tab=plant`

## Related Files

- `lib/config/backNavigation.ts` - Added plant history route mapping
- `app/(dashboard)/maintenance/components/PlantTable.tsx` - Added fromTab param
- `app/(dashboard)/fleet/page.tsx` - Already correct (handleVehicleClick includes fromTab)

## Notes

The `PlantOverview` component (used in maintenance tab) already routes through `handleVehicleClick` which includes the `fromTab` parameter, so no changes were needed there.
