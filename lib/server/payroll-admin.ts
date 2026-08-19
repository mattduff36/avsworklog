import pg from 'pg';
import { createAdminClient } from '@/lib/supabase/admin';
import { validatePayrollRule } from '@/lib/payroll/schema';
import type {
  PayrollDayBand,
  PayrollRuleConfiguration,
  PayrollRuleSetKey,
  PayrollTreatment,
} from '@/lib/payroll/types';
import type {
  PayrollAdminMatrix,
  PayrollProfileAssignmentInput,
  PayrollProfileOption,
  PayrollRuleSetAdminRecord,
  PayrollTeamAssignmentInput,
  PayrollTeamOption,
} from '@/types/payroll-admin';
import { filterSystemAccounts, filterSystemTeams } from '@/lib/utils/system-accounts';

const { Client } = pg;

interface DynamicQuery {
  select(columns: string): DynamicQuery;
  eq(column: string, value: unknown): DynamicQuery;
  in(column: string, values: unknown[]): DynamicQuery;
  order(column: string, options?: { ascending?: boolean; foreignTable?: string }): DynamicQuery;
  limit(count: number): DynamicQuery;
  maybeSingle(): Promise<{ data: unknown; error: { message: string } | null }>;
  insert(values: unknown): DynamicQuery;
  update(values: unknown): DynamicQuery;
  delete(): DynamicQuery;
  then<TResult1 = { data: unknown; error: { message: string } | null }>(
    onfulfilled?: ((value: { data: unknown; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null
  ): Promise<TResult1>;
}

interface DynamicAdminClient {
  from(table: string): DynamicQuery;
}

interface RuleSetRow {
  id: string;
  rule_key: PayrollRuleSetKey;
  name: string;
  status: 'draft' | 'active' | 'archived';
}

interface VersionRow {
  id: string;
  rule_set_id: string;
  version_number: number;
  status: 'draft' | 'active' | 'archived';
  effective_week_ending: string | null;
  break_threshold_minutes: number;
  break_deduction_minutes: number;
  bank_holiday_treatment: PayrollTreatment;
  night_shift_treatment: PayrollTreatment | null;
  operator_travel_enabled: boolean;
  ipr_units_per_worked_day: number | string;
  ipr_weekly_cap: number | string;
}

interface BandRow {
  rule_version_id: string;
  day_of_week: number;
  treatment: PayrollTreatment;
  up_to_minutes: number | null;
  remainder_treatment: PayrollTreatment | null;
}

function dynamicAdmin(): DynamicAdminClient {
  return createAdminClient() as unknown as DynamicAdminClient;
}

function createPayrollAdminPgClient() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!connectionString) throw new Error('Missing database connection string');
  const url = new URL(connectionString);
  return new Client({
    host: url.hostname,
    port: Number.parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: false },
  });
}

function throwIfError(error: { message: string } | null, fallback: string): void {
  if (error) throw new Error(error.message || fallback);
}

function buildConfiguration(
  ruleSet: RuleSetRow,
  version: VersionRow,
  bands: BandRow[]
): PayrollRuleConfiguration {
  const dayBands: Record<number, PayrollDayBand> = {};
  bands
    .filter((band) => band.rule_version_id === version.id)
    .forEach((band) => {
      dayBands[band.day_of_week] = {
        treatment: band.treatment,
        upToMinutes: band.up_to_minutes ?? undefined,
        remainderTreatment: band.remainder_treatment ?? undefined,
      };
    });
  return {
    key: ruleSet.rule_key,
    name: ruleSet.name,
    breakThresholdMinutes: version.break_threshold_minutes,
    breakDeductionMinutes: version.break_deduction_minutes,
    bankHolidayTreatment: version.bank_holiday_treatment,
    nightShiftTreatment: version.night_shift_treatment,
    dayBands,
    operatorTravelEnabled: version.operator_travel_enabled,
    iprUnitsPerWorkedDay: Number(version.ipr_units_per_worked_day),
    iprWeeklyCap: Number(version.ipr_weekly_cap),
  };
}

export async function loadPayrollAdminMatrix(): Promise<PayrollAdminMatrix> {
  const admin = dynamicAdmin();
  const [
    ruleSetsResult,
    versionsResult,
    bandsResult,
    teamsResult,
    profilesResult,
    teamAssignmentsResult,
    profileAssignmentsResult,
    rolloutResult,
  ] = await Promise.all([
    admin.from('payroll_rule_sets').select('*').order('name'),
    admin.from('payroll_rule_versions').select('*').order('version_number', { ascending: false }),
    admin.from('payroll_rule_day_bands').select('*').order('day_of_week'),
    admin.from('org_teams').select('id, name, is_system').eq('active', true).order('name'),
    admin.from('profiles').select('id, full_name, employee_id, team_id, is_system_account').eq('is_placeholder', false).eq('is_system_account', false).order('full_name'),
    admin.from('payroll_team_rule_assignments').select('team_id, rule_set_id, effective_week_ending'),
    admin
      .from('payroll_profile_rule_assignments')
      .select('profile_id, rule_set_id, is_active, effective_week_ending')
      .order('effective_week_ending', { ascending: false }),
    admin.from('payroll_rollout_activations').select('effective_week_ending').order('effective_week_ending', { ascending: false }).limit(1),
  ]);
  [
    ruleSetsResult,
    versionsResult,
    bandsResult,
    teamsResult,
    profilesResult,
    teamAssignmentsResult,
    profileAssignmentsResult,
    rolloutResult,
  ].forEach((result) => throwIfError(result.error, 'Failed to load payroll settings'));

  const ruleSets = (ruleSetsResult.data || []) as RuleSetRow[];
  const versions = (versionsResult.data || []) as VersionRow[];
  const bands = (bandsResult.data || []) as BandRow[];
  const rules: PayrollRuleSetAdminRecord[] = ruleSets.map((ruleSet) => ({
    id: ruleSet.id,
    rule_key: ruleSet.rule_key,
    name: ruleSet.name,
    status: ruleSet.status,
    versions: versions
      .filter((version) => version.rule_set_id === ruleSet.id)
      .map((version) => ({
        id: version.id,
        version_number: version.version_number,
        status: version.status,
        effective_week_ending: version.effective_week_ending,
        configuration: buildConfiguration(ruleSet, version, bands),
      })),
  }));
  const ruleKeyById = new Map(ruleSets.map((ruleSet) => [ruleSet.id, ruleSet.rule_key]));
  const rolloutRows = (rolloutResult.data || []) as Array<{ effective_week_ending: string }>;
  const rolloutWeekEnding = rolloutRows[0]?.effective_week_ending || null;

  let impactedUnapprovedTimesheets = 0;
  if (rolloutWeekEnding) {
    const result = await createAdminClient()
      .from('timesheets')
      .select('id', { count: 'exact', head: true })
      .gte('week_ending', rolloutWeekEnding)
      .in('status', ['draft', 'submitted', 'rejected', 'adjusted']);
    if (result.error) throw new Error(result.error.message);
    impactedUnapprovedTimesheets = result.count || 0;
  }

  const latestProfileAssignments = new Map<string, {
    profile_id: string;
    rule_set_id: string | null;
    is_active: boolean;
    effective_week_ending: string;
  }>();
  for (const assignment of (profileAssignmentsResult.data || []) as Array<{
    profile_id: string;
    rule_set_id: string | null;
    is_active: boolean;
    effective_week_ending: string;
  }>) {
    if (!latestProfileAssignments.has(assignment.profile_id)) {
      latestProfileAssignments.set(assignment.profile_id, assignment);
    }
  }

  return {
    rules,
    teams: filterSystemTeams(((teamsResult.data || []) as Array<PayrollTeamOption & { is_system?: boolean | null }>)),
    profiles: filterSystemAccounts(((profilesResult.data || []) as Array<PayrollProfileOption & { is_system_account?: boolean | null }>)),
    teamAssignments: ((teamAssignmentsResult.data || []) as Array<{
      team_id: string;
      rule_set_id: string;
      effective_week_ending: string;
    }>).map((assignment) => ({
      teamId: assignment.team_id,
      ruleSetKey: ruleKeyById.get(assignment.rule_set_id) || 'civils',
      effectiveWeekEnding: assignment.effective_week_ending,
    })),
    profileAssignments: Array.from(latestProfileAssignments.values())
      .filter((assignment) => assignment.is_active && assignment.rule_set_id)
      .map((assignment) => ({
        profileId: assignment.profile_id,
        ruleSetKey: ruleKeyById.get(assignment.rule_set_id as string) || 'civils',
        effectiveWeekEnding: assignment.effective_week_ending,
      })),
    rolloutWeekEnding,
    impactedUnapprovedTimesheets,
  };
}

export async function savePayrollRuleDraft(
  configuration: PayrollRuleConfiguration,
  actorId: string
): Promise<void> {
  const validationErrors = validatePayrollRule(configuration);
  if (validationErrors.length > 0) throw new Error(validationErrors.join(' '));
  const client = createPayrollAdminPgClient();
  await client.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    const ruleSetResult = await client.query<{ id: string }>(
      `
        SELECT id
        FROM public.payroll_rule_sets
        WHERE rule_key = $1
        FOR UPDATE
      `,
      [configuration.key]
    );
    const ruleSet = ruleSetResult.rows[0];
    if (!ruleSet) throw new Error('Payroll rule set not found');

    const versionsResult = await client.query<{
      id: string;
      version_number: number;
      status: string;
    }>(
      `
        SELECT id, version_number, status
        FROM public.payroll_rule_versions
        WHERE rule_set_id = $1
        ORDER BY version_number DESC
        FOR UPDATE
      `,
      [ruleSet.id]
    );
    const existingDraft = versionsResult.rows.find((version) => version.status === 'draft');
    let versionId = existingDraft?.id;
    const values = [
      configuration.breakThresholdMinutes,
      configuration.breakDeductionMinutes,
      configuration.bankHolidayTreatment,
      configuration.nightShiftTreatment,
      configuration.operatorTravelEnabled,
      configuration.iprUnitsPerWorkedDay,
      configuration.iprWeeklyCap,
      actorId,
    ];

    if (versionId) {
      await client.query(
        `
          UPDATE public.payroll_rule_versions
          SET
            break_threshold_minutes = $1,
            break_deduction_minutes = $2,
            bank_holiday_treatment = $3,
            night_shift_treatment = $4,
            operator_travel_enabled = $5,
            ipr_units_per_worked_day = $6,
            ipr_weekly_cap = $7,
            updated_by = $8
          WHERE id = $9
            AND status = 'draft'
        `,
        [...values, versionId]
      );
      await client.query(
        `DELETE FROM public.payroll_rule_day_bands WHERE rule_version_id = $1`,
        [versionId]
      );
    } else {
      const inserted = await client.query<{ id: string }>(
        `
          INSERT INTO public.payroll_rule_versions (
            rule_set_id,
            version_number,
            status,
            break_threshold_minutes,
            break_deduction_minutes,
            bank_holiday_treatment,
            night_shift_treatment,
            operator_travel_enabled,
            ipr_units_per_worked_day,
            ipr_weekly_cap,
            created_by,
            updated_by
          )
          VALUES (
            $1, $2, 'draft', $3, $4, $5, $6, $7, $8, $9, $10, $10
          )
          RETURNING id
        `,
        [
          ruleSet.id,
          (versionsResult.rows[0]?.version_number || 0) + 1,
          ...values.slice(0, 7),
          actorId,
        ]
      );
      versionId = inserted.rows[0]?.id;
    }
    if (!versionId) throw new Error('Payroll draft version was not created');

    for (const [day, band] of Object.entries(configuration.dayBands)) {
      await client.query(
        `
          INSERT INTO public.payroll_rule_day_bands (
            rule_version_id,
            day_of_week,
            treatment,
            up_to_minutes,
            remainder_treatment
          )
          VALUES ($1, $2, $3, $4, $5)
        `,
        [
          versionId,
          Number(day),
          band.treatment,
          band.upToMinutes ?? null,
          band.remainderTreatment ?? null,
        ]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

function isSundayIso(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && new Date(`${date}T00:00:00Z`).getUTCDay() === 0;
}

export async function activatePayrollRollout(input: {
  effectiveWeekEnding: string;
  actorId: string;
  teamAssignments: PayrollTeamAssignmentInput[];
  profileAssignments: PayrollProfileAssignmentInput[];
}): Promise<void> {
  if (!isSundayIso(input.effectiveWeekEnding)) {
    throw new Error('Effective week ending must be a Sunday.');
  }
  if (new Set(input.teamAssignments.map((item) => item.teamId)).size !== input.teamAssignments.length) {
    throw new Error('Each team can have only one payroll assignment per activation.');
  }
  if (new Set(input.profileAssignments.map((item) => item.profileId)).size !== input.profileAssignments.length) {
    throw new Error('Each profile can have only one payroll override per activation.');
  }

  const client = createPayrollAdminPgClient();
  await client.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    const rolloutResult = await client.query<{ effective_week_ending: string }>(
      `
        SELECT effective_week_ending::text
        FROM public.payroll_rollout_activations
        ORDER BY effective_week_ending DESC
        LIMIT 1
        FOR UPDATE
      `
    );
    const latestRollout = rolloutResult.rows[0]?.effective_week_ending;
    if (latestRollout && input.effectiveWeekEnding <= latestRollout) {
      throw new Error(`New payroll versions must start after the current rollout week (${latestRollout}).`);
    }

    const teamsResult = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM public.org_teams WHERE active = true ORDER BY name`
    );
    const activeTeamById = new Map(teamsResult.rows.map((team) => [team.id, team]));
    for (const assignment of input.teamAssignments) {
      if (!activeTeamById.has(assignment.teamId)) {
        throw new Error('Every payroll team assignment must reference an active team.');
      }
    }
    const assignmentByTeamId = new Map(
      input.teamAssignments.map((assignment) => [assignment.teamId, assignment.ruleSetKey])
    );
    const requiredTeamRules: Array<{ label: string; name: string; ruleSetKey: PayrollRuleSetKey }> = [
      { label: 'Transport', name: 'transport', ruleSetKey: 'lorries' },
      { label: 'Civils', name: 'civils', ruleSetKey: 'civils' },
      { label: 'Plant', name: 'plant', ruleSetKey: 'plant' },
    ];
    for (const required of requiredTeamRules) {
      const team = teamsResult.rows.find((candidate) => {
        const normalized = candidate.name.trim().toLowerCase();
        return normalized === required.name || normalized === `${required.name} team`;
      });
      if (!team) throw new Error(`${required.label} team was not found in the active team directory.`);
      if (assignmentByTeamId.get(team.id) !== required.ruleSetKey) {
        throw new Error(`${required.label} team must be assigned to the ${required.ruleSetKey} payroll rule.`);
      }
    }

    const profileIds = input.profileAssignments.map((assignment) => assignment.profileId);
    if (profileIds.length > 0) {
      const profilesResult = await client.query<{ id: string }>(
        `
          SELECT id
          FROM public.profiles
          WHERE id = ANY($1::uuid[])
            AND COALESCE(is_placeholder, false) = false
        `,
        [profileIds]
      );
      if (profilesResult.rows.length !== profileIds.length) {
        throw new Error('Every payroll profile override must reference an active employee profile.');
      }
    }

    const unsafeHistory = await client.query<{ count: string }>(
      `
        SELECT COUNT(*)::text AS count
        FROM public.timesheets
        WHERE week_ending >= $1::date
          AND status IN ('approved', 'processed', 'adjusted')
          AND current_payroll_snapshot_id IS NULL
      `,
      [input.effectiveWeekEnding]
    );
    if (Number(unsafeHistory.rows[0]?.count || 0) > 0) {
      throw new Error(
        'The selected rollout week includes already approved timesheets without payroll snapshots. Choose a later Sunday.'
      );
    }

    const { rows: drafts } = await client.query<{
      id: string;
      rule_set_id: string;
      rule_key: PayrollRuleSetKey;
      rule_name: string;
      version_number: number;
      break_threshold_minutes: number;
      break_deduction_minutes: number;
      bank_holiday_treatment: PayrollTreatment;
      night_shift_treatment: PayrollTreatment | null;
      operator_travel_enabled: boolean;
      ipr_units_per_worked_day: string | number;
      ipr_weekly_cap: string | number;
      band_count: string;
    }>(`
      SELECT
        version.id,
        version.rule_set_id,
        rule_set.rule_key,
        rule_set.name AS rule_name,
        version.version_number,
        version.break_threshold_minutes,
        version.break_deduction_minutes,
        version.bank_holiday_treatment,
        version.night_shift_treatment,
        version.operator_travel_enabled,
        version.ipr_units_per_worked_day,
        version.ipr_weekly_cap,
        band_count.count::text AS band_count
      FROM public.payroll_rule_sets rule_set
      JOIN LATERAL (
        SELECT candidate.*
        FROM public.payroll_rule_versions candidate
        WHERE candidate.rule_set_id = rule_set.id
          AND candidate.status = 'draft'
        ORDER BY candidate.version_number DESC
        LIMIT 1
      ) version ON true
      JOIN LATERAL (
        SELECT COUNT(*) AS count
        FROM public.payroll_rule_day_bands band
        WHERE band.rule_version_id = version.id
      ) band_count ON true
    `);
    if (drafts.length !== 4 || drafts.some((draft) => Number(draft.band_count) !== 7)) {
      throw new Error('All four payroll rules require complete seven-day draft versions.');
    }
    const draftBandsResult = await client.query<BandRow>(
      `
        SELECT rule_version_id, day_of_week, treatment, up_to_minutes, remainder_treatment
        FROM public.payroll_rule_day_bands
        WHERE rule_version_id = ANY($1::uuid[])
        ORDER BY rule_version_id, day_of_week
      `,
      [drafts.map((draft) => draft.id)]
    );
    for (const draft of drafts) {
      const configuration = buildConfiguration(
        {
          id: draft.rule_set_id,
          rule_key: draft.rule_key,
          name: draft.rule_name,
          status: 'draft',
        },
        {
          id: draft.id,
          rule_set_id: draft.rule_set_id,
          version_number: draft.version_number,
          status: 'draft',
          effective_week_ending: null,
          break_threshold_minutes: draft.break_threshold_minutes,
          break_deduction_minutes: draft.break_deduction_minutes,
          bank_holiday_treatment: draft.bank_holiday_treatment,
          night_shift_treatment: draft.night_shift_treatment,
          operator_travel_enabled: draft.operator_travel_enabled,
          ipr_units_per_worked_day: draft.ipr_units_per_worked_day,
          ipr_weekly_cap: draft.ipr_weekly_cap,
        },
        draftBandsResult.rows
      );
      const errors = validatePayrollRule(configuration);
      if (errors.length > 0) {
        throw new Error(`${draft.rule_name} draft is invalid: ${errors.join(' ')}`);
      }
    }
    const ruleSetByKey = new Map(drafts.map((draft) => [draft.rule_key, draft.rule_set_id]));

    for (const draft of drafts) {
      await client.query(
        `
          UPDATE public.payroll_rule_versions
          SET status = 'archived', updated_by = $2
          WHERE rule_set_id = $1
            AND status = 'active'
        `,
        [draft.rule_set_id, input.actorId]
      );
      await client.query(
        `
          UPDATE public.payroll_rule_versions
          SET
            status = 'active',
            effective_week_ending = $2,
            activated_at = NOW(),
            activated_by = $3,
            updated_by = $3
          WHERE id = $1
        `,
        [draft.id, input.effectiveWeekEnding, input.actorId]
      );
      await client.query(
        `UPDATE public.payroll_rule_sets SET status = 'active', updated_by = $2 WHERE id = $1`,
        [draft.rule_set_id, input.actorId]
      );
    }

    for (const assignment of input.teamAssignments) {
      await client.query(
        `
          INSERT INTO public.payroll_team_rule_assignments (
            team_id, rule_set_id, effective_week_ending, created_by
          )
          VALUES ($1, $2, $3, $4)
        `,
        [
          assignment.teamId,
          ruleSetByKey.get(assignment.ruleSetKey),
          input.effectiveWeekEnding,
          input.actorId,
        ]
      );
    }
    for (const assignment of input.profileAssignments) {
      await client.query(
        `
          INSERT INTO public.payroll_profile_rule_assignments (
            profile_id, rule_set_id, is_active, effective_week_ending, created_by
          )
          VALUES ($1, $2, true, $3, $4)
        `,
        [
          assignment.profileId,
          ruleSetByKey.get(assignment.ruleSetKey),
          input.effectiveWeekEnding,
          input.actorId,
        ]
      );
    }
    const currentOverrides = await client.query<{ profile_id: string; is_active: boolean }>(
      `
        SELECT DISTINCT ON (profile_id)
          profile_id::text,
          is_active
        FROM public.payroll_profile_rule_assignments
        WHERE effective_week_ending < $1::date
        ORDER BY profile_id, effective_week_ending DESC
      `,
      [input.effectiveWeekEnding]
    );
    const selectedProfileIds = new Set(profileIds);
    for (const previous of currentOverrides.rows) {
      if (!previous.is_active || selectedProfileIds.has(previous.profile_id)) continue;
      await client.query(
        `
          INSERT INTO public.payroll_profile_rule_assignments (
            profile_id, rule_set_id, is_active, effective_week_ending, created_by
          )
          VALUES ($1, NULL, false, $2, $3)
        `,
        [previous.profile_id, input.effectiveWeekEnding, input.actorId]
      );
    }
    await client.query(
      `
        INSERT INTO public.payroll_rollout_activations (
          effective_week_ending, activated_by, notes
        )
        VALUES ($1, $2, 'Squires payroll rules client-approved rollout')
      `,
      [input.effectiveWeekEnding, input.actorId]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

export async function deletePayrollRuleDraft(versionId: string): Promise<void> {
  const client = createPayrollAdminPgClient();
  await client.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    const result = await client.query<{ status: string }>(
      `
        SELECT status
        FROM public.payroll_rule_versions
        WHERE id = $1
        FOR UPDATE
      `,
      [versionId]
    );
    if (!result.rows[0]) throw new Error('Payroll rule version not found.');
    if (result.rows[0].status !== 'draft') {
      throw new Error('Only an unactivated payroll draft can be deleted.');
    }
    await client.query(`DELETE FROM public.payroll_rule_versions WHERE id = $1`, [versionId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

export async function archivePayrollRuleVersion(versionId: string, actorId: string): Promise<void> {
  const client = createPayrollAdminPgClient();
  await client.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    const result = await client.query<{
      rule_set_id: string;
      status: string;
      effective_week_ending: string | null;
    }>(
      `
        SELECT rule_set_id, status, effective_week_ending::text
        FROM public.payroll_rule_versions
        WHERE id = $1
        FOR UPDATE
      `,
      [versionId]
    );
    const version = result.rows[0];
    if (!version) throw new Error('Payroll rule version not found.');
    if (version.status !== 'active' || !version.effective_week_ending) {
      throw new Error('Only an active payroll rule version can be archived.');
    }
    const replacement = await client.query<{ exists: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM public.payroll_rule_versions
          WHERE rule_set_id = $1
            AND status = 'active'
            AND effective_week_ending > $2::date
        ) AS exists
      `,
      [version.rule_set_id, version.effective_week_ending]
    );
    if (!replacement.rows[0]?.exists) {
      throw new Error('The current payroll version cannot be archived without a newer active replacement.');
    }
    await client.query(
      `
        UPDATE public.payroll_rule_versions
        SET status = 'archived', updated_by = $2
        WHERE id = $1
      `,
      [versionId, actorId]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}
