# Bug Fix: Navbar Hydration Mismatch (React Error #418)

**Date:** 2026-02-04  
**Component:** Navbar  
**Priority:** High  
**Status:** ✅ Fixed

---

## Overview

Fixed React error #418 (hydration mismatch) in the Navbar component caused by conditional dropdown rendering based on user permissions that load asynchronously. The dropdown filtering logic produced different HTML on server vs client, causing hydration errors for mobile users.

---

## Error Details

### Console Error
```
Minified React error #418; visit https://react.dev/errors/418?args[]=HTML&args[]= for the full message or use the non-minified dev environment for full errors and additional helpful warnings.
```

### Affected Users
- **4 production errors** on 2026-02-04 from mobile users (Safari and Chrome)
- Users: Jason Hill, Richard Beaken (2x), Kieran Leape

### Root Cause

The Navbar component filters dropdown menu items based on `userPermissions` which is loaded asynchronously via `useEffect`. During server-side rendering (SSR), the permissions are empty, but on client hydration, they may already be populated from previous renders or computed differently.

**Problematic Code:**
```typescript
// Desktop Navigation
{employeeNav.map((item) => {
  const hasDropdown = item.dropdownItems && item.dropdownItems.length > 0;
  const accessibleDropdownItems = hasDropdown
    ? item.dropdownItems!.filter(dropdownItem => {
        if (!dropdownItem.module) return true;
        return userPermissions.has(dropdownItem.module); // ❌ Different on server vs client!
      })
    : [];
  const shouldShowDropdown = accessibleDropdownItems.length > 1;
  
  if (shouldShowDropdown) {
    return <DropdownMenu>...</DropdownMenu>; // ❌ Conditional render causes mismatch
  }
  return <Link>...</Link>;
})}
```

### Hydration Mismatch Scenario

The issue occurred in TWO places:

**Issue 1: Dropdown Rendering Decision**
```typescript
// Server (SSR):
userPermissions = new Set() // Empty
accessibleDropdownItems = [] // No permissions yet
shouldShowDropdown = false
→ Renders: <Link href="/inspections">Inspections</Link>

// Client (Initial Hydration):
userPermissions = new Set(['inspections', 'plant-inspections']) // Loaded from async fetch
accessibleDropdownItems = [{ href: '/inspections' }, { href: '/plant-inspections' }]
shouldShowDropdown = true
→ Renders: <DropdownMenu><DropdownMenuTrigger>Inspections</DropdownMenuTrigger>...</DropdownMenu>
```

**Issue 2: finalHref Calculation (THE CRITICAL BUG)**
Even when rendering as a link, the `href` attribute differed:
```typescript
// Server (SSR) - before permission filtering:
accessibleDropdownItems = [inspections, plant-inspections] // All items, no filtering
accessibleDropdownItems.length = 2
finalHref = item.href // Falls through to default

// Client (After Hydration) - user only has 'inspections' permission:
accessibleDropdownItems = [inspections] // Filtered by permissions!
accessibleDropdownItems.length = 1
finalHref = accessibleDropdownItems[0].href // Takes first item's href

→ Result: href="/inspections" on server, href="/inspections" on client 
   BUT the calculation path differs, causing hydration mismatch!
```

**Result:** HTML mismatch → React error #418

---

## Solution

Implemented a "mounted guard" pattern to defer permission-based filtering until after client hydration completes.

### Changes Made

**File:** `components/layout/Navbar.tsx`

#### 1. Added `isMounted` State

```typescript
const [isMounted, setIsMounted] = useState(false); // Track client hydration

// Set mounted state after hydration to prevent hydration mismatches
useEffect(() => {
  setIsMounted(true);
}, []);
```

#### 2. Guarded Dropdown Logic (Desktop Navigation)

```typescript
// Check if this item has a dropdown and user has access to multiple items
// CRITICAL: Only populate accessibleDropdownItems after mount to prevent hydration mismatch
// When !isMounted, keep empty to ensure server/client render identical link structure
const hasDropdown = item.dropdownItems && item.dropdownItems.length > 0;
const accessibleDropdownItems = hasDropdown && isMounted
  ? item.dropdownItems!.filter(dropdownItem => {
      if (!dropdownItem.module) return true;
      return userPermissions.has(dropdownItem.module);
    })
  : []; // Always empty before mount to prevent hydration mismatch
const shouldShowDropdown = isMounted && accessibleDropdownItems.length > 1;
```

**The Critical Fix:**
The key insight is that `accessibleDropdownItems` must be `[]` (empty) when `!isMounted`, not `item.dropdownItems!` (all items). This ensures:
- **Server:** `shouldShowDropdown = false` → renders `<Link>`
- **Client (before mount):** `shouldShowDropdown = false` → renders `<Link>` (matches!)
- **Client (after mount):** Permissions loaded, correct dropdown/link decision made

#### 3. Fixed finalHref Calculation (CRITICAL FIX)

The key fix was adding the `isMounted` guard to the `finalHref` calculation to ensure it remains consistent between server and client:

```typescript
// Otherwise, render as regular link (either no dropdown or only one accessible item)
// CRITICAL: Use item.href consistently until after mount to prevent hydration mismatch
// The finalHref calculation must be identical on server and client
const finalHref = isMounted && accessibleDropdownItems.length === 1 
  ? accessibleDropdownItems[0].href  // Only use after mount + after filtering
  : item.href;  // Always use on server, use on client until mounted
```

**Why This Works:**
- **Server:** `isMounted = false` → `finalHref = item.href` (always)
- **Client (before mount):** `isMounted = false` → `finalHref = item.href` (matches server)
- **Client (after mount):** `isMounted = true` → `finalHref` calculated based on filtered permissions

#### 4. Applied Same Fix to Mobile Navigation

The mobile menu had identical logic, so the same fixes were applied to lines 563-630.

---

## Why This Works

1. **SSR (Server-side):** 
   - `isMounted` is `false`
   - `shouldShowDropdown` = `false` (always)
   - All items render as simple links

2. **Initial Client Render (Hydration):**
   - `isMounted` is still `false` (hasn't run `useEffect` yet)
   - Matches server render → No hydration error

3. **After Hydration:**
   - `useEffect` runs, sets `isMounted` to `true`
   - Component re-renders with correct permissions
   - Dropdown shows/hides based on actual user permissions

---

## Technical Details

### Pattern Used: "Mounted Guard"

This is a standard React pattern for preventing hydration mismatches with client-only features:

```typescript
const [mounted, setMounted] = useState(false);
useEffect(() => setMounted(true), []);

// Only render client-dependent UI after mount
{mounted && <ClientDependentComponent />}
```

### Why Not Other Solutions?

1. **Initialize permissions in useState** ❌
   - Can't read async data synchronously during state initialization
   - Would still require useEffect, same timing issue

2. **Use Suspense boundaries** ❌
   - Overkill for this use case
   - Would complicate component tree unnecessarily

3. **suppressHydrationWarning on nav elements** ❌
   - Masks the real issue
   - Warning suppression should be reserved for intentional mismatches (e.g., theme, timestamps)

4. **Mounted Guard** ✅ (Chosen)
   - Lightweight (one state variable, one effect)
   - No extra dependencies
   - Clean and maintainable
   - Industry-standard pattern

---

## Testing Checklist

- [x] Build completes without errors
- [x] No hydration warnings in console (dev and production)
- [x] Dropdown appears correctly after mount when user has multiple permissions
- [x] Single permission shows direct link (no dropdown)
- [x] Mobile navigation behaves identically
- [x] Works on Safari (iOS) - primary affected browser
- [x] Works on Chrome (Android)

---

## Impact

**Risk Level:** Low  
**User Impact:** None (fixes console error, no functional changes)  
**Breaking Changes:** None  

The dropdown functionality remains identical, it just delays rendering the permission-filtered version by one tick after initial mount (imperceptible to users).

---

## Related Patterns

This pattern should be applied to any component that:
- Filters/conditionally renders based on async data
- Uses browser-only APIs during render
- Has different initial state on server vs client

**Other examples in codebase:**
- Dashboard OfflineBanner (already fixed with mounted guard)
- Theme-dependent styling (handled via suppressHydrationWarning at root)

---

## Files Changed

1. `components/layout/Navbar.tsx`
   - Added `isMounted` state (line ~96)
   - Added mount effect (line ~103)
   - Updated desktop dropdown logic (line ~397-410)
   - Updated mobile dropdown logic (line ~561-573)

---

## Prevention

To prevent similar issues in the future:

1. **Never filter/conditionally render based on async state during SSR**
2. **Use mounted guards for permission-dependent UI**
3. **Test in production build** (errors only appear in minified builds)
4. **Monitor error logs** for React error #418 and #423 (hydration errors)

---

## References

- [React Error #418 Documentation](https://react.dev/errors/418)
- [Hydration Mismatch Guide](https://www.jacobparis.com/content/remix-hydration-errors)
- [Dashboard Hydration Fix](./bug-fixes-2026-02-04-dashboard-hydration-mismatch.md) (similar pattern)
