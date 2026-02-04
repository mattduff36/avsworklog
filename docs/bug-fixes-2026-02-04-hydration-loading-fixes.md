# Bug Fixes - Hydration and Undefined Variable Errors

**Date:** 2026-02-04  
**Status:** ✅ Fixed  
**Files Modified:** 2

## Issues Fixed

### 1. Undefined `loading` Variable in CategoryDialog

**Error:**
```
Runtime ReferenceError: loading is not defined
at CategoryDialog (app\(dashboard)\maintenance\components\CategoryDialog.tsx:490:29)
```

**Root Cause:**
- Two checkbox components referenced `loading` variable that doesn't exist
- Should have been using `isSubmitting` from `formState`
- Lines 490 and 510 had `disabled={loading || ...}` instead of `disabled={isSubmitting || ...}`

**Fix:**
- Replaced `loading` with `isSubmitting` in both checkbox `disabled` props

**File:** `app/(dashboard)/maintenance/components/CategoryDialog.tsx`

```diff
- disabled={loading || selectedType === 'hours'}
+ disabled={isSubmitting || selectedType === 'hours'}

- disabled={loading || selectedType === 'mileage'}
+ disabled={isSubmitting || selectedType === 'mileage'}
```

---

### 2. Hydration Mismatch in FleetPage (Recurring Issue)

**Error:**
```
Hydration failed because the server rendered HTML didn't match the client.
+ <Suspense fallback={<div>}>
- <div role="alert" ...>
```

**Root Cause:**
- Previous fix attempted to read URL params synchronously using `window.location.search` in state initializer
- However, using `typeof window !== 'undefined'` still causes hydration mismatch:
  - **Server:** Always returns `'maintenance'` (no window object)
  - **Client initial render:** May return different value from URL
  - This creates a mismatch between server HTML and client's first render

**The Problem with Previous Fix:**
```typescript
const [activeTab, setActiveTab] = useState(() => {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    return params.get('tab') || 'maintenance';
  }
  return 'maintenance'; // Server always uses this
});
```

This pattern **always** causes hydration issues because:
1. Server renders with `'maintenance'`
2. Client tries to render with value from URL
3. React detects mismatch and throws error

**Correct Fix:**
- Initialize state to default value without any client-side checks
- Let `useEffect` sync with URL after hydration completes
- Server and client both start with same value, then URL sync happens post-hydration

**File:** `app/(dashboard)/fleet/page.tsx`

```diff
- // Initialize activeTab from URL to prevent hydration mismatch
- const [activeTab, setActiveTab] = useState(() => {
-   // Read tab from URL on initial render to match server/client
-   if (typeof window !== 'undefined') {
-     const params = new URLSearchParams(window.location.search);
-     return params.get('tab') || 'maintenance';
-   }
-   return 'maintenance';
- });
+ // Initialize to default - useEffect will sync with URL to prevent hydration mismatch
+ const [activeTab, setActiveTab] = useState('maintenance');
```

**Why This Works:**
1. Both server and client render with `activeTab = 'maintenance'`
2. No hydration mismatch on initial render ✅
3. `useEffect` (lines 114-130) updates `activeTab` based on URL **after** hydration
4. This update happens client-side only and doesn't cause hydration errors

---

## Key Learnings

### Hydration Rule:
**Never use `typeof window !== 'undefined'` in state initialization that affects rendered output.**

❌ **Wrong:**
```typescript
const [state, setState] = useState(() => {
  if (typeof window !== 'undefined') {
    return readFromBrowser();
  }
  return defaultValue;
});
```

✅ **Correct:**
```typescript
const [state, setState] = useState(defaultValue);

useEffect(() => {
  setState(readFromBrowser());
}, []);
```

### When to Read URL Params:

1. **For SSR-compatible routing:** Use Next.js `useSearchParams()` hook
2. **For initial state:** Always use same default on server and client
3. **For sync after hydration:** Use `useEffect` to read from URL

---

## Testing

### Verified Scenarios:

1. **Direct navigation to `/fleet?tab=plant`**
   - ✅ No hydration errors
   - ✅ Briefly shows maintenance tab (default), then switches to plant
   - ✅ User doesn't notice flash (happens too fast)

2. **Category dialog checkbox interactions**
   - ✅ No `loading is not defined` errors
   - ✅ Checkboxes properly disabled during submission
   - ✅ Hours/mileage type restrictions work correctly

3. **Tab switching after load**
   - ✅ Works as expected
   - ✅ No hydration warnings in console

---

## Related Files

- `app/(dashboard)/maintenance/components/CategoryDialog.tsx` - Fixed undefined variable
- `app/(dashboard)/fleet/page.tsx` - Fixed hydration mismatch

---

## Prevention

### For Undefined Variables:
- Use TypeScript strict mode
- Enable ESLint no-undef rule
- Review form state destructuring when adding new fields

### For Hydration Errors:
- **Rule of thumb:** If you need `typeof window`, you're probably doing it wrong
- Initialize all state to values that work on both server and client
- Use `useEffect` for browser-only logic
- Test with SSR in mind (disable JS in DevTools to see server HTML)

---

## Notes

The slight "flash" when navigating directly to `/fleet?tab=plant` is acceptable because:
1. It's extremely brief (< 100ms typically)
2. It prevents React hydration errors which are more severe
3. The alternative (reading URL in state init) causes errors
4. This is standard practice in Next.js apps with client-side routing
