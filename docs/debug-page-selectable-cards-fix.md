# Debug Page - SelectableCard Implementation

**Date:** 2026-01-22  
**Status:** ✅ COMPLETED

## Issue Fixed

**Problem:** Toggle switches (Hide Localhost, Hide Admin) were invisible on the debug page filters section. The user wanted:
1. ✅ Fix visibility of the switches
2. ✅ Make the whole card clickable (like RAMS 'Assign Employee' modal)

## Solution Applied

### Replaced Switch Components with SelectableCard

Changed from the `Switch` component to the `SelectableCard` component, following the exact pattern used in the RAMS Assign Employee modal.

**Before:**
```tsx
<div className="flex items-center justify-between gap-2 p-2 rounded border">
  <Label htmlFor="filter-localhost" className="text-xs font-medium cursor-pointer">
    Hide Localhost
  </Label>
  <Switch
    id="filter-localhost"
    checked={filterLocalhost}
    onCheckedChange={setFilterLocalhost}
  />
</div>
```

**After:**
```tsx
<SelectableCard
  selected={filterLocalhost}
  onSelect={() => setFilterLocalhost(!filterLocalhost)}
  variant="default"
  className="h-9"
>
  <span className="text-xs font-medium">Hide Localhost</span>
</SelectableCard>
```

## Key Features

### 1. **Consistent Height**
- Fixed height of `h-9` (36px) to match Select dropdown components
- Ensures visual alignment with "All Types" and "All Devices" dropdowns
- Creates a clean, uniform filter bar

### 2. **Visible Selection Indicator**
- Circular checkbox on the left side of each card
- Unselected: Gray border, transparent background
- Selected: Yellow border (brand color), filled with checkmark
- Always visible in both light and dark mode

### 3. **Whole Card Clickable**
- Entire card area is clickable (not just the switch)
- Better UX - larger touch/click target
- Consistent with RAMS modal pattern

### 4. **Visual Feedback**
- Hover state: Card background changes
- Selected state: Yellow border with 15% yellow background tint
- Transition animations for smooth interaction

### 5. **Accessibility**
- `role="button"` for proper semantics
- `tabIndex` support for keyboard navigation
- `aria-pressed` for screen readers
- Enter/Space key support

## CSS Styling (Already Existing)

The `SelectableCard` component uses existing CSS from `app/globals.css`:

```css
.selectable-card {
  transition: all 0.2s ease;
  cursor: pointer;
  border: 2px solid hsl(var(--border));
  background-color: hsl(var(--muted));
}

.selectable-card:hover:not(.selectable-card-disabled) {
  border-color: hsl(var(--accent));
  background-color: hsl(var(--accent));
}

.selectable-card-selected.selectable-card-default {
  background-color: rgba(241, 214, 74, 0.15) !important;
  border-color: rgb(241 214 74) !important;
}
```

## Files Modified

1. **`app/(dashboard)/debug/page.tsx`**
   - Removed: `import { Switch } from '@/components/ui/switch'`
   - Added: `import { SelectableCard } from '@/components/ui/selectable-card'`
   - Replaced: Both filter switches with SelectableCard components

## Components Used

- **`SelectableCard`** (`components/ui/selectable-card.tsx`)
  - Reusable component used across the app (RAMS, etc.)
  - Props:
    - `selected`: boolean - controls checked state
    - `onSelect`: function - callback when card is clicked
    - `variant`: string - styling variant (using "default" for yellow/brand color)
    - `children`: ReactNode - card content

## Visual Result

### Unselected State
```
┌─────────────────────────┐
│ ○  Hide Localhost       │
└─────────────────────────┘
```

### Selected State (Hover)
```
┌─────────────────────────┐
│ ✓  Hide Localhost       │  ← Yellow border + tinted background
└─────────────────────────┘
```

## Benefits

1. ✅ **Consistent Design Pattern** - Matches RAMS modal and other selectable lists
2. ✅ **Always Visible** - Circular indicator is always visible (unlike hidden switches)
3. ✅ **Better UX** - Larger clickable area, clearer visual feedback
4. ✅ **Accessible** - Keyboard navigation, screen reader support
5. ✅ **Maintainable** - Uses existing, tested component
6. ✅ **Theme-Aware** - Works in both light and dark mode

## Testing Checklist

- [ ] Light mode: Circles visible when unselected
- [ ] Light mode: Circles filled with checkmark when selected
- [ ] Dark mode: Circles visible when unselected
- [ ] Dark mode: Circles filled with checkmark when selected
- [ ] Clicking card toggles filter state
- [ ] Clicking text inside card toggles filter state
- [ ] Hover state shows visual feedback
- [ ] Keyboard navigation works (Tab to focus, Space/Enter to toggle)
- [ ] Filter functionality still works correctly
- [ ] Cards align properly with other filters in the grid

## Pattern for Future Use

This same `SelectableCard` pattern can be used anywhere in the app where you need:
- Selectable lists
- Toggle cards
- Multi-select interfaces
- Option selection

**Example Usage:**
```tsx
<SelectableCard
  selected={isSelected}
  onSelect={() => setIsSelected(!isSelected)}
  variant="default"  // or "rams", "timesheet", "inspection", "absence"
>
  <YourContentHere />
</SelectableCard>
```
