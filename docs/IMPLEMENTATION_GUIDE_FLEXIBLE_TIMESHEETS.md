# Implementation Guide: Flexible Timesheet System
**Quick Reference for Development**

---

## 🎯 Quick Start Decision Tree

**START HERE** →

### Question 1: Do you approve the database approach?
- **Option A (Recommended):** Simple `timesheet_type` TEXT column
- **Option B:** Separate `timesheet_types` table with foreign keys

**👉 I recommend Option A** - simpler, meets all requirements

---

### Question 2: Ready to start implementation?

**YES** → Proceed to Phase 1  
**NO** → Review PRD, ask questions

---

## 📋 Phase-by-Phase Checklist

### Phase 1: Foundation & Database ✅ START HERE
**Time:** 4 hours | **Risk:** LOW

```bash
# 1. Create migration file
touch supabase/migrations/20251217_add_timesheet_types.sql

# 2. Run migration (we'll do this together)
# 3. Verify in database
# 4. Create registry files
```

**Files to create:**
- `supabase/migrations/20251217_add_timesheet_types.sql`
- `app/(dashboard)/timesheets/types/registry.ts`

**Verification:**
- [ ] `roles.timesheet_type` column exists
- [ ] `timesheets.timesheet_type` column exists  
- [ ] All existing records default to 'civils'
- [ ] Existing timesheets still load

---

### Phase 2: Extract Current Timesheet
**Time:** 8 hours | **Risk:** MEDIUM

**Folder structure to create:**
```
app/(dashboard)/timesheets/
  ├── types/
  │   ├── civils/
  │   │   ├── CivilsTimesheet.tsx
  │   │   ├── CivilsValidation.ts
  │   │   └── CivilsPreview.tsx
  │   └── registry.ts
  ├── components/
  │   └── (shared components)
  └── hooks/
      └── useTimesheetType.ts
```

**Strategy:**
1. Copy `new/page.tsx` → `types/civils/CivilsTimesheet.tsx`
2. Extract validation logic → `CivilsValidation.ts`
3. Test everything still works
4. No functionality changes yet

---

### Phase 3: Week Selector
**Time:** 4 hours | **Risk:** LOW

**New component:**
- `components/timesheets/WeekSelector.tsx`

**Logic:**
1. User selects date
2. Check for duplicate
3. If exists → show error + link to edit
4. If not → proceed to form

---

### Phase 4: Confirmation Modal
**Time:** 6 hours | **Risk:** LOW

**New component:**
- `components/timesheets/ConfirmationModal.tsx`

**Shows:**
- Total hours
- Days worked
- Job numbers
- Special flags (bank holidays, night shifts)
- Warnings for anomalies

---

### Phase 5: Timesheet Router
**Time:** 4 hours | **Risk:** MEDIUM

**New components:**
- `components/timesheets/TimesheetRouter.tsx`
- `lib/hooks/useTimesheetType.ts`

**Flow:**
```
User → useTimesheetType(roleId) → 'civils' → CivilsTimesheet
                                → 'plant' → PlantTimesheet (future)
```

---

### Phase 6: Admin UI
**Time:** 4 hours | **Risk:** LOW

**Update:**
- `components/admin/RoleManagement.tsx`

**Add:**
- Dropdown: "Timesheet Type"
- Options: Civils (Default), Plant
- Save to `roles.timesheet_type`

---

### Phase 7: Testing
**Time:** 8 hours | **Risk:** LOW

**Test matrix:**
- Create timesheet (all roles)
- Edit timesheet
- Submit with confirmation
- Duplicate detection
- Admin configuration
- Manager for employee
- Offline mode

---

## 🗂️ File Organization

### New Files to Create

```
app/(dashboard)/timesheets/
├── types/
│   ├── civils/
│   │   ├── CivilsTimesheet.tsx      # Current timesheet logic
│   │   ├── CivilsValidation.ts      # Validation rules
│   │   └── CivilsPreview.tsx        # Confirmation modal
│   ├── plant/
│   │   ├── PlantTimesheet.tsx       # Future
│   │   ├── PlantValidation.ts       # Future
│   │   └── PlantPreview.tsx         # Future
│   └── registry.ts                  # Timesheet type registry
├── components/
│   ├── WeekSelector.tsx             # Date selection
│   ├── TimesheetRouter.tsx          # Routes to correct type
│   ├── ConfirmationModal.tsx        # Submission preview
│   └── DuplicateChecker.tsx         # Validation
└── hooks/
    └── useTimesheetType.ts          # Gets user's type

lib/services/
└── timesheet.service.ts             # Shared timesheet logic

supabase/migrations/
└── 20251217_add_timesheet_types.sql # Database migration
```

---

## 🔧 Code Patterns to Follow

### 1. Timesheet Component Interface

```typescript
interface TimesheetProps {
  weekEnding: string;
  existingId: string | null;
  userId?: string; // For managers creating for others
}

export function CivilsTimesheet({ weekEnding, existingId, userId }: TimesheetProps) {
  // Component logic
}
```

---

### 2. Validation Pattern

```typescript
// CivilsValidation.ts
export function validateCivilsTimesheet(entries: TimesheetEntry[]) {
  const errors: string[] = [];
  
  // Validation logic
  
  return {
    valid: errors.length === 0,
    errors,
  };
}
```

---

### 3. Registry Pattern

```typescript
// registry.ts
import { CivilsTimesheet } from './civils/CivilsTimesheet';
import { PlantTimesheet } from './plant/PlantTimesheet';

export const TimesheetRegistry: Record<string, React.ComponentType<TimesheetProps>> = {
  civils: CivilsTimesheet,
  plant: PlantTimesheet,
};

export const TimesheetTypes = [
  { value: 'civils', label: 'Civils Timesheet (Default)' },
  { value: 'plant', label: 'Plant Timesheet' },
] as const;
```

---

### 4. Router Pattern

```typescript
// TimesheetRouter.tsx
export function TimesheetRouter({ weekEnding, existingId }: TimesheetRouterProps) {
  const { profile } = useAuth();
  const { timesheetType, loading } = useTimesheetType(profile?.role_id);

  if (loading) return <LoadingSpinner />;

  const TimesheetComponent = TimesheetRegistry[timesheetType];

  if (!TimesheetComponent) {
    return <ErrorState message={`Timesheet type "${timesheetType}" not available`} />;
  }

  return <TimesheetComponent weekEnding={weekEnding} existingId={existingId} />;
}
```

---

## 🚨 Critical Rules

### DO ✅
- Add columns, don't modify existing
- Default to 'civils' for backward compatibility
- Keep existing timesheet working during refactor
- Test after each phase
- Use the notification service (`notify.ts`)
- Follow the audit's coding standards

### DON'T ❌
- Delete or rename existing columns
- Change behavior of existing timesheets
- Skip the migration
- Deploy without testing all phases
- Use `alert()` or `confirm()` (use `notify.confirm()`)
- Add `any` types

---

## 🧪 Testing Commands

```bash
# Lint check
npm run lint

# Type check
npm run type-check

# Run dev server
npm run dev

# Test migration (development)
# We'll do this together

# Build test
npm run build
```

---

## 📊 Progress Tracking

### Phase Completion Checklist

- [ ] **Phase 1:** Database migration complete, verified
- [ ] **Phase 2:** Civils timesheet extracted, working
- [ ] **Phase 3:** Week selector implemented, duplicate check working
- [ ] **Phase 4:** Confirmation modal complete, tested
- [ ] **Phase 5:** Router working, type detection correct
- [ ] **Phase 6:** Admin UI updated, saving correctly
- [ ] **Phase 7:** All tests passing, documentation updated

---

## 🐛 Common Issues & Solutions

### Issue 1: Migration Fails
**Problem:** Column already exists  
**Solution:** Add `IF NOT EXISTS` to migration

### Issue 2: Existing Timesheets Break
**Problem:** Can't load old timesheets  
**Solution:** Ensure default value is 'civils', check registry

### Issue 3: Router Shows Wrong Type
**Problem:** User sees wrong timesheet  
**Solution:** Check role's `timesheet_type`, verify hook logic

### Issue 4: Duplicate Check Fails
**Problem:** Allows duplicate timesheets  
**Solution:** Verify `UNIQUE(user_id, week_ending)` constraint

---

## 🎓 Adding a New Timesheet Type (Future)

**When you say:** "Here's the Plant timesheet"

**I will:**
1. Create `types/plant/PlantTimesheet.tsx`
2. Implement validation in `PlantValidation.ts`
3. Create `PlantPreview.tsx` for confirmation
4. Add 'plant' to registry
5. Update database constraint
6. Test end-to-end

**Time required:** 4-8 hours (depending on complexity)

---

## 📞 Decision Points

### Before Starting
- [ ] Approve database schema (Option A recommended)
- [ ] Approve phased approach (1-7, then 8)
- [ ] Review PRD and this guide
- [ ] Confirm all questions answered

### After Each Phase
- [ ] Does it work?
- [ ] Any breaking changes?
- [ ] Continue to next phase?

---

## 🚀 Ready to Start?

**Next Steps:**
1. **Review PRD** (you just read it)
2. **Ask any questions** (clarify doubts)
3. **Approve approach** (simple vs complex DB)
4. **Start Phase 1** (database migration)

**Estimated full completion:** 4-5 days

**Can pause after any phase** if needed.

---

**Questions to answer before starting:**
1. ✅ Approve Option A (simple columns) for database?
2. ✅ Start with Phase 1 (foundation)?
3. ❓ Any concerns or changes to approach?
4. ❓ When do you want Plant timesheet specifications?

---

*This guide will be updated as we progress through each phase.*
