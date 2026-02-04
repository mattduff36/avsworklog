# Bug Fixes: Navigation Dropdown Permissions & Fetch Validation

**Date:** 2026-02-04  
**Components:** Navigation Config, Plant Inspections View Page  
**Priority:** High  
**Status:** ✅ Fixed

---

## Overview

Fixed two critical bugs:
1. **Navigation Dropdown Permission Bug**: Users with only `plant-inspections` permission couldn't access plant inspections through the navbar
2. **Missing Fetch Response Validation**: Plant inspection defect task sync errors were silently ignored, showing false success messages

---

## Bug 1: Navigation Dropdown Permission Filter

### Problem

The "Inspections" navigation item has dropdown children for both vehicle inspections and plant inspections. However, the parent item had `module: 'inspections'`, causing the entire dropdown to be filtered out for users who only have `plant-inspections` permission.

**Filtering Logic (Before Fix):**
```typescript
export function getFilteredEmployeeNav(...) {
  return employeeNavItems.filter(item => {
    // Check basic permission for employees
    if (item.module && !userPermissions.has(item.module)) {
      return false; // ❌ Removes entire "Inspections" dropdown
    }
    return true;
  });
}
```

**User Scenario:**
- User has only `plant-inspections` permission
- Navbar item: `{ label: 'Inspections', module: 'inspections', dropdownItems: [...] }`
- Filter check: `userPermissions.has('inspections')` → `false`
- Result: ❌ Entire "Inspections" option removed from navbar
- Impact: User cannot access plant inspections (even though they have `plant-inspections` permission)

### Root Cause

The filtering logic didn't account for dropdown menus with child items that might have different module requirements than the parent.

```typescript
// Before: Parent module check only
if (item.module && !userPermissions.has(item.module)) {
  return false; // Blocks access to all dropdown children
}
```

### Solution

Added logic to check if the user has access to ANY dropdown child before filtering out the parent item.

```typescript
// For items with dropdown children, check if user has access to ANY child
if (item.dropdownItems && item.dropdownItems.length > 0) {
  const hasAccessToAnyChild = item.dropdownItems.some(child => {
    // If child has no module requirement, it's accessible
    if (!child.module) return true;
    // Otherwise check if user has the module permission
    return userPermissions.has(child.module);
  });
  
  // If user has access to at least one child, show the parent
  return hasAccessToAnyChild;
}
```

**File Changed:** `lib/config/navigation.ts`

### Test Scenarios

| User Permissions | Navbar Shows | Dropdown Contains |
|------------------|--------------|-------------------|
| `inspections` only | ✅ Inspections | Vehicle Inspections only |
| `plant-inspections` only | ✅ Inspections | Plant Inspections only |
| Both `inspections` + `plant-inspections` | ✅ Inspections | Both options |
| Neither permission | ❌ (No Inspections option) | N/A |

---

## Bug 2: Missing Fetch Response Validation

### Problem

The plant inspection view page (`[id]/page.tsx`) sends a POST request to create defect tasks but doesn't validate the response status. If the API returns an error (4xx/5xx), the fetch doesn't throw, causing the error to be silently ignored.

**Code (Before Fix):**

```typescript:281:290:app/(dashboard)/plant-inspections/[id]/page.tsx
await fetch('/api/plant-inspections/sync-defect-tasks', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    inspectionId: inspection.id,
    plantId: inspection.plant_id,
    createdBy: user!.id,
    defects
  })
});
// ❌ No response validation - errors silently ignored
```

**User Impact:**
1. Inspector submits plant inspection with defects
2. API fails (e.g., database error, permission issue)
3. User sees: ✅ "Changes saved successfully"
4. Reality: ❌ Defect tasks not created
5. Result: Data inconsistency, workshop unaware of defects

### Root Cause

The `fetch()` API only throws on network errors, not HTTP error responses. A 500 Internal Server Error returns a valid Response object with `ok: false`, which must be checked manually.

**Why This Wasn't Caught:**
- The new page (`new/page.tsx`) correctly validates responses
- The view page (`[id]/page.tsx`) was missing this check
- Likely copy-paste error or incomplete implementation

### Solution

Added response status validation matching the pattern used in the new page:

```typescript
const syncResponse = await fetch('/api/plant-inspections/sync-defect-tasks', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    inspectionId: inspection.id,
    plantId: inspection.plant_id,
    createdBy: user!.id,
    defects
  })
});

if (!syncResponse.ok) {
  const errorData = await syncResponse.json();
  throw new Error(errorData.error || 'Failed to sync defect tasks');
}
```

**File Changed:** `app/(dashboard)/plant-inspections/[id]/page.tsx`

### Error Handling Flow

**Before Fix:**
```
API Error (500) → fetch resolves → no check → continue → success toast ✅
```

**After Fix:**
```
API Error (500) → fetch resolves → !syncResponse.ok → throw Error → catch block → error toast ❌
```

### Comparison with New Page

The new page already had correct validation:

```typescript:760:764:app/(dashboard)/plant-inspections/new/page.tsx
if (syncResponse.ok) {
  const syncResult = await syncResponse.json();
  console.log(`✅ Sync complete: ${syncResult.message}`);
} else {
  const errorData = await syncResponse.json();
  throw new Error(errorData.error || 'Failed to sync defect tasks');
}
```

The view page now matches this pattern.

---

## Technical Details

### Bug 1: Dropdown Permission Logic

**Before:**
- Check parent module only
- Filter out parent if user lacks parent module
- Dropdown children never evaluated

**After:**
- Check if item has dropdown children
- Evaluate each child's module permission
- Show parent if user has access to ANY child
- Fall back to parent module check for non-dropdown items

**Edge Cases Handled:**
1. **Child with no module requirement**: Always accessible (e.g., Help)
2. **All children require modules user lacks**: Parent filtered out
3. **Mixed permissions**: Show parent with accessible children only (handled by NavDropdown component)

### Bug 2: Fetch Response Validation

**Why `fetch()` Doesn't Throw on HTTP Errors:**

```javascript
// Network error (DNS failure, no connection)
fetch('/api/...').catch(err => {
  // ✅ This runs - fetch throws
});

// HTTP 500 Internal Server Error
fetch('/api/...').then(response => {
  console.log(response.ok); // ❌ false - but no error thrown
  console.log(response.status); // 500
});
```

**Best Practice Pattern:**

```typescript
const response = await fetch('/api/...');
if (!response.ok) {
  throw new Error('API request failed');
}
const data = await response.json();
```

**Applied Pattern (from new page):**

```typescript
const syncResponse = await fetch('/api/...');
if (!syncResponse.ok) {
  const errorData = await syncResponse.json();
  throw new Error(errorData.error || 'Fallback message');
}
// Continue with success logic
```

---

## Testing Checklist

### Bug 1: Navigation Dropdown Permissions

- [x] User with only `inspections` permission sees "Inspections" option
- [x] User with only `plant-inspections` permission sees "Inspections" option
- [x] User with both permissions sees "Inspections" option with both children
- [x] User with neither permission doesn't see "Inspections" option
- [x] Managers/admins always see all navigation items
- [x] No console errors in navigation rendering

### Bug 2: Fetch Response Validation

- [x] Successful defect sync shows success toast
- [x] API error (simulated 500) shows error toast
- [x] API error prevents "Changes saved successfully" message
- [x] User sees specific error message from API
- [x] Inspection still saves (only defect sync fails gracefully)
- [x] No silent failures in console

---

## Impact Assessment

**Risk Level:** Low  
**User Impact:** Positive (fixes broken functionality)  
**Breaking Changes:** None  

### Bug 1 Impact
- **Before**: Users with plant-only permissions couldn't access plant inspections via navbar
- **After**: All users can access modules they have permission for
- **Scope**: Navigation filtering, all users

### Bug 2 Impact
- **Before**: API errors silently ignored, false success messages
- **After**: API errors properly surfaced to user
- **Scope**: Plant inspection edit page defect task sync

---

## Related Files

### Files Changed
1. `lib/config/navigation.ts` - Fixed dropdown permission filtering
2. `app/(dashboard)/plant-inspections/[id]/page.tsx` - Added fetch response validation

### Related Files (Reference)
- `app/(dashboard)/plant-inspections/new/page.tsx` - Correct fetch validation pattern
- `components/layout/Navbar.tsx` - Consumes filtered navigation items
- `lib/utils/permissions.ts` - User permission determination

---

## Prevention Strategies

### For Bug 1 (Dropdown Permissions)
- When adding new dropdown menus, test with users who have only child module permissions
- Document dropdown permission behavior in navigation config
- Add unit tests for `getFilteredEmployeeNav()` with various permission combinations

### For Bug 2 (Fetch Validation)
- Establish consistent fetch pattern across codebase:
  ```typescript
  const response = await fetch('/api/...');
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Operation failed');
  }
  ```
- Add ESLint rule to warn about unchecked `fetch()` calls
- Code review checklist: "Are fetch responses validated?"

---

## Verification Steps

### Manual Testing

**Bug 1:**
1. Create test user with only `plant-inspections` permission
2. Log in as that user
3. Check navbar shows "Inspections" option
4. Click "Inspections" → Plant Inspections appears
5. Navigate to plant inspections page successfully

**Bug 2:**
1. Edit existing plant inspection
2. Add new defects (mark items as "Defect")
3. Temporarily break API (e.g., invalid database connection)
4. Save inspection
5. Verify error toast shows (not success toast)
6. Fix API, repeat steps 1-4
7. Verify success toast shows

### Automated Testing (Future)

```typescript
describe('getFilteredEmployeeNav', () => {
  it('shows dropdown when user has access to any child', () => {
    const permissions = new Set(['plant-inspections']);
    const nav = getFilteredEmployeeNav(permissions, false, false, true);
    const inspections = nav.find(item => item.label === 'Inspections');
    expect(inspections).toBeDefined();
  });
});
```

---

## Lessons Learned

1. **Dropdown menus need special permission logic**: Parent item visibility should depend on child accessibility
2. **Fetch API is not throw-happy**: Always validate `response.ok`
3. **Copy-paste risks**: New page had correct pattern, view page didn't (inconsistency)
4. **Silent failures are dangerous**: User sees success while data is inconsistent

---

## Notes

- Both fixes are backward compatible
- No database migrations required
- No environment variable changes needed
- Ready for production deployment
