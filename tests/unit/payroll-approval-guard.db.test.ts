import pg from 'pg';
import { resolve } from 'path';
import { config as loadEnv } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

loadEnv({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;

describe('payroll approval guard live DB', () => {
  let client: pg.Client | null = null;

  beforeAll(async () => {
    const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
    if (!connectionString) {
      throw new Error('Missing database connection string for payroll guard test');
    }
    const url = new URL(connectionString);
    client = new Client({
      host: url.hostname,
      port: Number.parseInt(url.port || '5432', 10),
      database: url.pathname.slice(1),
      user: url.username,
      password: url.password ? decodeURIComponent(url.password) : undefined,
      ssl: { rejectUnauthorized: false },
    });
    await client.connect();
  });

  afterAll(async () => {
    await client?.end();
  });

  it('PAY-APPROVAL-GUARD-001 rejects reapproval that reuses the same snapshot pointer', async () => {
    if (!client) throw new Error('Client not initialised');

    await client.query('BEGIN');
    try {
      const actor = await client.query<{ id: string }>(
        `SELECT id::text FROM public.profiles ORDER BY created_at ASC LIMIT 1`
      );
      const rule = await client.query<{ rule_set_id: string; rule_version_id: string }>(`
        SELECT rule_set.id::text AS rule_set_id, version.id::text AS rule_version_id
        FROM public.payroll_rule_sets rule_set
        JOIN public.payroll_rule_versions version ON version.rule_set_id = rule_set.id
        WHERE rule_set.rule_key = 'civils'
        ORDER BY version.version_number DESC
        LIMIT 1
      `);
      const actorId = actor.rows[0]?.id;
      const ruleSetId = rule.rows[0]?.rule_set_id;
      const ruleVersionId = rule.rows[0]?.rule_version_id;
      expect(actorId && ruleSetId && ruleVersionId).toBeTruthy();

      // Ensure post-cutover guard path is active for this rolled-back fixture week.
      await client.query(
        `
          INSERT INTO public.payroll_rollout_activations (
            effective_week_ending, activated_by, notes
          )
          VALUES ('2099-01-04', $1, 'payroll-guard-test')
          ON CONFLICT (effective_week_ending) DO NOTHING
        `,
        [actorId]
      );

      const created = await client.query<{ id: string }>(
        `
          INSERT INTO public.timesheets (
            user_id, week_ending, status, timesheet_type, template_version
          )
          VALUES ($1, '2099-01-04', 'submitted', 'civils', 1)
          RETURNING id::text
        `,
        [actorId]
      );
      const timesheetId = created.rows[0]?.id;
      expect(timesheetId).toBeTruthy();

      const snapshot = await client.query<{ id: string }>(
        `
          INSERT INTO public.timesheet_payroll_snapshots (
            timesheet_id, revision, rule_set_id, rule_version_id,
            assignment_source, engine_version, input_hash, idempotency_key,
            basic_minutes, overtime_minutes, double_time_minutes, payable_minutes,
            source_evidence, approved_by
          )
          VALUES (
            $1, 1, $2, $3, 'fallback', 1, 'guard-test-hash', gen_random_uuid(),
            0, 0, 0, 0, '{}'::jsonb, $4
          )
          RETURNING id::text
        `,
        [timesheetId, ruleSetId, ruleVersionId, actorId]
      );
      const snapshotId = snapshot.rows[0]?.id;
      expect(snapshotId).toBeTruthy();

      await client.query(
        `
          UPDATE public.timesheets
          SET status = 'approved', current_payroll_snapshot_id = $2, reviewed_by = $3, reviewed_at = NOW()
          WHERE id = $1
        `,
        [timesheetId, snapshotId, actorId]
      );
      await client.query(
        `UPDATE public.timesheets SET status = 'adjusted' WHERE id = $1`,
        [timesheetId]
      );

      await expect(
        client.query(
          `UPDATE public.timesheets SET status = 'approved' WHERE id = $1`,
          [timesheetId]
        )
      ).rejects.toThrow(/Reapproval must append a snapshot revision/);
    } finally {
      await client.query('ROLLBACK');
    }
  });

  it('PAY-ENTRY-GUARD-001 blocks approved entry mutation and re-parenting', async () => {
    if (!client) throw new Error('Client not initialised');

    await client.query('BEGIN');
    try {
      const actor = await client.query<{ id: string }>(
        `SELECT id::text FROM public.profiles ORDER BY created_at ASC LIMIT 1`
      );
      const actorId = actor.rows[0]?.id;
      expect(actorId).toBeTruthy();

      const approved = await client.query<{ id: string }>(
        `
          INSERT INTO public.timesheets (
            user_id, week_ending, status, timesheet_type, template_version
          )
          VALUES ($1, '2099-02-01', 'draft', 'civils', 1)
          RETURNING id::text
        `,
        [actorId]
      );
      const approvedId = approved.rows[0]?.id;
      expect(approvedId).toBeTruthy();

      const entry = await client.query<{ id: string }>(
        `
          INSERT INTO public.timesheet_entries (
            timesheet_id, day_of_week, time_started, time_finished, daily_total
          )
          VALUES ($1, 1, '08:00', '16:00', 8)
          RETURNING id::text
        `,
        [approvedId]
      );
      const entryId = entry.rows[0]?.id;
      expect(entryId).toBeTruthy();

      const jobCode = await client.query<{ id: string }>(
        `
          INSERT INTO public.timesheet_entry_job_codes (
            timesheet_entry_id, job_number, display_order
          )
          VALUES ($1, 'JOB-EXISTING', 0)
          RETURNING id::text
        `,
        [entryId]
      );
      const jobCodeId = jobCode.rows[0]?.id;
      expect(jobCodeId).toBeTruthy();

      // Prefer direct status set without snapshot when rollout does not apply.
      const rolloutApplies = await client.query<{ applies: boolean }>(
        `
          SELECT EXISTS (
            SELECT 1 FROM public.payroll_rollout_activations
            WHERE effective_week_ending <= '2099-02-01'
          ) AS applies
        `
      );

      if (rolloutApplies.rows[0]?.applies) {
        const rule = await client.query<{ rule_set_id: string; rule_version_id: string }>(`
          SELECT rule_set.id::text AS rule_set_id, version.id::text AS rule_version_id
          FROM public.payroll_rule_sets rule_set
          JOIN public.payroll_rule_versions version ON version.rule_set_id = rule_set.id
          WHERE rule_set.rule_key = 'civils'
          ORDER BY version.version_number DESC
          LIMIT 1
        `);
        const snapshot = await client.query<{ id: string }>(
          `
            INSERT INTO public.timesheet_payroll_snapshots (
              timesheet_id, revision, rule_set_id, rule_version_id,
              assignment_source, engine_version, input_hash, idempotency_key,
              basic_minutes, overtime_minutes, double_time_minutes, payable_minutes,
              source_evidence, approved_by
            )
            VALUES (
              $1, 1, $2, $3, 'fallback', 1, 'entry-guard-hash', gen_random_uuid(),
              0, 0, 0, 0, '{}'::jsonb, $4
            )
            RETURNING id::text
          `,
          [approvedId, rule.rows[0]?.rule_set_id, rule.rows[0]?.rule_version_id, actorId]
        );
        await client.query(
          `
            UPDATE public.timesheets
            SET status = 'approved', current_payroll_snapshot_id = $2
            WHERE id = $1
          `,
          [approvedId, snapshot.rows[0]?.id]
        );
      } else {
        await client.query(
          `UPDATE public.timesheets SET status = 'approved' WHERE id = $1`,
          [approvedId]
        );
      }

      await client.query('SAVEPOINT before_delete_guard');
      await expect(
        client.query(`DELETE FROM public.timesheet_entries WHERE id = $1`, [entryId])
      ).rejects.toThrow(/Approved timesheet entries are immutable/);
      await client.query('ROLLBACK TO SAVEPOINT before_delete_guard');

      const draft = await client.query<{ id: string }>(
        `
          INSERT INTO public.timesheets (
            user_id, week_ending, status, timesheet_type, template_version
          )
          VALUES ($1, '2099-02-08', 'draft', 'civils', 1)
          RETURNING id::text
        `,
        [actorId]
      );
      const draftId = draft.rows[0]?.id;
      expect(draftId).toBeTruthy();

      await client.query('SAVEPOINT before_reparent_guard');
      await expect(
        client.query(
          `UPDATE public.timesheet_entries SET timesheet_id = $2 WHERE id = $1`,
          [entryId, draftId]
        )
      ).rejects.toThrow(/Approved timesheet entries are immutable/);
      await client.query('ROLLBACK TO SAVEPOINT before_reparent_guard');

      const draftEntry = await client.query<{ id: string }>(
        `
          INSERT INTO public.timesheet_entries (
            timesheet_id, day_of_week, time_started, time_finished, daily_total
          )
          VALUES ($1, 2, '08:00', '16:00', 8)
          RETURNING id::text
        `,
        [draftId]
      );
      const draftEntryId = draftEntry.rows[0]?.id;
      expect(draftEntryId).toBeTruthy();

      await client.query('SAVEPOINT before_new_parent_guard');
      await expect(
        client.query(
          `UPDATE public.timesheet_entries SET timesheet_id = $2 WHERE id = $1`,
          [draftEntryId, approvedId]
        )
      ).rejects.toThrow(/Approved timesheet entries are immutable/);
      await client.query('ROLLBACK TO SAVEPOINT before_new_parent_guard');

      await client.query('SAVEPOINT before_entry_insert_guard');
      await expect(
        client.query(
          `
            INSERT INTO public.timesheet_entries (
              timesheet_id, day_of_week, time_started, time_finished, daily_total
            )
            VALUES ($1, 3, '08:00', '16:00', 8)
          `,
          [approvedId]
        )
      ).rejects.toThrow(/Approved timesheet entries are immutable/);
      await client.query('ROLLBACK TO SAVEPOINT before_entry_insert_guard');

      await client.query('SAVEPOINT before_entry_update_guard');
      await expect(
        client.query(
          `UPDATE public.timesheet_entries SET remarks = 'changed' WHERE id = $1`,
          [entryId]
        )
      ).rejects.toThrow(/Approved timesheet entries are immutable/);
      await client.query('ROLLBACK TO SAVEPOINT before_entry_update_guard');

      await client.query('SAVEPOINT before_job_code_insert_guard');
      await expect(
        client.query(
          `
            INSERT INTO public.timesheet_entry_job_codes (
              timesheet_entry_id, job_number, display_order
            )
            VALUES ($1, 'JOB-GUARD', 1)
          `,
          [entryId]
        )
      ).rejects.toThrow(/Approved timesheet entry job codes are immutable/);
      await client.query('ROLLBACK TO SAVEPOINT before_job_code_insert_guard');

      await client.query('SAVEPOINT before_job_code_update_guard');
      await expect(
        client.query(
          `UPDATE public.timesheet_entry_job_codes SET job_number = 'JOB-NEW' WHERE id = $1`,
          [jobCodeId]
        )
      ).rejects.toThrow(/Approved timesheet entry job codes are immutable/);
      await client.query('ROLLBACK TO SAVEPOINT before_job_code_update_guard');

      await client.query('SAVEPOINT before_job_code_delete_guard');
      await expect(
        client.query(`DELETE FROM public.timesheet_entry_job_codes WHERE id = $1`, [jobCodeId])
      ).rejects.toThrow(/Approved timesheet entry job codes are immutable/);
      await client.query('ROLLBACK TO SAVEPOINT before_job_code_delete_guard');

      await client.query('SAVEPOINT before_job_code_reparent_guard');
      await expect(
        client.query(
          `UPDATE public.timesheet_entry_job_codes SET timesheet_entry_id = $2 WHERE id = $1`,
          [jobCodeId, draftEntryId]
        )
      ).rejects.toThrow(/Approved timesheet entry job codes are immutable/);
      await client.query('ROLLBACK TO SAVEPOINT before_job_code_reparent_guard');
    } finally {
      await client.query('ROLLBACK');
    }
  });
});
