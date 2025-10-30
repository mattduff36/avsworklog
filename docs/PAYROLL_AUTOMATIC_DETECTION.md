# Payroll Automatic Detection - Quick Reference

## 🤖 How It Works

The system **automatically** detects night shifts and bank holidays. Users fill out timesheets normally - no special buttons or checkboxes needed!

## Detection Rules

### 🌙 Night Shift Detection

**Criteria**: Shift over 9.5 hours that starts at or after 15:00

| Start Time | Finish Time | Total Hours | Night Shift? | Rate |
|------------|-------------|-------------|--------------|------|
| 15:00 | 01:00 | 10.0 | ✅ Yes | 2x |
| 16:00 | 03:30 | 11.5 | ✅ Yes | 2x |
| 14:00 | 01:00 | 11.0 | ❌ No (starts before 15:00) | Basic/1.5x |
| 15:00 | 23:30 | 8.5 | ❌ No (under 9.5 hours) | Basic/1.5x |
| 06:00 | 16:30 | 10.5 | ❌ No (starts before 15:00) | Basic/1.5x |

### 📅 Bank Holiday Detection

**Source**: **[GOV.UK Bank Holidays JSON API](https://www.gov.uk/bank-holidays.json)** 🎉

Automatically fetches and checks work date against official UK bank holidays in real-time!

**API Features**:
- ✅ Live data from government source
- ✅ No API key required (public endpoint)
- ✅ Always up-to-date automatically
- ✅ Includes substitute days
- ✅ 24-hour caching for performance

**Current & Future Coverage**:
All official UK bank holidays including:
- New Year's Day
- Good Friday
- Easter Monday
- Early May bank holiday
- Spring bank holiday
- Summer bank holiday
- Christmas Day
- Boxing Day (including substitutes)
- **Plus any special holidays** (e.g., Coronations, Royal events)

**No manual updates needed!** The system automatically fetches the latest data.

### 📊 Pay Rate Priority

1. **2x Rate** - Night shift OR Bank holiday (highest priority)
2. **1.5x Rate** - Weekend work (Saturday/Sunday)
3. **Basic Rate** - Monday-Friday regular hours

## Examples

### Example 1: Regular Week
```
Mon: 08:00-17:00 (9hrs)
Tue: 08:00-17:00 (9hrs)
Wed: 08:00-17:00 (9hrs)
Thu: 08:00-17:00 (9hrs)
Fri: 08:00-17:00 (9hrs)
```
**Result**: 45 basic hours

### Example 2: Weekend Work
```
Mon-Fri: 45 hours basic
Sat: 08:00-14:00 (6hrs)
```
**Result**: 45 basic + 6 at 1.5x

### Example 3: Night Shift (Auto-detected)
```
Mon-Thu: 36 hours basic
Fri: 16:00-03:00 (11hrs) ← Auto-flagged as night shift
```
**Result**: 36 basic + 11 at 2x

### Example 4: Christmas Work (Auto-detected)
```
Week of Christmas 2025
Wed 25 Dec: 08:00-17:00 (9hrs) ← Auto-flagged as bank holiday
```
**Result**: 36 basic + 9 at 2x

### Example 5: Saturday Night Shift
```
Sat: 15:00-02:00 (11hrs)
```
**Result**: 11 at 2x (night shift overrides weekend)

## For Employees

✅ **What you do**:
- Fill out timesheet as normal
- Enter start time, finish time
- System calculates hours
- Submit

🤖 **What system does automatically**:
- Detects if shift is over 9.5 hours starting after 15:00 → Night shift
- Checks if date is a bank holiday → Bank holiday pay
- Calculates weekend work → 1.5x rate
- Assigns correct pay rate

## For Managers

When reviewing payroll:

| Column | What It Means |
|--------|---------------|
| Basic Hours (Mon-Fri) | All Mon-Fri work at basic rate |
| Overtime 1.5x (Weekend) | Sat-Sun work (auto-detected) |
| Overtime 2x (Night/Bank Holiday) | Night shifts + bank holidays (auto-detected) |
| Total Hours | Sum of all categories |

✅ No manual checking needed - system does it all!

## Technical Details

### Night Shift Algorithm
```
IF (daily_total > 9.5 hours) AND (time_started >= 15:00)
  THEN night_shift = TRUE → Pay at 2x rate
```

### Bank Holiday Algorithm
```
IF (work_date IN uk_bank_holidays)
  THEN bank_holiday = TRUE → Pay at 2x rate
```

### Pay Rate Selection
```
IF (night_shift OR bank_holiday)
  → 2x rate
ELSE IF (saturday OR sunday)
  → 1.5x rate
ELSE
  → Basic rate
```

## Maintenance

✅ **Bank Holiday Data**: Automatically maintained via GOV.UK API!

**No maintenance required** - the system automatically:
- Fetches latest data from [https://www.gov.uk/bank-holidays.json](https://www.gov.uk/bank-holidays.json)
- Updates when government announces new holidays
- Includes special occasions automatically
- Caches for 24 hours for optimal performance

**Technical Details**:
- Utility: `lib/utils/bank-holidays.ts`
- Cache Duration: 24 hours
- Fallback: Graceful degradation if API unavailable
- Division: England & Wales (configurable for Scotland/NI)

## Questions?

**Q: What if I work 10 hours starting at 14:30?**  
A: Not a night shift (must start at 15:00 or later)

**Q: What if I work 9 hours starting at 16:00?**  
A: Not a night shift (must be over 9.5 hours)

**Q: What if I work Christmas Day on a Saturday?**  
A: Paid at 2x (bank holiday takes priority)

**Q: Can I override the automatic detection?**  
A: No - detection is automatic and consistent for all employees

**Q: What about Scotland/NI bank holidays?**  
A: System uses England & Wales by default. The API supports Scotland and Northern Ireland divisions - can be configured in `lib/utils/bank-holidays.ts` if needed.

**Q: What if the GOV.UK API is down?**  
A: The system caches data for 24 hours and fails gracefully. If unavailable, it continues to work (just won't detect bank holidays until API is back).

---

Last Updated: October 30, 2025  
Data Source: [GOV.UK Bank Holidays JSON API](https://www.gov.uk/bank-holidays.json)  
API Docs: [GOV.UK Developer Portal](https://www.gov.uk/bank-holidays)

