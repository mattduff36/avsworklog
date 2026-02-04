# Bug Fix: Navbar Active State for Single Dropdown Items

**Date:** 2026-02-04  
**Component:** Navbar Component  
**Priority:** Medium  
**Status:** ✅ Fixed

---

## Overview

Fixed incorrect active styling in the navbar when users have access to only one dropdown item. The bug caused the navbar button to check active state against the wrong URL, resulting in incorrect highlighting.

---

## Bug Description

### Issue
When a user has access to only one dropdown item (e.g., only "Plant Inspections" but not "Vehicle Inspections"), the code sets `finalHref` to that single item's href but continues using `isActive` which is based on the parent `item.href`. This causes incorrect active styling.

### Example Scenario

**User with only Plant Inspections access:**
1. User navigates to `/plant-inspections`
2. Navbar "Inspections" button has:
   - `finalHref = "/plant-inspections"` (correct link)
   - `isActive = isLinkActive("/inspections")` (wrong check!)
3. Result: Button is NOT highlighted even though user is on plant inspections page

**Expected behavior:**
- Button should be highlighted when on `/plant-inspections`
- `isActive` should check against `finalHref`, not `item.href`

---

## Root Cause

### Desktop Navigation (Lines 391-476)

```typescript
// BEFORE (BUGGY):
const isActive = isLinkActive(item.href);  // ❌ Checks parent href
const activeColors = getNavItemActiveColors(item.href);

// ... dropdown logic ...

// Later, finalHref is set to dropdown item's href
const finalHref = accessibleDropdownItems.length === 1 
  ? accessibleDropdownItems[0].href  // "/plant-inspections"
  : item.href;  // "/inspections"

// But isActive still uses item.href!
return (
  <Link href={finalHref}>  // Links to /plant-inspections
    <div className={isActive ? active : inactive}>  // Checks /inspections ❌
```

### Mobile Navigation (Lines 552-621)
Same issue exists in the mobile navigation section.

---

## Solution

Moved the `isActive` and `activeColors` calculation to AFTER `finalHref` is determined, so it checks the correct URL.

### Desktop Fix (Lines 454-476)

```typescript
// AFTER (FIXED):
const finalHref = accessibleDropdownItems.length === 1 
  ? accessibleDropdownItems[0].href 
  : item.href;

// Recalculate isActive based on finalHref to ensure correct styling ✅
const isActive = isLinkActive(finalHref);
const activeColors = getNavItemActiveColors(finalHref);

return (
  <Link href={finalHref}>  // Links to /plant-inspections
    <div className={isActive ? active : inactive}>  // Checks /plant-inspections ✅
```

### Mobile Fix (Lines 596-621)

Applied the same fix to the mobile navigation section.

---

## Code Changes

### Desktop Navigation

```diff
  {employeeNav.map((item) => {
    const Icon = item.icon;
-   const isActive = isLinkActive(item.href);
-   const activeColors = getNavItemActiveColors(item.href);
    
    // ... dropdown logic ...
    
    // Otherwise, render as regular link
    const finalHref = accessibleDropdownItems.length === 1 
      ? accessibleDropdownItems[0].href 
      : item.href;
    
+   // Recalculate isActive based on finalHref to ensure correct styling
+   const isActive = isLinkActive(finalHref);
+   const activeColors = getNavItemActiveColors(finalHref);
    
    return (
      <Link href={finalHref} className={isActive ? active : inactive}>
```

### Mobile Navigation

Same change pattern applied to mobile section.

---

## Testing Scenarios

### Test 1: User with Both Inspections Access
```
Permissions: inspections ✓, plant-inspections ✓
Navbar: Shows dropdown menu
Result: 
✅ Dropdown appears with both options
✅ Active highlighting works for both items
✅ No change to existing behavior
```

### Test 2: User with Only Vehicle Inspections
```
Permissions: inspections ✓, plant-inspections ✗
Navbar: Direct link to /inspections
Active check: isLinkActive("/inspections")
Result:
✅ Button highlights when on /inspections
✅ Button NOT highlighted when on /plant-inspections (no access anyway)
```

### Test 3: User with Only Plant Inspections (Bug Case)
```
Permissions: inspections ✗, plant-inspections ✓
Navbar: Direct link to /plant-inspections
Active check: isLinkActive("/plant-inspections")

BEFORE FIX:
❌ Button NOT highlighted when on /plant-inspections
   (was checking /inspections instead)

AFTER FIX:
✅ Button correctly highlighted when on /plant-inspections
   (now checks /plant-inspections)
```

### Test 4: User with No Inspections Access
```
Permissions: inspections ✗, plant-inspections ✗
Navbar: Button not shown (filtered out)
Result:
✅ No change, button correctly hidden
```

---

## Technical Details

### Order of Operations

**Before Fix:**
1. Calculate `isActive` using `item.href` ❌
2. Calculate `activeColors` using `item.href` ❌
3. Determine `finalHref` (may differ from `item.href`)
4. Render with mismatched values

**After Fix:**
1. Determine `finalHref` first
2. Calculate `isActive` using `finalHref` ✅
3. Calculate `activeColors` using `finalHref` ✅
4. Render with matching values

### Why This Matters

The navbar dropdown feature was designed to support multiple inspection types:
- Vehicle Inspections (`/inspections`)
- Plant Inspections (`/plant-inspections`)

Role-based access control allows users to have access to one or both. When a user has only one, the UI collapses the dropdown into a direct link, but the active state calculation wasn't updated to match.

---

## Impact

**Risk Level:** Low  
**User Impact:** Positive (correct visual feedback)  
**Breaking Changes:** None  

**Affected Users:**
- Employees with access to only vehicle OR plant inspections (not both)
- Visual-only bug, no functional impact
- Fix improves UX by providing correct active state highlighting

---

## Files Changed

1. `components/layout/Navbar.tsx`
   - **Desktop navigation:** Moved `isActive` and `activeColors` calculation after `finalHref` (lines 458-460)
   - **Mobile navigation:** Moved `isActive` and `activeColors` calculation after `finalHref` (lines 602-604)

---

## Related Issues

This pattern should be reviewed for any future dropdown items with similar single-item collapsing behavior.
