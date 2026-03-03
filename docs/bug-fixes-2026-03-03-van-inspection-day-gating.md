# Bug Fix - March 3, 2026: Van Inspection Day Gating

## Issue

Users reported they could not submit van inspections without completing **all 7 days** of the weekly checklist, including Saturday and Sunday — even when they were not working those days. This forced users to either fabricate entries for non-working days or be unable to submit inspections at all.

**Reporter:** David Moores  
**Date:** 2026-03-03  
**Page:** `/van-inspections/new`

## Root Cause

The `validateAndSubmit` function in `app/(dashboard)/van-inspections/new/page.tsx` iterated over all 7 days × all checklist items and blocked submission if any single item was missing a status:

```typescript
for (let dayOfWeek = 1; dayOfWeek <= 7; dayOfWeek += 1) {
  for (let itemNumber = 1; itemNumber <= currentChecklist.length; itemNumber += 1) {
    const key = `${dayOfWeek}-${itemNumber}`;
    if (!checkboxStates[key]) return key; // blocked here
  }
}
```

This meant a user who only worked Monday–Friday could never submit because Saturday and Sunday had no entries.

## Fix

Replaced the all-or-nothing validation with a flexible per-day approach:

1. **At least 1 day** must be fully completed to submit.
2. **Started days** (≥1 item checked) must be fully completed — prevents accidental partial submissions.
3. **Empty days** (0 items checked) are skipped entirely — users are not required to fill in days they did not work.

The progress indicator was also updated to calculate totals based on started days rather than all 7.

## Files Changed

- `app/(dashboard)/van-inspections/new/page.tsx` — validation logic and progress calculation

## Testing

- Submit with 0 days completed → blocked with "Please complete at least one day"
- Submit with 1+ fully completed days and empty remaining days → allowed
- Submit with a partially completed day → blocked with message naming the incomplete day
- Submit with all 7 days completed → allowed (unchanged behaviour)
