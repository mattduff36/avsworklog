# Bug Fix: AddVehicleDialog Asset Type State Management

**Date:** 2026-02-04  
**Issue:** assetType state not syncing with initialAssetType prop changes  
**Status:** ✅ Fixed

## Problem

When `AddVehicleDialog` closes, it reset `assetType` to hardcoded `'vehicle'` instead of the `initialAssetType` prop. When the dialog reopened with a different `assetType` prop (e.g., `'plant'` from `PlantTable`), the internal state wouldn't update because `useState` only uses the prop for initial state, not for subsequent updates.

### Code Before

```typescript
// Line 51: State initialized from prop
const [assetType, setAssetType] = useState<AssetType>(initialAssetType);

// Lines 71-87: Reset effect
useEffect(() => {
  if (!open) {
    setAssetType('vehicle'); // ❌ Hardcoded 'vehicle'
    // ... reset other fields
  }
}, [open]); // ❌ Missing initialAssetType dependency

// Lines 65-69: Open effect
useEffect(() => {
  if (open) {
    fetchCategories(); // ❌ Doesn't sync assetType with prop
  }
}, [open]); // ❌ Missing initialAssetType dependency
```

### Impact

**Scenario 1: PlantTable → Add Plant (Second Time)**
```
1. User opens PlantTable
2. Clicks "Add Plant" → Dialog opens with assetType='plant' ✅
3. User closes dialog (cancel/complete)
4. Dialog resets assetType to 'vehicle' ❌ (should be 'plant')
5. User clicks "Add Plant" again
6. Dialog opens but assetType is still 'vehicle' ❌
7. Wrong categories shown (vehicle categories instead of plant)
```

**Scenario 2: Switch Between Asset Types**
```
1. User adds plant → assetType='plant'
2. User closes dialog → assetType resets to 'vehicle'
3. User navigates to vehicle section
4. User clicks "Add Vehicle" → assetType stays 'vehicle' ✅ (by luck)
5. User goes back to PlantTable
6. User clicks "Add Plant" → assetType is 'vehicle' ❌ (stuck)
```

### Root Causes

1. **Hardcoded Reset Value:** Line 74 reset to `'vehicle'` instead of `initialAssetType` prop
2. **No Prop Sync:** Dialog didn't update state when `initialAssetType` prop changed
3. **Missing Dependencies:** useEffect hooks didn't include `initialAssetType`

---

## Solution

### Fix 1: Reset to Prop Value

```typescript
// BEFORE
useEffect(() => {
  if (!open) {
    setAssetType('vehicle'); // ❌ Hardcoded
    // ...
  }
}, [open]);

// AFTER
useEffect(() => {
  if (!open) {
    setAssetType(initialAssetType); // ✅ Use prop value
    // ...
  }
}, [open, initialAssetType]); // ✅ Added dependency
```

### Fix 2: Sync State on Open

```typescript
// BEFORE
useEffect(() => {
  if (open) {
    fetchCategories();
  }
}, [open]);

// AFTER
useEffect(() => {
  if (open) {
    fetchCategories();
    setAssetType(initialAssetType); // ✅ Sync with prop
  }
}, [open, initialAssetType]); // ✅ Added dependency
```

---

## Changes Made

### AddVehicleDialog.tsx

**Line 67:** Added `setAssetType(initialAssetType)` when dialog opens
```typescript
useEffect(() => {
  if (open) {
    fetchCategories();
    setAssetType(initialAssetType); // ✅ Sync state with prop
  }
}, [open, initialAssetType]); // ✅ Added dependency
```

**Line 74:** Changed from hardcoded `'vehicle'` to `initialAssetType` prop
```typescript
useEffect(() => {
  if (!open) {
    setAssetType(initialAssetType); // ✅ Reset to prop value
    setFormData({ /* ... */ });
    setError('');
  }
}, [open, initialAssetType]); // ✅ Added dependency
```

---

## Data Flow

### Before Fix (Broken)

```
PlantTable renders AddVehicleDialog:
  └─ <AddVehicleDialog assetType="plant" />

First Opening:
  └─ useState initializes: assetType = 'plant' ✅

Dialog Closes:
  └─ useEffect runs: setAssetType('vehicle') ❌
  └─ Internal state: assetType = 'vehicle' ❌

Second Opening:
  └─ Prop: assetType="plant"
  └─ useState doesn't re-initialize (already mounted)
  └─ Internal state: assetType = 'vehicle' ❌
  └─ Shows vehicle categories in plant dialog ❌
```

### After Fix (Working)

```
PlantTable renders AddVehicleDialog:
  └─ <AddVehicleDialog assetType="plant" />

First Opening:
  └─ useState initializes: assetType = 'plant' ✅
  └─ useEffect syncs: setAssetType('plant') ✅

Dialog Closes:
  └─ useEffect runs: setAssetType(initialAssetType) = 'plant' ✅
  └─ Internal state: assetType = 'plant' ✅

Second Opening:
  └─ Prop: assetType="plant"
  └─ useEffect syncs: setAssetType('plant') ✅
  └─ Internal state: assetType = 'plant' ✅
  └─ Shows plant categories correctly ✅
```

---

## User Experience Impact

### Before Fix
```
User Journey:
1. Open PlantTable → Click "Add Plant"
2. See plant categories ✅
3. Cancel and close dialog
4. Click "Add Plant" again
5. See vehicle categories ❌ (Wrong!)
6. User confused, might create vehicle in plant section
```

### After Fix
```
User Journey:
1. Open PlantTable → Click "Add Plant"
2. See plant categories ✅
3. Cancel and close dialog
4. Click "Add Plant" again
5. See plant categories ✅ (Correct!)
6. Consistent experience every time
```

---

## Technical Details

### React useState Behavior

**Initial State:**
```typescript
const [state, setState] = useState(initialValue);
// initialValue only used on first render
// Subsequent renders ignore initialValue
```

**Prop Synchronization:**
```typescript
// Need useEffect to sync state with prop changes
useEffect(() => {
  setState(propValue);
}, [propValue]);
```

### Why Two useEffects?

1. **Open Effect (Line 65):** Syncs state when dialog opens
   - Ensures correct assetType on every opening
   - Fetches categories
   - Runs when `open` or `initialAssetType` changes

2. **Close Effect (Line 72):** Resets state when dialog closes
   - Clears form data
   - Resets to prop value (not hardcoded)
   - Prepares for next opening

---

## Testing

### Test Coverage
Created `tests/unit/add-vehicle-dialog-asset-type-fix.test.ts` with:
- ✅ Reset to prop value, not hardcoded
- ✅ useState prop synchronization
- ✅ Real-world workflow scenarios
- ✅ Category filtering after reopening
- ✅ Edge cases (rapid changes, undefined props)
- ✅ useEffect dependency validation

### Test Results
```bash
✓ tests/unit/add-vehicle-dialog-asset-type-fix.test.ts (15 tests) 11ms
```

---

## Examples

### Example 1: Plant Dialog Reopening

```typescript
// Component usage
<AddVehicleDialog
  open={isOpen}
  onOpenChange={setIsOpen}
  assetType="plant" // Prop value
  onSuccess={handleSuccess}
/>

// First open
open: true → assetType = 'plant' ✅

// Close
open: false → assetType = 'plant' ✅ (reset to prop)

// Second open
open: true → assetType = 'plant' ✅ (synced with prop)
```

### Example 2: Switching Asset Types

```typescript
// User in PlantTable
<AddVehicleDialog assetType="plant" open={true} />
// State: assetType = 'plant' ✅

// User navigates to vehicle section
<AddVehicleDialog assetType="vehicle" open={true} />
// State: assetType = 'vehicle' ✅ (prop changed, state synced)
```

### Example 3: Category Filtering

```typescript
// Categories based on assetType
const filteredCategories = categories.filter(c => {
  const appliesTo = c.applies_to || ['vehicle'];
  return appliesTo.includes(assetType); // Uses synchronized state
});

// Plant dialog (assetType='plant'):
// Shows: ['Excavator', 'Telehandler', 'Shared'] ✅

// Vehicle dialog (assetType='vehicle'):
// Shows: ['Car', 'Van', 'Shared'] ✅
```

---

## Verification

### Manual Testing Steps

1. **Test Plant Dialog Reopening:**
   - Open Settings tab → Plant section
   - Click "Add Plant" → Verify plant categories shown
   - Cancel dialog
   - Click "Add Plant" again → Verify plant categories still shown ✅

2. **Test Asset Type Switching:**
   - Open plant dialog → Verify plant categories
   - Close and navigate to vehicle section
   - Open vehicle dialog → Verify vehicle categories
   - Go back to plant section
   - Open plant dialog → Verify plant categories ✅

3. **Test Rapid Open/Close:**
   - Rapidly open and close plant dialog multiple times
   - Verify plant categories shown every time ✅

---

## Related Issues

This fix complements previous bug fixes:
- **Bug 2 (Session 3):** AddVehicleDialog missing assetType prop
- **Bug 2 (Session 4):** Empty applies_to validation

Together, these ensure:
- ✅ Dialog receives correct assetType prop
- ✅ Dialog syncs state with prop correctly
- ✅ Categories are filtered by valid applies_to arrays

---

## Prevention

### Best Practices for Prop Synchronization

1. **Always sync derived state with props:**
```typescript
useEffect(() => {
  setState(propValue);
}, [propValue]);
```

2. **Include all dependencies in useEffect:**
```typescript
// ✅ CORRECT
useEffect(() => {
  // uses propA and propB
}, [propA, propB]);

// ❌ WRONG
useEffect(() => {
  // uses propA and propB
}, []); // Missing dependencies
```

3. **Don't hardcode reset values:**
```typescript
// ❌ WRONG
setAssetType('vehicle'); // What if prop is 'plant'?

// ✅ CORRECT
setAssetType(initialAssetType); // Use prop value
```

4. **Document prop usage in comments:**
```typescript
// Reset to prop value, not hardcoded 'vehicle'
setAssetType(initialAssetType);
```

---

## Impact Summary

### Before Fix
- ❌ assetType stuck on wrong value after reopening
- ❌ Wrong categories shown in dialog
- ❌ Confusing user experience
- ❌ Potential data entry errors

### After Fix
- ✅ assetType always syncs with prop
- ✅ Correct categories shown every time
- ✅ Consistent user experience
- ✅ Reliable dialog behavior

---

## Related Files

**Component:**
- `app/(dashboard)/maintenance/components/AddVehicleDialog.tsx`

**Tests:**
- `tests/unit/add-vehicle-dialog-asset-type-fix.test.ts`

**Callers:**
- `app/(dashboard)/maintenance/components/PlantTable.tsx` (passes `assetType="plant"`)
- Other components (default `assetType="vehicle"`)

---

## Conclusion

This fix ensures `AddVehicleDialog` properly synchronizes its internal `assetType` state with the `initialAssetType` prop throughout its lifecycle. The dialog now correctly resets to the prop value (not a hardcoded value) and updates when the prop changes, providing a consistent and reliable user experience.
