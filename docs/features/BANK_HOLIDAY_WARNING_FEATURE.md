# Bank Holiday Warning Feature

**Date**: October 30, 2025  
**Status**: ✅ Complete  
**Feature**: Automatic Bank Holiday Warning Modal

---

## 🎯 Overview

The timesheet form now **automatically warns users** when they attempt to enter work hours on a UK bank holiday. This helps prevent accidental entries since most employees don't work on bank holidays.

## ✨ How It Works

### Trigger Conditions

The warning modal appears when:
1. ✅ User starts entering data on a bank holiday
2. ✅ User types the **2nd character** in:
   - Start Time field
   - Finish Time field  
   - Job Number field
3. ✅ Day is not already marked as "Did Not Work"
4. ✅ Warning hasn't been shown for this day yet

### User Experience

```
User types: "0" → No warning (1 character allowed)
User types: "08" → 🔔 Modal appears!
```

**Modal Message**:
> **Monday, 25 December 2025** is a bank holiday.
> 
> Are you sure you worked on this day?
> 
> [No] [Yes]

### Button Actions

**"Yes" Button** ✅
- Closes modal
- Allows user to continue entering hours
- Warning won't show again for this day

**"No" Button** ❌
- Closes modal
- Clears any entered text (start time, finish time, job number)
- Automatically enables "Did Not Work" button
- Sets day as non-working day

## 🎨 Modal Design

**Visual Style**:
- Yellow/amber warning theme
- Alert circle icon in yellow
- Dark slate background
- Clear, readable text
- Two action buttons (No/Yes)

**Accessibility**:
- High contrast colors
- Clear button labels
- Keyboard navigable
- ESC key closes modal

## 📋 Implementation Details

### New State Variables

```typescript
// Bank holiday warning modal
const [showBankHolidayWarning, setShowBankHolidayWarning] = useState(false);
const [bankHolidayDayIndex, setBankHolidayDayIndex] = useState<number | null>(null);
const [bankHolidayDate, setBankHolidayDate] = useState<string>('');
const [bankHolidayFieldType, setBankHolidayFieldType] = useState<'time' | 'job'>('time');

// Track if warning shown per day
entries[x].bankHolidayWarningShown = false;
```

### Key Functions

#### `isDayBankHoliday(dayIndex)`
Checks if a specific day is a bank holiday by:
1. Calculating actual calendar date from day index
2. Formatting as YYYY-MM-DD
3. Checking against cached GOV.UK data

#### `getFormattedDate(dayIndex)`
Returns human-readable date string:
```
"Monday, 25 December 2025"
```

#### `checkAndShowBankHolidayWarning(dayIndex, value, fieldType)`
Determines if warning should be shown:
- Only triggers on 2nd character
- Checks if day is bank holiday
- Verifies warning hasn't been shown
- Shows modal if conditions met

#### `handleBankHolidayYes()`
User confirms they worked:
- Marks warning as shown
- Closes modal
- Allows continued entry

#### `handleBankHolidayNo()`
User didn't work on bank holiday:
- Clears all time entries
- Enables "Did Not Work" button
- Sets daily total to 0
- Marks warning as shown
- Closes modal

## 🧪 Testing

### Test Scenarios

**Scenario 1: Christmas Day Entry**
1. Create timesheet for week including 25 Dec 2025
2. Go to Christmas Day (Thursday)
3. Type "0" in Start Time → No warning
4. Type "8" (making "08") → ⚠️ Modal appears
5. Verify date shows: "Thursday, 25 December 2025"

**Scenario 2: User Clicks "Yes"**
1. Trigger warning on bank holiday
2. Click "Yes" button
3. ✅ Modal closes
4. ✅ Can continue entering hours
5. ✅ Warning doesn't show again on this day

**Scenario 3: User Clicks "No"**
1. Start typing time/job on bank holiday
2. Modal appears
3. Click "No" button
4. ✅ Entered text is cleared
5. ✅ "Did Not Work" button is enabled
6. ✅ Day marked as non-working
7. ✅ Modal doesn't show again

**Scenario 4: Multiple Fields**
1. Type in Start Time → Warning shows
2. Click "Yes"
3. Type in Job Number → No warning (already shown)
4. Type in Finish Time → No warning (already shown)

**Scenario 5: Non-Bank Holiday**
1. Enter hours on regular Monday
2. No warning appears
3. Entry works normally

### Test Bank Holidays (2025)

- ✅ 1 Jan - New Year's Day
- ✅ 18 Apr - Good Friday  
- ✅ 21 Apr - Easter Monday
- ✅ 5 May - Early May bank holiday
- ✅ 26 May - Spring bank holiday
- ✅ 25 Aug - Summer bank holiday
- ✅ 25 Dec - Christmas Day
- ✅ 26 Dec - Boxing Day

## 💡 User Benefits

**For Employees**:
- ✅ Prevents accidental entries on bank holidays
- ✅ Saves time correcting mistakes
- ✅ Quick "No" button to mark as non-working
- ✅ Clear, friendly warning message

**For Managers**:
- ✅ Reduces incorrect timesheet submissions
- ✅ Fewer timesheets to reject/correct
- ✅ More accurate payroll data
- ✅ Less time spent on corrections

**For Payroll**:
- ✅ More accurate records
- ✅ Proper bank holiday tracking
- ✅ Reduced errors in calculations
- ✅ Better compliance tracking

## 🔧 Configuration

### Disable Warning (if needed)

To disable the warning feature, comment out the check in `updateEntry`:

```typescript
// Comment these lines:
// if (value.length === 2) {
//   checkAndShowBankHolidayWarning(dayIndex, value, 'time');
// }
```

### Change Trigger Character Count

Currently triggers on 2nd character. To change:

```typescript
// In checkAndShowBankHolidayWarning:
if (value.length >= 2)  // Change 2 to desired number
```

### Customize Modal Message

Edit in the Dialog component:

```typescript
<DialogDescription>
  <span className="font-semibold text-yellow-400">{bankHolidayDate}</span> is a bank holiday.
  <br />
  <br />
  Your custom message here...
</DialogDescription>
```

## 📊 Tracking & Analytics

### Events to Track (if implementing analytics)

```javascript
// Warning shown
trackEvent('bank_holiday_warning_shown', {
  date: bankHolidayDate,
  dayIndex: bankHolidayDayIndex,
  fieldType: bankHolidayFieldType
});

// User clicked "Yes"
trackEvent('bank_holiday_warning_yes', {
  date: bankHolidayDate
});

// User clicked "No"
trackEvent('bank_holiday_warning_no', {
  date: bankHolidayDate
});
```

### Useful Metrics

- % of users who click "Yes" vs "No"
- Which bank holidays have most entries
- Time saved by auto-marking "Did Not Work"
- Reduction in rejected timesheets

## 🐛 Known Limitations

1. **One Warning Per Day**: Shows only once per day per session
2. **Paste Behavior**: Pasting full time won't trigger warning (only typing)
3. **Tab Navigation**: Tabbing to field won't trigger warning (typing required)
4. **Session Only**: Refreshing page resets warning state

## 🔮 Future Enhancements

Potential improvements:

1. **Visual Indicator**: 
   - Add badge/icon on bank holiday days
   - Color-code bank holiday rows
   - Show tooltip on hover

2. **Pre-fill Toggle**:
   - Auto-enable "Did Not Work" on bank holidays
   - Let user override if needed

3. **Persistence**:
   - Remember warning shown in localStorage
   - Persist across page refreshes

4. **Custom Message by Holiday**:
   - "Merry Christmas! Did you work today?"
   - "Happy New Year! Confirm work?"

5. **Bulk Action**:
   - "Mark all bank holidays as not worked"
   - Quick button to handle multiple at once

## 📝 Files Modified

1. `app/(dashboard)/timesheets/new/page.tsx`
   - Added bank holiday warning state
   - Added check functions
   - Added modal handlers
   - Added Dialog component
   - Updated entry state tracking

## ✅ Deployment Checklist

- [x] Feature implemented
- [x] Warning triggers correctly
- [x] Modal displays with correct date
- [x] "Yes" button works
- [x] "No" button clears and marks DNW
- [x] No linter errors
- [x] Documentation complete
- [ ] Test with real bank holiday dates
- [ ] User acceptance testing
- [ ] Deploy to production

---

**Feature Complete**: October 30, 2025  
**Tested**: Pending user testing  
**Data Source**: [GOV.UK Bank Holidays API](https://www.gov.uk/bank-holidays.json)

