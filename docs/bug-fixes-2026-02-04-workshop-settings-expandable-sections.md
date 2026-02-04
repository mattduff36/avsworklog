# Workshop Tasks Settings - Expandable Sections Enhancement

**Date:** 2026-02-04  
**Feature:** UI Standardization  
**Status:** ✅ Complete

## Summary

Made the "Category Management" and "Attachment Templates" sections on the `/workshop-tasks` Settings tab expandable/collapsible to match the design pattern used throughout the rest of the application (e.g., Maintenance Settings).

## Changes Made

### 1. CategoryManagementPanel Component
**File:** `components/workshop-tasks/CategoryManagementPanel.tsx`

#### Changes:
- Added `isExpanded` state to control expand/collapse behavior
- Wrapped `CardHeader` in clickable area with hover effect
- Added `ChevronDown` icon that rotates when expanded
- Made the header show category count and description
- Conditionally rendered `CardContent` based on `isExpanded` state
- Updated empty state to also use expandable pattern
- Standardized button styling and positioning

#### UI Pattern:
```tsx
<Card className="border-border">
  <CardHeader 
    className="cursor-pointer hover:bg-slate-800/30 transition-colors"
    onClick={() => setIsExpanded(!isExpanded)}
  >
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3 flex-1">
        <ChevronDown className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
        <div>
          <CardTitle>Category Management</CardTitle>
          <CardDescription>
            {count} categories • Description
          </CardDescription>
        </div>
      </div>
      <Button onClick={(e) => { e.stopPropagation(); ... }}>
        Add Category
      </Button>
    </div>
  </CardHeader>
  
  {isExpanded && (
    <CardContent className="pt-6">
      {/* Content here */}
    </CardContent>
  )}
</Card>
```

### 2. AttachmentManagementPanel Component
**File:** `components/workshop-tasks/AttachmentManagementPanel.tsx`

#### Changes:
- Added `isExpanded` state for expand/collapse control
- Applied same expandable pattern to header
- Updated loading state to use expandable card
- Updated empty state (no templates) to use expandable card
- Changed template count to use `filteredTemplates.length` instead of `templates.length` (respects taxonomy filtering)
- Added description showing template count and purpose
- Conditionally rendered `CardContent` based on expansion state

#### Taxonomy Filtering:
The panel already had taxonomy mode filtering (`taxonomyMode` prop), which filters templates by vehicle/plant. The expandable UI now shows the correct filtered count:
- When in Vehicle mode: shows only templates that apply to vehicles
- When in Plant mode: shows only templates that apply to plant machinery

## Benefits

### 1. **UI Consistency**
- Matches the expandable pattern used in Maintenance Settings and Fleet Settings
- Provides a familiar, predictable user experience across admin panels

### 2. **Improved Space Management**
- Settings page starts in a more compact state
- Users can expand only the sections they need to interact with
- Reduces visual clutter when managing multiple settings sections

### 3. **Better Mobile Experience**
- Collapsible sections work better on smaller screens
- Less scrolling required to navigate between sections

### 4. **Visual Hierarchy**
- Clear section headers with counts
- Chevron icon provides affordance for interaction
- Hover states indicate clickability

## Testing Checklist

- [x] Category Management section expands/collapses on click
- [x] Attachment Templates section expands/collapses on click
- [x] Buttons in header work without triggering expand/collapse (using `e.stopPropagation()`)
- [x] Chevron icon rotates correctly
- [x] Empty states display correctly when expanded
- [x] Loading states display correctly when expanded
- [x] Template count reflects taxonomy filtering (vehicle/plant)
- [x] No linter errors
- [x] Hover effects work on headers

## Files Modified

1. `components/workshop-tasks/CategoryManagementPanel.tsx` - Added expandable UI
2. `components/workshop-tasks/AttachmentManagementPanel.tsx` - Added expandable UI

## No Breaking Changes

- All existing functionality preserved
- Sections start collapsed by default (can be changed if needed)
- All props and callbacks remain the same
- No API changes required

## Future Considerations

1. **Persistence**: Could save expand/collapse state in localStorage if desired
2. **Default State**: Could make sections expanded by default on first visit
3. **Deep Linking**: Could add URL parameters to expand specific sections
4. **Accessibility**: Could add ARIA attributes for better screen reader support

## Screenshots

### Before
- Static, always-visible sections taking up full page height

### After
- Collapsible sections with clear headers
- Clean, compact initial state
- Matches design pattern from Maintenance Settings
