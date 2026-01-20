# UI Contrast Audit System

## Overview
Comprehensive automated system to detect and fix dark-on-dark text issues in form inputs, dropdowns, and dialogs.

## Problem Solved
Dark text was appearing on dark backgrounds in:
- Input fields
- Textarea fields
- Select dropdown triggers
- Select dropdown menus (the options list)
- Dialog content

This made forms unreadable in dark mode.

## Solution
### 1. Base Component Fixes
All base UI components now have guaranteed readable text:

**Input** (`components/ui/input.tsx`)
- Added `ui-component` class (opts out of global CSS overrides)
- Added `text-slate-900 dark:text-slate-100`

**Textarea** (`components/ui/textarea.tsx`)
- Added `ui-component` class
- Added `text-slate-900 dark:text-slate-100`

**SelectTrigger** (`components/ui/select.tsx`)
- Added `ui-component` class
- Added `text-slate-900 dark:text-slate-100`

**SelectContent** (`components/ui/select.tsx`)
- Added `ui-component` class
- Added `text-slate-100` (light text for dark dropdown background)

**SelectItem** (`components/ui/select.tsx`)
- Added `text-slate-100` + `focus:text-white`
- CheckIcon has `text-slate-100`

**SelectLabel** (`components/ui/select.tsx`)
- Added `text-slate-400` (muted but readable)

**DialogContent** (`components/ui/dialog.tsx`)
- Added `text-slate-900 dark:text-slate-100`
- DialogTitle: `text-slate-900 dark:text-slate-100`
- DialogDescription: `text-slate-600 dark:text-slate-400`

### 2. Automated Audit Tools

#### Static Analysis (`npm run audit:contrast`)
Scans all TSX files for contrast issues.

**Checks for:**
- Dark backgrounds without explicit text colors
- Missing text color declarations
- Components that may inherit problematic colors

**Output:**
- Console report with severity levels (HIGH/MEDIUM/LOW)
- JSON report at `reports/ui-contrast-audit.json`
- Exit code 1 if high-severity issues found (CI-ready)

**Components checked:**
- Input
- Textarea
- SelectTrigger
- SelectContent
- SelectItem
- SelectLabel
- DialogContent

#### Auto-Fix Script (`npm run fix:contrast`)
Automatically fixes safe cases using AST transformations.

**What it fixes:**
- Appends `dark:text-slate-100` to elements with dark backgrounds
- Appends `text-slate-900` to ensure light mode contrast
- Only modifies string literal classNames (safe)

**Output:**
- Console summary of all changes
- Before/after comparison for each fix
- JSON report at `reports/ui-contrast-fixes.json`

#### Runtime Tests (`npm run test:contrast`)
Playwright tests that validate computed colors in the browser.

**Features:**
- WCAG contrast ratio calculations
- Tests actual rendered colors (not just classes)
- Covers key forms: Workshop Task, RAMS, Timesheet, Inspection

**Requirements:**
- Dev server must be running (`npm run dev`)
- Tests run in dark mode

## Usage

### Regular Checks
```bash
# Quick audit
npm run audit:contrast

# Auto-fix safe issues
npm run fix:contrast

# Runtime validation (dev server must be running)
npm run test:contrast
```

### CI/CD Integration
```bash
# Add to CI pipeline
npm run audit:contrast || exit 1
```

The audit script exits with code 1 if high-severity issues are found, making it CI-ready.

## Results

### Initial State (Before Fixes)
- 40 issues across the codebase
- 31 high severity, 9 medium severity

### After Base Component Fixes
- 19 issues remaining
- 52% reduction
- All remaining issues are DialogContent with custom backgrounds (safe - inherit base defaults)

### Pages Fixed
- ✅ Workshop Task modal (inputs, selects, textarea, dropdown menus)
- ✅ Absence management (allowances, reasons, requests)
- ✅ Admin FAQ editor
- ✅ Suggestions management
- ✅ Timesheet editor
- ✅ Help page (search & feedback)
- ✅ Fleet vehicle dialogs
- ✅ Debug page
- ✅ RAMS modals (upload, assign)
- ✅ Messages & toolbox talks
- ✅ Inspection forms
- ✅ Maintenance dialogs

### Fixes Applied
- 71 auto-fixes in initial pass
- 9 auto-fixes for dropdown menus
- Total: 80+ fixes across 30+ files

## Prevention

### For Developers
When creating new forms or inputs:

1. **Use base components as-is** - they have proper defaults
2. **Avoid overriding text colors** unless necessary
3. **If you must override**, ensure both light and dark modes:
   ```tsx
   <Input className="text-slate-900 dark:text-slate-100" />
   ```

### Audit on Changes
Run the audit after making UI changes:
```bash
npm run audit:contrast
```

If issues are found:
```bash
npm run fix:contrast  # Fix safe cases automatically
# Review and manually fix remaining issues
```

## Technical Details

### The `ui-component` Class
This special class in `app/globals.css` opts components out of aggressive global color rules:

```css
.bg-primary *:not(.ui-component):not(.ui-component *) {
  color: rgb(15 23 42) !important;
}
```

By adding `ui-component` to our base form components, they manage their own colors instead of inheriting from parent containers.

### Safe Path Validation
The auto-fix script only modifies:
- String literal classNames (safe to parse)
- Components in the COMPONENTS_TO_FIX list
- Cases where the fix is deterministic

It will NOT modify:
- Template literals with variables
- Computed classNames
- Components already using `ui-component`

### WCAG Standards
The runtime tests check for:
- Minimum contrast ratio: 4.5:1 (WCAG AA for normal text)
- Preferred ratio: 7:1 (WCAG AAA)

## Files Changed

### Core Components
- `components/ui/input.tsx`
- `components/ui/textarea.tsx`
- `components/ui/select.tsx`
- `components/ui/dialog.tsx`

### Audit Tools
- `scripts/audit-input-contrast.ts` - Static analysis
- `scripts/fix-input-contrast.ts` - Auto-fix
- `tests/ui/contrast.spec.ts` - Runtime tests
- `playwright.config.ts` - Playwright config

### Reports
- `reports/ui-contrast-audit.json` - Latest audit results
- `reports/ui-contrast-fixes.json` - Latest fixes applied

## Future Improvements

1. **Add more components**: Button, Badge, Card, etc.
2. **Expand runtime tests**: Cover more pages/forms
3. **Add visual regression**: Screenshot comparison
4. **CI integration**: Block PRs with contrast issues
5. **Accessibility audit**: Extend to other WCAG criteria

## Support

If you encounter contrast issues:
1. Run `npm run audit:contrast` to identify the issue
2. Try `npm run fix:contrast` to auto-fix
3. Manually fix if needed using the audit report
4. Test in dark mode to verify
5. Commit the fix

The audit system is designed to prevent these issues from reoccurring!
