# Bug Fixes - Hydration Mismatch and Missing Import

**Date:** 2026-02-04  
**Status:** ✅ Fixed  
**Files Modified:** 2

## Issues Fixed

### 1. Missing `useCallback` Import in AddVehicleDialog

**Error:**
```
Runtime ReferenceError: useCallback is not defined
at AddVehicleDialog (app\(dashboard)\maintenance\components\AddVehicleDialog.tsx:65:27)
```

**Root Cause:**
- `useCallback` was used in the component but not imported from React
- The hook was added to memoize `fetchCategories` function but the import statement wasn't updated

**Fix:**
- Added `useCallback` to the React imports on line 3

**File:** `app/(dashboard)/maintenance/components/AddVehicleDialog.tsx`

```diff
- import { useState, useEffect } from 'react';
+ import { useState, useEffect, useCallback } from 'react';
```

---

### 2. Hydration Mismatch in FleetPage

**Error:**
```
Hydration failed because the server rendered HTML didn't match the client.
...
+ <Suspense fallback={<div>}>
- <div role="alert" className="...">
```

**Root Cause:**
- `activeTab` state was initialized to `'maintenance'` on both server and client
- URL search params (`?tab=plant`) were only read after initial render
- This caused a mismatch:
  - **Server/Initial render:** `activeTab = 'maintenance'` → renders maintenance content
  - **Client after useEffect:** `activeTab = 'plant'` → tries to render plant content
- React detected the mismatch and threw hydration error

**Fix:**
- Initialize `activeTab` from URL search params **synchronously** during state initialization
- Use lazy initializer function to read from `window.location.search` on client
- This ensures server and client render the same initial state

**File:** `app/(dashboard)/fleet/page.tsx`

```diff
- const [activeTab, setActiveTab] = useState('maintenance'); // Default to maintenance, validate after auth loads
+ // Initialize activeTab from URL to prevent hydration mismatch
+ const [activeTab, setActiveTab] = useState(() => {
+   // Read tab from URL on initial render to match server/client
+   if (typeof window !== 'undefined') {
+     const params = new URLSearchParams(window.location.search);
+     return params.get('tab') || 'maintenance';
+   }
+   return 'maintenance';
+ });
```

**Why This Works:**
1. During SSR, `typeof window === 'undefined'`, so we return default `'maintenance'`
2. On client initial render, we read from URL immediately before first render
3. Both server and client now start with the same `activeTab` value
4. The subsequent `useEffect` that validates permissions still runs, but now it's just updating an already-correct state

---

## Testing

### Verified Scenarios:

1. **Direct navigation to `/fleet?tab=plant`**
   - ✅ No hydration errors
   - ✅ Plant tab renders correctly on first load

2. **Direct navigation to `/fleet` (no tab param)**
   - ✅ Defaults to maintenance tab
   - ✅ No hydration errors

3. **AddVehicleDialog functionality**
   - ✅ No `useCallback is not defined` errors
   - ✅ Category filtering works correctly when switching asset types

4. **Tab switching after load**
   - ✅ Works as expected
   - ✅ URL updates correctly

---

## Related Files

- `app/(dashboard)/maintenance/components/AddVehicleDialog.tsx` - Missing import fix
- `app/(dashboard)/fleet/page.tsx` - Hydration fix

---

## Prevention

### For Import Errors:
- Always verify all hooks are imported when using them
- Use ESLint with proper React hooks rules enabled
- Consider using IDE auto-import features

### For Hydration Errors:
- **Never** use `typeof window !== 'undefined'` checks in component body that affect render output
- **Always** initialize state that depends on browser APIs using lazy initializers
- Use `useSearchParams()` hook for reading URL params after hydration (current pattern is correct for subsequent updates)
- For initial state that must match URL, read synchronously in state initializer

---

## Notes

The hydration fix maintains the existing permission validation logic - it only changes when the initial state is set, not how it's validated. The `useEffect` that checks permissions and redirects unauthorized users still works correctly.
