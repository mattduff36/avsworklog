import pg from 'pg';
import {
  TIMESHEET_GATE_STATUS_CONFLICT_CODE,
  resolveTimesheetManagerApprovedAction,
  resolveTimesheetRejectAction,
} from '@/lib/utils/timesheet-gates';

const { Client } = pg;
const MAX_SERIALIZATION_RETRIES = 3;

interface QueryResult<Row> {
  rows: Row[];
}

export interface TimesheetGatePgClient {
  connect(): Promise<void>;
  query<Row = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<Row>>;
  end(): Promise<void>;
}

export type TimesheetGatePgClientFactory = () => TimesheetGatePgClient;

export class TimesheetGateConflictError extends Error {
  readonly code = TIMESHEET_GATE_STATUS_CONFLICT_CODE;
  readonly currentStatus: string | null;

  constructor(message: string, currentStatus: string | null = null) {
    super(message);
    this.name = 'TimesheetGateConflictError';
    this.currentStatus = currentStatus;
  }
}

function createTimesheetGatePgClient(): TimesheetGatePgClient {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error('Missing database connection string for timesheet gates');
  }
  const url = new URL(connectionString);
  return new Client({
    host: url.hostname,
    port: Number.parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ssl: { rejectUnauthorized: false },
  }) as TimesheetGatePgClient;
}

async function withSerializableRetry<T>(
  createClient: TimesheetGatePgClientFactory,
  work: (client: TimesheetGatePgClient) => Promise<T>
): Promise<T> {
  let attempt = 0;
  while (attempt < MAX_SERIALIZATION_RETRIES) {
    const client = createClient();
    await client.connect();
    try {
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      const code = (error as { code?: string }).code;
      attempt += 1;
      if (code !== '40001' || attempt >= MAX_SERIALIZATION_RETRIES) throw error;
    } finally {
      await client.end();
    }
  }
  throw new Error('Timesheet gate change could not be completed.');
}

async function lockTimesheet(
  client: TimesheetGatePgClient,
  timesheetId: string
): Promise<{
  id: string;
  status: string;
  updated_at: string | null;
  payroll_received_by: string | null;
  manager_approved_by: string | null;
  user_id: string;
  week_ending: string;
} | null> {
  const locked = await client.query<{
    id: string;
    status: string;
    updated_at: string | null;
    payroll_received_by: string | null;
    manager_approved_by: string | null;
    user_id: string;
    week_ending: string;
  }>(
    `
      SELECT
        id::text,
        status,
        updated_at::text,
        payroll_received_by::text,
        manager_approved_by::text,
        user_id::text,
        week_ending::text
      FROM public.timesheets
      WHERE id = $1
      FOR UPDATE
    `,
    [timesheetId]
  );
  return locked.rows[0] ?? null;
}

export async function applyTimesheetManagerApproved(options: {
  timesheetId: string;
  actorId: string;
  expectedStatus?: string;
  createClient?: TimesheetGatePgClientFactory;
}): Promise<{ alreadyProcessed: boolean; status: string }> {
  return withSerializableRetry(options.createClient || createTimesheetGatePgClient, async (client) => {
    const current = await lockTimesheet(client, options.timesheetId);
    if (!current) {
      throw new Error('Timesheet not found');
    }
    if (options.expectedStatus && current.status !== options.expectedStatus) {
      throw new TimesheetGateConflictError(
        'Timesheet status changed before it could be processed.',
        current.status
      );
    }

    const decision = resolveTimesheetManagerApprovedAction(current.status);
    if (decision.type === 'already_done') {
      return { alreadyProcessed: true, status: current.status };
    }
    if (decision.type === 'conflict') {
      throw new TimesheetGateConflictError(decision.message, current.status);
    }

    const updated = await client.query<{ id: string }>(
      `
        UPDATE public.timesheets
        SET
          status = $2,
          manager_approved_at = COALESCE(manager_approved_at, NOW()),
          manager_approved_by = COALESCE(manager_approved_by, $3),
          processed_at = CASE WHEN $2 = 'processed' THEN COALESCE(processed_at, NOW()) ELSE processed_at END,
          updated_at = NOW()
        WHERE id = $1
          AND status = $4
        RETURNING id::text
      `,
      [options.timesheetId, decision.nextStatus, options.actorId, current.status]
    );
    if (!updated.rows[0]?.id) {
      throw new TimesheetGateConflictError(
        'Timesheet status changed before it could be processed.',
        current.status
      );
    }
    return { alreadyProcessed: false, status: decision.nextStatus };
  });
}

export interface TimesheetRejectResult {
  userId: string;
  weekEnding: string;
  previousStatus: string;
  payrollReceivedBy: string | null;
}

export async function applyTimesheetReject(options: {
  timesheetId: string;
  actorId: string;
  comments: string;
  expectedStatus?: string;
  createClient?: TimesheetGatePgClientFactory;
}): Promise<TimesheetRejectResult> {
  return withSerializableRetry(options.createClient || createTimesheetGatePgClient, async (client) => {
    const current = await lockTimesheet(client, options.timesheetId);
    if (!current) {
      throw new Error('Timesheet not found');
    }
    if (options.expectedStatus && current.status !== options.expectedStatus) {
      throw new TimesheetGateConflictError(
        'Timesheet status changed before it could be rejected.',
        current.status
      );
    }

    const decision = resolveTimesheetRejectAction(current.status);
    if (decision.type !== 'apply') {
      throw new TimesheetGateConflictError(
        decision.type === 'conflict' ? decision.message : 'This timesheet cannot be rejected.',
        current.status
      );
    }

    const updated = await client.query<{ id: string }>(
      `
        UPDATE public.timesheets
        SET
          status = 'rejected',
          reviewed_by = $2,
          reviewed_at = NOW(),
          manager_comments = $3,
          payroll_received_at = NULL,
          payroll_received_by = NULL,
          manager_approved_at = NULL,
          manager_approved_by = NULL,
          processed_at = NULL,
          current_payroll_snapshot_id = NULL,
          updated_at = NOW()
        WHERE id = $1
          AND status = $4
        RETURNING id::text
      `,
      [options.timesheetId, options.actorId, options.comments.trim(), current.status]
    );
    if (!updated.rows[0]?.id) {
      throw new TimesheetGateConflictError(
        'Timesheet status changed before it could be rejected.',
        current.status
      );
    }

    const recipients = [current.user_id];
    if (current.payroll_received_by) recipients.push(current.payroll_received_by);
    await insertTimesheetNotificationInTransaction(client, {
      senderId: options.actorId,
      subject: 'Timesheet Rejected',
      body: `Timesheet for week ending ${current.week_ending} was rejected.\n\nComments: ${options.comments.trim()}`,
      recipientIds: recipients,
    });

    return {
      userId: current.user_id,
      weekEnding: current.week_ending,
      previousStatus: current.status,
      payrollReceivedBy: current.payroll_received_by,
    };
  });
}

export async function insertTimesheetNotificationInTransaction(
  client: TimesheetGatePgClient,
  input: {
    senderId: string;
    subject: string;
    body: string;
    recipientIds: string[];
  }
): Promise<void> {
  if (input.recipientIds.length === 0) return;
  const message = await client.query<{ id: string }>(
    `
      INSERT INTO public.messages (
        type, subject, body, priority, sender_id, created_via, module_key
      )
      VALUES ('NOTIFICATION', $1, $2, 'HIGH', $3, 'timesheet_gate', 'timesheets')
      RETURNING id::text
    `,
    [input.subject, input.body, input.senderId]
  );
  const messageId = message.rows[0]?.id;
  if (!messageId) throw new Error('Failed to persist timesheet notification');
  for (const recipientId of [...new Set(input.recipientIds)]) {
    await client.query(
      `
        INSERT INTO public.message_recipients (message_id, user_id, status)
        VALUES ($1, $2, 'PENDING')
      `,
      [messageId, recipientId]
    );
  }
}
