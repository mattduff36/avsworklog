/**
 * Restore Steven O'Conner's leave state to a 0/0 contractor onboarding.
 *
 * Usage:
 *   npx tsx scripts/correct-steven-oconnor-contractor-leave.ts
 *   npx tsx scripts/correct-steven-oconnor-contractor-leave.ts --apply --confirm-apply steven-oconnor-leave-zero
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const TARGET_PROJECT_REF = 'lrhufzqfzeutgvudcowy';
const TARGET_PROFILE_ID = 'bb466183-e144-4fc0-b145-2ce83e5d4198';
const TARGET_EMAIL = 'stevenvtx@icloud.com';
const CONFIRM_APPLY_TOKEN = 'steven-oconnor-leave-zero';
const EXPECTED_HOLIDAY_DATES = ['2026-12-25', '2026-12-28', '2027-01-01', '2027-03-26', '2027-03-29'] as const;

const connectionString = process.env.POSTGRES_URL_NON_POOLING;

interface LockedProfile {
  id: string;
  full_name: string;
  email: string | null;
  role_name: string | null;
  role_display_name: string | null;
  annual_holiday_allowance_days: string | null;
}

interface CarryoverRow {
  id: string;
  financial_year_start_year: number;
  carried_days: string;
  generation_source: string | null;
}

interface AbsenceRow {
  id: string;
  date: string;
  status: string;
  duration_days: string;
  is_bank_holiday: boolean;
  auto_generated: boolean;
  generation_source: string | null;
  holiday_key: string | null;
}

function hasApplyFlag(args: string[]): boolean {
  return args.includes('--apply');
}

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function createClient(): pg.Client {
  if (!connectionString) {
    throw new Error('Missing POSTGRES_URL_NON_POOLING');
  }
  const url = new URL(connectionString);
  if (!connectionString.includes(TARGET_PROJECT_REF) && !url.hostname.includes('localhost')) {
    throw new Error('Refusing to continue: connection does not include expected project ref');
  }
  return new Client({
    host: url.hostname,
    port: Number.parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ssl: { rejectUnauthorized: false },
  });
}

function assertSafeTarget(profile: LockedProfile, absences: AbsenceRow[], otherAbsenceCount: number, archiveCount: number): void {
  if (profile.id !== TARGET_PROFILE_ID) {
    throw new Error('Locked profile id does not match the approved target.');
  }
  if ((profile.email || '').toLowerCase() !== TARGET_EMAIL) {
    throw new Error(`Locked profile email is ${profile.email || 'missing'}, expected ${TARGET_EMAIL}.`);
  }
  const roleName = (profile.role_name || '').trim().toLowerCase();
  const roleDisplayName = (profile.role_display_name || '').trim().toLowerCase();
  if (roleName !== 'contractor' && roleDisplayName !== 'contractor') {
    throw new Error(`Locked profile role is ${profile.role_name || 'missing'}, expected contractor.`);
  }
  if (otherAbsenceCount !== 0) {
    throw new Error(`Refusing to continue: ${otherAbsenceCount} unexpected active absences exist.`);
  }
  if (archiveCount !== 0) {
    throw new Error(`Refusing to continue: ${archiveCount} archived absences exist.`);
  }
  if (absences.length !== EXPECTED_HOLIDAY_DATES.length) {
    throw new Error(`Expected ${EXPECTED_HOLIDAY_DATES.length} generated bank holidays, found ${absences.length}.`);
  }

  const actualDates = absences.map((row) => row.date).sort();
  const expectedDates = [...EXPECTED_HOLIDAY_DATES].sort();
  if (actualDates.join(',') !== expectedDates.join(',')) {
    throw new Error(`Bank holiday dates do not match the approved snapshot: ${actualDates.join(', ')}`);
  }

  for (const absence of absences) {
    if (!absence.is_bank_holiday || !absence.auto_generated) {
      throw new Error(`Absence ${absence.id} is not a generated bank holiday.`);
    }
    if (Number(absence.duration_days) !== 1) {
      throw new Error(`Absence ${absence.id} duration is ${absence.duration_days}, expected 1.`);
    }
  }
}

async function loadSnapshot(client: pg.Client): Promise<{
  profile: LockedProfile;
  carryovers: CarryoverRow[];
  absences: AbsenceRow[];
  otherAbsenceCount: number;
  archiveCount: number;
  snapshotCount: number;
  confirmationCount: number;
}> {
  const { rows: profiles } = await client.query<LockedProfile>(
    `
    SELECT
      p.id,
      p.full_name,
      u.email,
      r.name AS role_name,
      r.display_name AS role_display_name,
      p.annual_holiday_allowance_days::TEXT
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.id
    LEFT JOIN public.roles r ON r.id = p.role_id
    WHERE p.id = $1
    FOR UPDATE OF p
    `,
    [TARGET_PROFILE_ID]
  );
  const profile = profiles[0];
  if (!profile) {
    throw new Error('Target profile was not found.');
  }

  const { rows: carryovers } = await client.query<CarryoverRow>(
    `
    SELECT
      id,
      financial_year_start_year,
      carried_days::TEXT,
      generation_source
    FROM public.absence_allowance_carryovers
    WHERE profile_id = $1
    FOR UPDATE
    `,
    [TARGET_PROFILE_ID]
  );

  const { rows: absences } = await client.query<AbsenceRow>(
    `
    SELECT
      id,
      date::TEXT,
      status,
      duration_days::TEXT,
      is_bank_holiday,
      auto_generated,
      generation_source,
      holiday_key
    FROM public.absences
    WHERE profile_id = $1
      AND is_bank_holiday = TRUE
      AND auto_generated = TRUE
      AND date = ANY($2::DATE[])
    ORDER BY date ASC
    FOR UPDATE
    `,
    [TARGET_PROFILE_ID, [...EXPECTED_HOLIDAY_DATES]]
  );

  const { rows: otherRows } = await client.query<{ count: string }>(
    `
    SELECT COUNT(*)::TEXT AS count
    FROM public.absences
    WHERE profile_id = $1
      AND id <> ALL($2::UUID[])
    `,
    [TARGET_PROFILE_ID, absences.map((row) => row.id)]
  );

  const { rows: archiveRows } = await client.query<{ count: string }>(
    `
    SELECT COUNT(*)::TEXT AS count
    FROM public.absences_archive
    WHERE profile_id = $1
    `,
    [TARGET_PROFILE_ID]
  );

  const absenceIds = absences.map((row) => row.id);
  const { rows: snapshotRows } = await client.query<{ count: string }>(
    `
    SELECT COUNT(*)::TEXT AS count
    FROM public.timesheet_entry_leave_snapshots
    WHERE absence_id = ANY($1::UUID[])
    `,
    [absenceIds]
  );
  const { rows: confirmationRows } = await client.query<{ count: string }>(
    `
    SELECT COUNT(*)::TEXT AS count
    FROM public.timesheet_bank_holiday_work_confirmations
    WHERE absence_id = ANY($1::UUID[])
    `,
    [absenceIds]
  );

  return {
    profile,
    carryovers,
    absences,
    otherAbsenceCount: Number(otherRows[0]?.count || 0),
    archiveCount: Number(archiveRows[0]?.count || 0),
    snapshotCount: Number(snapshotRows[0]?.count || 0),
    confirmationCount: Number(confirmationRows[0]?.count || 0),
  };
}

async function applyCorrection(client: pg.Client, absenceIds: string[]): Promise<void> {
  await client.query(
    `
    UPDATE public.profiles
    SET
      annual_holiday_allowance_days = 0,
      updated_at = NOW()
    WHERE id = $1
    `,
    [TARGET_PROFILE_ID]
  );

  await client.query(
    `
    UPDATE public.absence_allowance_carryovers
    SET
      carried_days = 0,
      updated_at = NOW()
    WHERE profile_id = $1
      AND financial_year_start_year = 2026
      AND generation_source = 'admin-user-onboarding-adjustment'
    `,
    [TARGET_PROFILE_ID]
  );

  await client.query(`SELECT set_config('app.absence_historic_delete_bypass', 'on', true)`);
  await client.query(
    `
    DELETE FROM public.absences
    WHERE profile_id = $1
      AND id = ANY($2::UUID[])
      AND is_bank_holiday = TRUE
      AND auto_generated = TRUE
    `,
    [TARGET_PROFILE_ID, absenceIds]
  );
}

async function verifyPostconditions(client: pg.Client): Promise<Record<string, unknown>> {
  const { rows } = await client.query<{
    base_allowance: string;
    carryover: string;
    effective_allowance: string;
    absence_count: string;
    generated_bank_holiday_count: string;
    remaining: string;
  }>(
    `
    WITH target AS (
      SELECT p.id, p.annual_holiday_allowance_days::NUMERIC AS base_allowance
      FROM public.profiles p
      WHERE p.id = $1
    ),
    carryover AS (
      SELECT COALESCE(SUM(c.carried_days), 0)::NUMERIC AS carried_days
      FROM public.absence_allowance_carryovers c
      WHERE c.profile_id = $1
        AND c.financial_year_start_year = 2026
    ),
    used AS (
      SELECT
        COALESCE(SUM(a.duration_days) FILTER (
          WHERE a.status IN ('approved', 'processed', 'pending')
        ), 0)::NUMERIC AS booked_days,
        COUNT(*)::INTEGER AS absence_count,
        COUNT(*) FILTER (
          WHERE a.is_bank_holiday = TRUE AND a.auto_generated = TRUE
        )::INTEGER AS generated_bank_holiday_count
      FROM public.absences a
      WHERE a.profile_id = $1
    )
    SELECT
      t.base_allowance::TEXT,
      c.carried_days::TEXT AS carryover,
      (t.base_allowance + c.carried_days)::TEXT AS effective_allowance,
      u.absence_count::TEXT,
      u.generated_bank_holiday_count::TEXT,
      (t.base_allowance + c.carried_days - u.booked_days)::TEXT AS remaining
    FROM target t
    CROSS JOIN carryover c
    CROSS JOIN used u
    `,
    [TARGET_PROFILE_ID]
  );

  const result = rows[0];
  if (!result) {
    throw new Error('Postcondition query returned no rows.');
  }
  if (Number(result.base_allowance) !== 0) {
    throw new Error(`Postcondition failed: base allowance is ${result.base_allowance}`);
  }
  if (Number(result.carryover) !== 0) {
    throw new Error(`Postcondition failed: carryover is ${result.carryover}`);
  }
  if (Number(result.effective_allowance) !== 0) {
    throw new Error(`Postcondition failed: effective allowance is ${result.effective_allowance}`);
  }
  if (Number(result.absence_count) !== 0) {
    throw new Error(`Postcondition failed: ${result.absence_count} absences remain`);
  }
  if (Number(result.generated_bank_holiday_count) !== 0) {
    throw new Error(`Postcondition failed: generated bank holidays remain`);
  }
  if (Number(result.remaining) !== 0) {
    throw new Error(`Postcondition failed: remaining leave is ${result.remaining}`);
  }
  return result;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = hasApplyFlag(args);
  const confirmApply = readFlag(args, '--confirm-apply');
  if (apply && confirmApply !== CONFIRM_APPLY_TOKEN) {
    throw new Error(`Apply requires --confirm-apply ${CONFIRM_APPLY_TOKEN}`);
  }

  const client = createClient();
  await client.connect();
  try {
    await client.query('BEGIN');
    const snapshot = await loadSnapshot(client);
    assertSafeTarget(snapshot.profile, snapshot.absences, snapshot.otherAbsenceCount, snapshot.archiveCount);
    if (snapshot.snapshotCount !== 0 || snapshot.confirmationCount !== 0) {
      throw new Error('Refusing to continue: timesheet leave snapshots or bank-holiday confirmations exist.');
    }

    console.log(JSON.stringify({
      mode: apply ? 'apply' : 'dry-run',
      profile: snapshot.profile,
      carryovers: snapshot.carryovers,
      absences: snapshot.absences,
      otherAbsenceCount: snapshot.otherAbsenceCount,
      archiveCount: snapshot.archiveCount,
      snapshotCount: snapshot.snapshotCount,
      confirmationCount: snapshot.confirmationCount,
    }, null, 2));

    if (!apply) {
      await client.query('ROLLBACK');
      console.log(JSON.stringify({
        dryRun: true,
        applyCommand: 'npx tsx scripts/correct-steven-oconnor-contractor-leave.ts --apply --confirm-apply steven-oconnor-leave-zero',
      }));
      return;
    }

    await applyCorrection(client, snapshot.absences.map((row) => row.id));
    const after = await verifyPostconditions(client);
    await client.query('COMMIT');
    console.log(JSON.stringify({ applied: true, after }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
