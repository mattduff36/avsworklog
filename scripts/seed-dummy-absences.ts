import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

if (!connectionString) {
  console.error('Missing database connection string');
  process.exit(1);
}

function isWeekday(d: Date): boolean {
  const day = d.getDay();
  return day !== 0 && day !== 6;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function fmt(d: Date): string {
  return d.toISOString().split('T')[0];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getNextWeekday(d: Date): Date {
  let cur = new Date(d);
  while (!isWeekday(cur)) cur = addDays(cur, 1);
  return cur;
}

function countWeekdays(start: Date, end: Date): number {
  let count = 0;
  let cur = new Date(start);
  while (cur <= end) {
    if (isWeekday(cur)) count++;
    cur = addDays(cur, 1);
  }
  return count;
}

// UK bank holidays in the 2025/2026 FY (April 6 2025 – April 5 2026)
const BANK_HOLIDAYS_2025_26 = [
  '2025-04-18', // Good Friday
  '2025-04-21', // Easter Monday
  '2025-05-05', // Early May bank holiday
  '2025-05-26', // Spring bank holiday
  '2025-08-25', // Summer bank holiday
  '2025-12-25', // Christmas Day
  '2025-12-26', // Boxing Day
  '2026-01-01', // New Year's Day
];

type AbsenceRow = {
  date: string;
  end_date: string | null;
  reason_id: string;
  duration: number;
  is_half_day: boolean;
  half_day_session: string | null;
  status: string;
  approved_at: string | null;
  notes: string;
};

async function seed() {
  const url = new URL(connectionString!);
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('Connecting to database...');
    await client.connect();
    console.log('Connected.\n');

    // Clean up old seed data
    const { rows: oldCount } = await client.query(
      `SELECT COUNT(*) as cnt FROM absences WHERE notes LIKE '%[SEED]%'`
    );
    if (parseInt(oldCount[0].cnt) > 0) {
      console.log(`Deleting ${oldCount[0].cnt} old seed records...`);
      await client.query(`DELETE FROM absences WHERE notes LIKE '%[SEED]%'`);
      console.log('Done.\n');
    }

    const { rows: profiles } = await client.query<{ id: string; full_name: string; annual_holiday_allowance_days: number | null }>(
      `SELECT id, full_name, annual_holiday_allowance_days FROM profiles ORDER BY full_name`
    );
    console.log(`Found ${profiles.length} profiles`);

    const { rows: reasons } = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM absence_reasons WHERE is_active = true ORDER BY name`
    );
    console.log(`Found ${reasons.length} active absence reasons`);

    const annualReason = reasons.find(r => r.name.trim().toLowerCase() === 'annual leave');
    const sicknessReason = reasons.find(r => r.name.trim().toLowerCase() === 'sickness');
    const trainingReason = reasons.find(r => r.name.trim().toLowerCase() === 'training');
    const unpaidReason = reasons.find(r => r.name.trim().toLowerCase() === 'unpaid leave');
    const bereavementReason = reasons.find(r => r.name.trim().toLowerCase() === 'bereavement');
    const medicalReason = reasons.find(r => r.name.trim().toLowerCase() === 'medical appointment');
    const compassionateReason = reasons.find(r => r.name.trim().toLowerCase() === 'compassionate leave');

    if (!annualReason) {
      console.error('Annual leave reason not found!');
      process.exit(1);
    }

    const adminResult = await client.query<{ id: string }>(
      `SELECT id FROM profiles WHERE role = 'admin' LIMIT 1`
    );
    const adminId = adminResult.rows[0]?.id || profiles[0].id;

    const fyStart = new Date(2025, 3, 6);  // April 6 2025
    const today = new Date(2026, 2, 11);   // March 11 2026

    let totalInserted = 0;

    for (const profile of profiles) {
      const allowance = profile.annual_holiday_allowance_days ?? 28;
      const absences: AbsenceRow[] = [];
      const usedDates = new Set<string>();

      function dateAvailable(d: Date): boolean {
        return isWeekday(d) && !usedDates.has(fmt(d));
      }

      function markDates(start: Date, end: Date | null) {
        let cur = new Date(start);
        const endD = end || start;
        while (cur <= endD) {
          if (isWeekday(cur)) usedDates.add(fmt(cur));
          cur = addDays(cur, 1);
        }
      }

      // 1) BANK HOLIDAYS — everyone books these as annual leave
      for (const bhStr of BANK_HOLIDAYS_2025_26) {
        const bhDate = new Date(bhStr + 'T00:00:00');
        if (bhDate > today) continue;
        if (!isWeekday(bhDate)) continue;
        usedDates.add(bhStr);
        absences.push({
          date: bhStr,
          end_date: null,
          reason_id: annualReason.id,
          duration: 1,
          is_half_day: false,
          half_day_session: null,
          status: 'approved',
          approved_at: addDays(bhDate, -30).toISOString(),
          notes: '[SEED] Bank holiday',
        });
      }

      const bankHolDays = absences.length;
      const personalAllowance = allowance - bankHolDays;

      // Target: most people near end of FY have used 85-100% of remaining allowance
      // Some are at 70-85% (a few days left)
      const usagePercent = Math.random() < 0.3
        ? (70 + Math.random() * 15) / 100   // 30% of people: 70-85% used
        : (85 + Math.random() * 15) / 100;  // 70% of people: 85-100% used
      let targetPersonalDays = Math.round(personalAllowance * usagePercent * 2) / 2; // round to nearest 0.5
      if (targetPersonalDays > personalAllowance) targetPersonalDays = personalAllowance;

      let annualDaysBooked = 0;

      // 2) SUMMER HOLIDAY — most people take a week or two in summer (June-Sept)
      if (targetPersonalDays >= 5) {
        const summerBlockSize = Math.random() < 0.4 ? randomInt(5, 10) : randomInt(5, 7);
        const summerStart = randomInt(80, 170); // ~late June to ~late Sept offset from FY start
        let start = addDays(fyStart, summerStart);
        start = getNextWeekday(start);

        if (start <= today && dateAvailable(start)) {
          let end = new Date(start);
          const daysToBook = Math.min(summerBlockSize, targetPersonalDays - annualDaysBooked);
          let weekdaysBooked = 0;
          while (weekdaysBooked < daysToBook) {
            if (isWeekday(end) && !usedDates.has(fmt(end))) {
              weekdaysBooked++;
            }
            if (weekdaysBooked < daysToBook) end = addDays(end, 1);
          }
          if (end > today) end = new Date(today);
          const duration = countWeekdays(start, end);
          if (duration > 0) {
            markDates(start, end);
            annualDaysBooked += duration;
            absences.push({
              date: fmt(start),
              end_date: fmt(end),
              reason_id: annualReason.id,
              duration,
              is_half_day: false,
              half_day_session: null,
              status: 'approved',
              approved_at: addDays(start, -randomInt(14, 60)).toISOString(),
              notes: '[SEED] Summer holiday',
            });
          }
        }
      }

      // 3) CHRISTMAS BREAK — most take 3-5 days around Christmas (using non-BH days)
      if (targetPersonalDays - annualDaysBooked >= 2) {
        const xmasDays = randomInt(2, 5);
        const daysToBook = Math.min(xmasDays, targetPersonalDays - annualDaysBooked);
        // Book days around 22-24 Dec and 29-31 Dec
        const xmasCandidates = [
          '2025-12-22', '2025-12-23', '2025-12-24',
          '2025-12-29', '2025-12-30', '2025-12-31',
        ].filter(d => {
          const dd = new Date(d + 'T00:00:00');
          return isWeekday(dd) && dd <= today && !usedDates.has(d);
        });

        let xmasBooked = 0;
        for (const d of xmasCandidates) {
          if (xmasBooked >= daysToBook) break;
          usedDates.add(d);
          xmasBooked++;
          annualDaysBooked++;
          absences.push({
            date: d,
            end_date: null,
            reason_id: annualReason.id,
            duration: 1,
            is_half_day: false,
            half_day_session: null,
            status: 'approved',
            approved_at: new Date('2025-11-15').toISOString(),
            notes: '[SEED] Christmas break',
          });
        }
      }

      // 4) SCATTERED DAYS throughout the year — long weekends, odd days off, half-days
      let attempts = 0;
      while (annualDaysBooked < targetPersonalDays && attempts < 100) {
        attempts++;
        const remaining = targetPersonalDays - annualDaysBooked;
        if (remaining <= 0) break;

        const daysOffset = randomInt(0, 330);
        let start = addDays(fyStart, daysOffset);
        start = getNextWeekday(start);
        if (start > today || !dateAvailable(start)) continue;

        const roll = Math.random();
        let duration: number;
        let end_date: Date | null = null;
        let is_half_day = false;
        let half_day_session: string | null = null;

        if (remaining === 0.5 || (remaining <= 1 && roll < 0.3)) {
          // Half day
          is_half_day = true;
          half_day_session = Math.random() < 0.5 ? 'AM' : 'PM';
          duration = 0.5;
          markDates(start, start);
        } else if (remaining < 3 || roll < 0.35) {
          // Single day (Friday/Monday long weekend)
          duration = 1;
          markDates(start, start);
        } else if (roll < 0.7) {
          // 2-3 day block
          const blockLen = Math.min(randomInt(2, 3), remaining);
          end_date = new Date(start);
          let booked = 1;
          while (booked < blockLen) {
            end_date = addDays(end_date, 1);
            if (end_date > today) break;
            if (isWeekday(end_date) && !usedDates.has(fmt(end_date))) booked++;
          }
          if (end_date > today) end_date = new Date(today);
          duration = countWeekdays(start, end_date);
          if (duration <= 0) continue;
          markDates(start, end_date);
        } else {
          // 4-5 day block (week off)
          const blockLen = Math.min(randomInt(4, 5), remaining);
          end_date = new Date(start);
          let booked = 1;
          while (booked < blockLen) {
            end_date = addDays(end_date, 1);
            if (end_date > today) break;
            if (isWeekday(end_date) && !usedDates.has(fmt(end_date))) booked++;
          }
          if (end_date > today) end_date = new Date(today);
          duration = countWeekdays(start, end_date);
          if (duration <= 0) continue;
          markDates(start, end_date);
        }

        if (annualDaysBooked + duration > targetPersonalDays) continue;
        annualDaysBooked += duration;

        absences.push({
          date: fmt(start),
          end_date: end_date ? fmt(end_date) : null,
          reason_id: annualReason.id,
          duration,
          is_half_day,
          half_day_session,
          status: 'approved',
          approved_at: addDays(start, -randomInt(3, 30)).toISOString(),
          notes: '[SEED] Annual leave',
        });
      }

      // 5) SICKNESS — ~40% have 1-2 episodes, ~15% have 3+
      if (sicknessReason) {
        const sickRoll = Math.random();
        const numSick = sickRoll < 0.45 ? 0 : sickRoll < 0.75 ? randomInt(1, 2) : randomInt(2, 4);
        for (let i = 0; i < numSick; i++) {
          const daysOffset = randomInt(0, 320);
          let start = addDays(fyStart, daysOffset);
          start = getNextWeekday(start);
          if (start > today || !dateAvailable(start)) continue;

          const sickLen = Math.random() < 0.55 ? 1 : randomInt(2, 5);
          let end_date: Date | null = null;
          let duration = sickLen;

          if (sickLen > 1) {
            end_date = new Date(start);
            for (let d = 1; d < sickLen; d++) end_date = addDays(end_date, 1);
            while (!isWeekday(end_date)) end_date = addDays(end_date, -1);
            if (end_date > today) end_date = new Date(today);
            duration = countWeekdays(start, end_date);
            if (duration <= 0) continue;
            markDates(start, end_date);
          } else {
            markDates(start, start);
          }

          absences.push({
            date: fmt(start),
            end_date: end_date ? fmt(end_date) : null,
            reason_id: sicknessReason.id,
            duration,
            is_half_day: false,
            half_day_session: null,
            status: 'approved',
            approved_at: addDays(start, 1).toISOString(),
            notes: '[SEED] Sickness absence',
          });
        }
      }

      // 6) TRAINING — ~25% have 1-2 days
      if (trainingReason && Math.random() < 0.25) {
        const numTraining = randomInt(1, 2);
        for (let i = 0; i < numTraining; i++) {
          const daysOffset = randomInt(30, 300);
          let start = addDays(fyStart, daysOffset);
          start = getNextWeekday(start);
          if (start > today || !dateAvailable(start)) continue;
          markDates(start, start);
          absences.push({
            date: fmt(start),
            end_date: null,
            reason_id: trainingReason.id,
            duration: 1,
            is_half_day: false,
            half_day_session: null,
            status: 'approved',
            approved_at: addDays(start, -14).toISOString(),
            notes: '[SEED] Training day',
          });
        }
      }

      // 7) MEDICAL APPOINTMENT — ~30% have a half-day
      if (medicalReason && Math.random() < 0.3) {
        const daysOffset = randomInt(0, 320);
        let start = addDays(fyStart, daysOffset);
        start = getNextWeekday(start);
        if (start <= today && dateAvailable(start)) {
          markDates(start, start);
          absences.push({
            date: fmt(start),
            end_date: null,
            reason_id: medicalReason.id,
            duration: 0.5,
            is_half_day: true,
            half_day_session: Math.random() < 0.5 ? 'AM' : 'PM',
            status: 'approved',
            approved_at: addDays(start, -5).toISOString(),
            notes: '[SEED] Medical appointment',
          });
        }
      }

      // 8) UNPAID LEAVE — ~8%
      if (unpaidReason && Math.random() < 0.08) {
        const daysOffset = randomInt(30, 300);
        let start = addDays(fyStart, daysOffset);
        start = getNextWeekday(start);
        if (start <= today && dateAvailable(start)) {
          markDates(start, start);
          absences.push({
            date: fmt(start),
            end_date: null,
            reason_id: unpaidReason.id,
            duration: 1,
            is_half_day: false,
            half_day_session: null,
            status: 'approved',
            approved_at: addDays(start, -3).toISOString(),
            notes: '[SEED] Unpaid leave',
          });
        }
      }

      // 9) BEREAVEMENT — ~5%
      if (bereavementReason && Math.random() < 0.05) {
        const daysOffset = randomInt(30, 300);
        let start = addDays(fyStart, daysOffset);
        start = getNextWeekday(start);
        if (start <= today && dateAvailable(start)) {
          const end_date = addDays(start, randomInt(2, 4));
          const duration = countWeekdays(start, end_date);
          markDates(start, end_date);
          absences.push({
            date: fmt(start),
            end_date: fmt(end_date),
            reason_id: bereavementReason.id,
            duration,
            is_half_day: false,
            half_day_session: null,
            status: 'approved',
            approved_at: start.toISOString(),
            notes: '[SEED] Bereavement leave',
          });
        }
      }

      // 10) COMPASSIONATE LEAVE — ~3%
      if (compassionateReason && Math.random() < 0.03) {
        const daysOffset = randomInt(30, 300);
        let start = addDays(fyStart, daysOffset);
        start = getNextWeekday(start);
        if (start <= today && dateAvailable(start)) {
          markDates(start, start);
          absences.push({
            date: fmt(start),
            end_date: null,
            reason_id: compassionateReason.id,
            duration: 1,
            is_half_day: false,
            half_day_session: null,
            status: 'approved',
            approved_at: start.toISOString(),
            notes: '[SEED] Compassionate leave',
          });
        }
      }

      totalInserted += absences.length;

      // Batch insert all absences for this profile
      if (absences.length > 0) {
        const values: string[] = [];
        const params: unknown[] = [];
        let pIdx = 1;
        for (const a of absences) {
          values.push(
            `($${pIdx}, $${pIdx + 1}, $${pIdx + 2}, $${pIdx + 3}, $${pIdx + 4}, $${pIdx + 5}, $${pIdx + 6}, $${pIdx + 7}, $${pIdx + 8}, $${pIdx + 9}, $${pIdx + 10})`
          );
          params.push(
            profile.id, a.date, a.end_date, a.reason_id, a.duration,
            a.is_half_day, a.half_day_session, a.status, adminId,
            a.approved_at, a.notes
          );
          pIdx += 11;
        }

        await client.query(
          `INSERT INTO absences (profile_id, date, end_date, reason_id, duration_days, is_half_day, half_day_session, status, approved_by, approved_at, notes)
           VALUES ${values.join(', ')}`,
          params
        );
      }

      const totalAnnual = bankHolDays + annualDaysBooked;
      const remaining = allowance - totalAnnual;
      console.log(`  ${profile.full_name}: ${totalAnnual} annual (${bankHolDays} BH + ${annualDaysBooked} personal), ${remaining} remaining, ${absences.length - bankHolDays - Math.round(annualDaysBooked)} other`);
    }

    console.log(`\nDone! Inserted ${totalInserted} absence records for ${profiles.length} employees.`);
    console.log('All seed records are tagged with [SEED] in notes for easy cleanup.');

  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

seed();
