# Bug Fix: Category Dialog Checkbox Default Value Issue

**Date:** 2026-02-04  
**Issue:** Incorrect default value when toggling applies_to checkboxes  
**Status:** ✅ Fixed

## Problem

When the plant checkbox handler retrieves the current `applies_to` value, it defaults to `['vehicle']` when the value is falsy (undefined or null). This causes incorrect behavior when:

1. User opens dialog with undefined/null `applies_to`
2. User checks plant checkbox
3. Function adds plant to the default `['vehicle']` instead of to an empty array
4. Result: User gets `['vehicle', 'plant']` instead of just `['plant']`

### Code Location

**CategoryDialog.tsx** Lines 491-499 (Plant checkbox):
```typescript
onCheckedChange={(checked) => {
  const current = appliesTo || ['vehicle']; // ❌ Wrong default
  if (checked) {
    setValue('applies_to', [...current.filter(a => a !== 'plant'), 'plant']);
  } else {
    setValue('applies_to', current.filter(a => a !== 'plant'));
  }
}}
```

**CategoryDialog.tsx** Lines 472-479 (Vehicle checkbox - same issue):
```typescript
onCheckedChange={(checked) => {
  const current = appliesTo || ['vehicle']; // ❌ Wrong default
  if (checked) {
    setValue('applies_to', [...current.filter(a => a !== 'vehicle'), 'vehicle']);
  } else {
    setValue('applies_to', current.filter(a => a !== 'vehicle'));
  }
}}
```

### Example Scenario

**User wants to create plant-only category:**

1. Opens dialog (appliesTo is undefined)
2. Checks "Plant Machinery"
3. Expected: `applies_to: ['plant']`
4. **Actual (before fix):** `applies_to: ['vehicle', 'plant']` ❌

**Why this happens:**
```typescript
const appliesTo = undefined; // Initial state
const current = appliesTo || ['vehicle']; // → ['vehicle'] ❌
const result = [...current, 'plant']; // → ['vehicle', 'plant'] ❌
```

### Impact

- Users cannot create plant-only categories from the dialog
- Checking plant always includes vehicle unexpectedly
- Inconsistent with user intent
- Workaround required: Check plant, then uncheck vehicle

---

## Solution

Change the default from `['vehicle']` to `[]` (empty array) for both checkboxes.

### Fix Applied

**CategoryDialog.tsx** Lines 473 & 493:

**Before:**
```typescript
const current = appliesTo || ['vehicle']; // ❌ Defaults to ['vehicle']
```

**After:**
```typescript
const current = appliesTo || []; // ✅ Defaults to empty array
```

### Why This Is Correct

1. **Respects user intent:** Empty default doesn't force any asset type
2. **Works with validation:** Zod schema `.min(1)` catches empty arrays
3. **Consistent behavior:** Same default for both checkboxes
4. **Clear logic:** User explicitly selects which asset types to include

---

## Changes Made

### CategoryDialog.tsx

**Line 473 (Vehicle checkbox):**
```typescript
// BEFORE
const current = appliesTo || ['vehicle'];

// AFTER
const current = appliesTo || []; // ✅ Default to empty, not ['vehicle']
```

**Line 493 (Plant checkbox):**
```typescript
// BEFORE
const current = appliesTo || ['vehicle'];

// AFTER
const current = appliesTo || []; // ✅ Default to empty, not ['vehicle']
```

---

## Verification

### User Interaction Flows

**Flow 1: Create plant-only category**
```typescript
// Initial state
appliesTo = undefined;

// User checks plant
const current = appliesTo || []; // → []
const result = [...current, 'plant']; // → ['plant'] ✅

// Result: ['plant'] ✅ Correct!
```

**Flow 2: Create vehicle-only category**
```typescript
// Initial state
appliesTo = undefined;

// User checks vehicle
const current = appliesTo || []; // → []
const result = [...current, 'vehicle']; // → ['vehicle'] ✅

// Result: ['vehicle'] ✅ Correct!
```

**Flow 3: Create category for both**
```typescript
// Initial state
appliesTo = undefined;

// User checks plant
appliesTo = ['plant'];

// User checks vehicle
const current = appliesTo || []; // → ['plant']
const result = [...current, 'vehicle']; // → ['plant', 'vehicle'] ✅

// Result: ['plant', 'vehicle'] ✅ Correct!
```

### JavaScript Truthiness Note

Important distinction:
```typescript
undefined || ['vehicle'] // → ['vehicle'] (undefined is falsy)
null || ['vehicle']      // → ['vehicle'] (null is falsy)
[] || ['vehicle']        // → [] (empty array is truthy!)
```

The bug occurs when `appliesTo` is **falsy** (undefined/null), not when it's an empty array. Empty arrays are truthy in JavaScript.

### Test Coverage

Created comprehensive test suite with 27 passing tests:
- ✅ Undefined/null default behavior (before/after)
- ✅ All checkbox interaction scenarios
- ✅ User interaction flows
- ✅ Edge cases (toggle, duplicate prevention)
- ✅ Validation interaction
- ✅ Empty array vs falsy values

```bash
✓ tests/unit/category-dialog-checkbox-default-fix.test.ts (27 tests) 14ms
```

---

## Impact

### Before Fix

**When appliesTo is undefined/null:**
```typescript
// User checks plant only
appliesTo = undefined;
current = appliesTo || ['vehicle']; // → ['vehicle']
result = [...current, 'plant']; // → ['vehicle', 'plant'] ❌

// User wanted: ['plant']
// User got: ['vehicle', 'plant']
```

**User Experience:**
- ❌ Cannot create plant-only categories directly
- ❌ Always includes vehicle unintentionally
- ❌ Requires workaround: Check plant, then uncheck vehicle
- ❌ Confusing behavior

### After Fix

**When appliesTo is undefined/null:**
```typescript
// User checks plant only
appliesTo = undefined;
current = appliesTo || []; // → []
result = [...current, 'plant']; // → ['plant'] ✅

// User wanted: ['plant']
// User got: ['plant']
```

**User Experience:**
- ✅ Can create plant-only categories directly
- ✅ Only includes selected asset types
- ✅ No workaround needed
- ✅ Clear, predictable behavior

---

## Technical Details

### Checkbox Handler Pattern

**Anti-pattern (before):**
```typescript
const current = appliesTo || ['vehicle']; // ❌ Assumes default
```

**Correct pattern (after):**
```typescript
const current = appliesTo || []; // ✅ Neutral default
```

### Why Empty Array Is Correct

1. **Neutral:** Doesn't assume any asset type
2. **Explicit:** User explicitly selects what they want
3. **Safe:** Validation catches empty arrays (`.min(1)`)
4. **Consistent:** Same logic for all checkboxes

### Validation Layer

The Zod schema ensures empty arrays are rejected:
```typescript
applies_to: z.array(z.enum(['vehicle', 'plant']))
  .min(1, 'Category must apply to at least one asset type')
  .default(['vehicle']),
```

This provides:
- ✅ Form-level validation (prevents empty submission)
- ✅ Clear error message to user
- ✅ Separation of concerns (UI logic vs validation logic)

---

## Related Bugs Fixed

This fix complements **Bug 12** (Empty applies_to Validation), which added `.min(1)` validation to prevent empty arrays from being submitted. Together:

- **Bug 12:** Prevent empty arrays at submission (validation layer)
- **Bug 18:** Prevent unintended defaults at UI interaction (logic layer)

Both work together:
1. UI layer: Empty default lets user choose explicitly
2. Validation layer: Ensures at least one is selected
3. Result: Clean separation, correct behavior

---

## User Scenarios

### Scenario 1: Creating Plant-Only Category

**Before Fix:**
1. Click "Add Category"
2. Check "Plant Machinery" → Gets `['vehicle', 'plant']` ❌
3. Must manually uncheck "Vehicles"
4. Finally gets `['plant']`

**After Fix:**
1. Click "Add Category"
2. Check "Plant Machinery" → Gets `['plant']` ✅
3. Done!

### Scenario 2: Creating Vehicle-Only Category

**Before Fix:**
1. Click "Add Category"
2. Check "Vehicles" → Gets `['vehicle']` ✅ (works by accident)

**After Fix:**
1. Click "Add Category"
2. Check "Vehicles" → Gets `['vehicle']` ✅ (works by design)

### Scenario 3: Creating Category for Both

**Before Fix:**
1. Click "Add Category"
2. Check "Plant Machinery" → Gets `['vehicle', 'plant']` ❌
3. Actually has both (user got lucky if that's what they wanted)

**After Fix:**
1. Click "Add Category"
2. Check "Plant Machinery" → Gets `['plant']`
3. Check "Vehicles" → Gets `['plant', 'vehicle']` ✅
4. User explicitly selected both ✅

---

## Related Files

**Code:**
- `app/(dashboard)/maintenance/components/CategoryDialog.tsx` (Lines 473, 493)

**Tests:**
- `tests/unit/category-dialog-checkbox-default-fix.test.ts`

**Related Fixes:**
- Bug 12: Empty applies_to validation (Zod schema)

---

## Prevention

### For Future Checkbox Handlers

1. **Use neutral defaults:**
   ```typescript
   // ❌ BAD: Assumes a value
   const current = value || ['default'];
   
   // ✅ GOOD: Neutral empty
   const current = value || [];
   ```

2. **Let validation handle requirements:**
   ```typescript
   // UI: Allow empty (user can uncheck all)
   const current = appliesTo || [];
   
   // Validation: Catch empty before submission
   applies_to: z.array(T).min(1, 'Error message')
   ```

3. **Separate concerns:**
   - UI logic: Handle user interaction
   - Validation logic: Enforce constraints
   - Don't mix them!

### Code Review Checklist

- [ ] Do checkbox handlers use neutral defaults?
- [ ] Is validation separate from UI logic?
- [ ] Can users explicitly select any valid combination?
- [ ] Are there tests covering the interaction flows?

---

## Summary

This fix corrects the default value in category dialog checkbox handlers from `['vehicle']` to `[]`, ensuring:

- ✅ Users can create plant-only categories directly
- ✅ No unintended asset types included
- ✅ Clear, predictable checkbox behavior
- ✅ Validation layer catches empty arrays
- ✅ Better separation of concerns

The fix is minimal (2 characters changed in 2 places) but significantly improves user experience and code correctness.
