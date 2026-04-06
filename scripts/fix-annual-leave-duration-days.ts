import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';
import { calculateDurationDaysForShiftPattern, STANDARD_WORK_SHIFT_PATTERN } from '@/lib/utils/work-shifts';
import type { WorkShiftPattern } from '@/types/work-shifts';

config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;
const ANNUAL_LEAVE_REASON = 'annual leave';
const UPDATE_STATUSES = ['pending', 'approved', 'processed'] as const;

interface AnnualLeaveRow {
  id: string;
  profile_id: string;
  date: string | Date;
  end_date: string | Date | null;
  is_half_day: boolean;
  half_day_session: 'AM' | 'PM' | null;
  duration_days: number | null;
  status: string;
  monday_am: boolean | null;
  monday_pm: boolean | null;
  tuesday_am: boolean | null;
  tuesday_pm: boolean | null;
  wednesday_am: boolean | null;
  wednesday_pm: boolean | null;
  thursday_am: boolean | null;
  thursday_pm: boolean | null;
  friday_am: boolean | null;
  friday_pm: boolean | null;
  saturday_am: boolean | null;
  saturday_pm: boolean | null;
  sunday_am: boolean | null;
  sunday_pm: boolean | null;
}

function getCurrentFinancialYearBounds(): { startIso: string; endIso: string } {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth(); // 0-based
  const day = today.getDate();
  const startYear = month < 3 || (month === 3 && day < 1) ? year - 1 : year;
  const start = new Date(startYear, 3, 1);
  const end = new Date(startYear + 1, 2, 31);
  const toIso = (value: Date) => {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  return { startIso: toIso(start), endIso: toIso(end) };
}

function toDateOnly(value: string | Date | null): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const iso = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    throw new Error(`Invalid date value: ${value}`);
  }
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function toIsoDate(value: string | Date | null): string | null {
  const date = toDateOnly(value);
  if (!date) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildPattern(row: AnnualLeaveRow): WorkShiftPattern {
  return {
    monday_am: row.monday_am ?? STANDARD_WORK_SHIFT_PATTERN.monday_am,
    monday_pm: row.monday_pm ?? STANDARD_WORK_SHIFT_PATTERN.monday_pm,
    tuesday_am: row.tuesday_am ?? STANDARD_WORK_SHIFT_PATTERN.tuesday_am,
    tuesday_pm: row.tuesday_pm ?? STANDARD_WORK_SHIFT_PATTERN.tuesday_pm,
    wednesday_am: row.wednesday_am ?? STANDARD_WORK_SHIFT_PATTERN.wednesday_am,
    wednesday_pm: row.wednesday_pm ?? STANDARD_WORK_SHIFT_PATTERN.wednesday_pm,
    thursday_am: row.thursday_am ?? STANDARD_WORK_SHIFT_PATTERN.thursday_am,
    thursday_pm: row.thursday_pm ?? STANDARD_WORK_SHIFT_PATTERN.thursday_pm,
    friday_am: row.friday_am ?? STANDARD_WORK_SHIFT_PATTERN.friday_am,
    friday_pm: row.friday_pm ?? STANDARD_WORK_SHIFT_PATTERN.friday_pm,
    saturday_am: row.saturday_am ?? STANDARD_WORK_SHIFT_PATTERN.saturday_am,
    saturday_pm: row.saturday_pm ?? STANDARD_WORK_SHIFT_PATTERN.saturday_pm,
    sunday_am: row.sunday_am ?? STANDARD_WORK_SHIFT_PATTERN.sunday_am,
    sunday_pm: row.sunday_pm ?? STANDARD_WORK_SHIFT_PATTERN.sunday_pm,
  };
}

function roundTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

async function main() {
  const applyChanges = process.argv.includes('--apply');
  const cancelZeroDay = process.argv.includes('--cancel-zero-day');
  const bypassClosedGuard = process.argv.includes('--bypass-closed-guard');
  const fromArg = process.argv.find((arg) => arg.startsWith('--from='))?.split('=')[1];
  const toArg = process.argv.find((arg) => arg.startsWith('--to='))?.split('=')[1];
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error('POSTGRES_URL_NON_POOLING or POSTGRES_URL not set in .env.local');
  }

  const url = new URL(connectionString);
  const client = new Client({
    host: url.hostname,
    port: Number(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: false },
  });

  const { startIso: defaultStartIso, endIso: defaultEndIso } = getCurrentFinancialYearBounds();
  const startIso = fromArg || defaultStartIso;
  const endIso = toArg || defaultEndIso;
  await client.connect();

  try {
    const { rows } = await client.query<AnnualLeaveRow>(
      `
      SELECT
        a.id,
        a.profile_id,
        a.date,
        a.end_date,
        a.is_half_day,
        a.half_day_session,
        a.duration_days,
        a.status,
        ews.monday_am,
        ews.monday_pm,
        ews.tuesday_am,
        ews.tuesday_pm,
        ews.wednesday_am,
        ews.wednesday_pm,
        ews.thursday_am,
        ews.thursday_pm,
        ews.friday_am,
        ews.friday_pm,
        ews.saturday_am,
        ews.saturday_pm,
        ews.sunday_am,
        ews.sunday_pm
      FROM absences a
      JOIN absence_reasons ar
        ON ar.id = a.reason_id
      LEFT JOIN employee_work_shifts ews
        ON ews.profile_id = a.profile_id
      WHERE lower(trim(ar.name)) = $1
        AND a.status = ANY($2::text[])
        AND a.date >= $3
        AND a.date <= $4
      ORDER BY a.date ASC, a.id ASC
      `,
      [ANNUAL_LEAVE_REASON, UPDATE_STATUSES, startIso, endIso]
    );

    const normalizedRows = rows.map((row) => {
        const nextDuration = roundTwo(
          calculateDurationDaysForShiftPattern(
            toDateOnly(row.date) as Date,
            toDateOnly(row.end_date),
            buildPattern(row),
            {
              isHalfDay: row.is_half_day,
              halfDaySession: row.half_day_session,
            }
          )
        );
        const currentDuration = roundTwo(row.duration_days || 0);
        return {
          id: row.id,
          profileId: row.profile_id,
          date: toIsoDate(row.date),
          endDate: toIsoDate(row.end_date),
          status: row.status,
          currentDuration,
          nextDuration,
        };
      });

    const updates = normalizedRows
      .filter((row) => row.currentDuration !== row.nextDuration);
    const overDeducting = normalizedRows.filter((row) => row.currentDuration > row.nextDuration);
    const zeroDayActive = normalizedRows.filter((row) => row.nextDuration === 0);

    console.log(`Financial year window: ${startIso} -> ${endIso}`);
    console.log(`Annual leave rows scanned: ${rows.length}`);
    console.log(`Rows needing duration_days correction: ${updates.length}`);
    console.log(`Rows currently over-deducting allowance: ${overDeducting.length}`);
    console.log(`Rows currently non-deductible (0 working-day allowance impact): ${zeroDayActive.length}`);

    if (updates.length > 0) {
      console.log('Sample corrections:');
      updates.slice(0, 20).forEach((row) => {
        console.log(
          ` - ${row.id} (${row.profileId}) ${row.date}${row.endDate ? `..${row.endDate}` : ''} ` +
            `[${row.status}] ${row.currentDuration} -> ${row.nextDuration}`
        );
      });
      if (updates.length > 20) {
        console.log(` ...and ${updates.length - 20} more`);
      }
    }

    if (zeroDayActive.length > 0) {
      const zeroDayByProfile = new Map<string, number>();
      zeroDayActive.forEach((row) => {
        zeroDayByProfile.set(row.profileId, (zeroDayByProfile.get(row.profileId) || 0) + 1);
      });
      const zeroDayProfileIds = Array.from(zeroDayByProfile.keys());
      const { rows: profileRows } = await client.query<{
        id: string;
        full_name: string | null;
        employee_id: string | null;
      }>(
        `
        SELECT id, full_name, employee_id
        FROM profiles
        WHERE id = ANY($1::uuid[])
        `,
        [zeroDayProfileIds]
      );
      const profileById = new Map(profileRows.map((row) => [row.id, row] as const));

      console.log('Affected users (distinct):');
      zeroDayProfileIds
        .sort((a, b) => {
          const nameA = profileById.get(a)?.full_name || '';
          const nameB = profileById.get(b)?.full_name || '';
          if (nameA && nameB) return nameA.localeCompare(nameB);
          if (nameA) return -1;
          if (nameB) return 1;
          return a.localeCompare(b);
        })
        .forEach((profileId) => {
          const profile = profileById.get(profileId);
          const bookingCount = zeroDayByProfile.get(profileId) || 0;
          console.log(
            ` - ${profile?.full_name || 'Unknown User'} (${profileId})` +
              `${profile?.employee_id ? ` [${profile.employee_id}]` : ''}` +
              ` -> ${bookingCount} booking(s)`
          );
        });

      console.log('Sample non-deductible annual-leave rows (0 day):');
      zeroDayActive.slice(0, 20).forEach((row) => {
        console.log(
          ` - ${row.id} (${row.profileId}) ${row.date}${row.endDate ? `..${row.endDate}` : ''} [${row.status}]`
        );
      });
      if (zeroDayActive.length > 20) {
        console.log(` ...and ${zeroDayActive.length - 20} more`);
      }
    }

    if (overDeducting.length > 0) {
      const overDeductingByProfile = new Map<string, number>();
      overDeducting.forEach((row) => {
        overDeductingByProfile.set(row.profileId, (overDeductingByProfile.get(row.profileId) || 0) + 1);
      });
      const overDeductingProfileIds = Array.from(overDeductingByProfile.keys());
      const { rows: profileRows } = await client.query<{
        id: string;
        full_name: string | null;
        employee_id: string | null;
      }>(
        `
        SELECT id, full_name, employee_id
        FROM profiles
        WHERE id = ANY($1::uuid[])
        `,
        [overDeductingProfileIds]
      );
      const profileById = new Map(profileRows.map((row) => [row.id, row] as const));

      console.log('Employees with over-deducting bookings:');
      overDeductingProfileIds
        .sort((a, b) => {
          const nameA = profileById.get(a)?.full_name || '';
          const nameB = profileById.get(b)?.full_name || '';
          if (nameA && nameB) return nameA.localeCompare(nameB);
          if (nameA) return -1;
          if (nameB) return 1;
          return a.localeCompare(b);
        })
        .forEach((profileId) => {
          const profile = profileById.get(profileId);
          const bookingCount = overDeductingByProfile.get(profileId) || 0;
          console.log(
            ` - ${profile?.full_name || 'Unknown User'} (${profileId})` +
              `${profile?.employee_id ? ` [${profile.employee_id}]` : ''}` +
              ` -> ${bookingCount} booking(s)`
          );
        });

      console.log('Sample over-deducting bookings (stored -> recalculated):');
      overDeducting.slice(0, 30).forEach((row) => {
        console.log(
          ` - ${row.id} (${row.profileId}) ${row.date}${row.endDate ? `..${row.endDate}` : ''} ` +
            `[${row.status}] ${row.currentDuration} -> ${row.nextDuration}`
        );
      });
      if (overDeducting.length > 30) {
        console.log(` ...and ${overDeducting.length - 30} more`);
      }
    }

    if (!applyChanges) {
      if (cancelZeroDay) {
        console.log('\nDry run only. Re-run with --apply --cancel-zero-day to cancel zero-day rows.');
      } else {
        console.log('\nDry run only. Re-run with --apply to write updates.');
      }
      return;
    }

    if (cancelZeroDay) {
      if (zeroDayActive.length === 0) {
        console.log('\nNo zero-day annual leave rows to cancel.');
        return;
      }

      await client.query('BEGIN');
      try {
        if (bypassClosedGuard) {
          // Temporary session-scoped bypass for closed-FY mutation guard.
          await client.query(`SET LOCAL app.absence_archive_move = 'on'`);
        }
        for (const row of zeroDayActive) {
          await client.query(
            `
            UPDATE absences
            SET
              status = 'cancelled',
              notes = CASE
                WHEN notes IS NULL OR btrim(notes) = ''
                  THEN '[Auto-cancelled] Annual leave on non-working day (0 duration)'
                WHEN notes ILIKE '%[Auto-cancelled] Annual leave on non-working day (0 duration)%'
                  THEN notes
                ELSE notes || E'\\n[Auto-cancelled] Annual leave on non-working day (0 duration)'
              END
            WHERE id = $1
            `,
            [row.id]
          );
        }
        await client.query('COMMIT');
        console.log(`\nCancelled ${zeroDayActive.length} zero-day annual leave rows.`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      return;
    }

    if (updates.length === 0) {
      console.log('\nNo updates required.');
      return;
    }

    await client.query('BEGIN');
    try {
      if (bypassClosedGuard) {
        // Temporary session-scoped bypass for closed-FY mutation guard.
        await client.query(`SET LOCAL app.absence_archive_move = 'on'`);
      }
      for (const row of updates) {
        await client.query('UPDATE absences SET duration_days = $1 WHERE id = $2', [row.nextDuration, row.id]);
      }
      await client.query('COMMIT');
      console.log(`\nApplied ${updates.length} duration_days updates.`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

