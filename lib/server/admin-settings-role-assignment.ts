import pg from 'pg';
import { hasRoleFullAccess } from '@/lib/utils/role-access';

const { Client } = pg;

interface RoleAssignmentPgResult<Row = Record<string, unknown>> {
  rows: Row[];
}

export interface RoleAssignmentPgClient {
  connect(): Promise<void>;
  query<Row = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<RoleAssignmentPgResult<Row>>;
  end(): Promise<void>;
}

export type RoleAssignmentPgClientFactory = () => RoleAssignmentPgClient;

export interface RoleAccessRow {
  id: string;
  name: string;
  role_class: 'admin' | 'manager' | 'employee';
  is_super_admin: boolean;
}

interface TargetProfileRoleRow extends RoleAccessRow {
  profile_id: string;
  role_id: string;
}

export class AdminSettingsRoleAssignmentError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 500
  ) {
    super(message);
    this.name = 'AdminSettingsRoleAssignmentError';
  }
}

export function canAdminSettingsActorAssignRole(
  actorHasFullAccess: boolean,
  currentRole: RoleAccessRow,
  requestedRole: RoleAccessRow
): boolean {
  return actorHasFullAccess || (
    !hasRoleFullAccess(currentRole)
    && !hasRoleFullAccess(requestedRole)
  );
}

function createRoleAssignmentPgClient(): RoleAssignmentPgClient {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error('Missing database connection string for role assignment');
  }

  const url = new URL(connectionString);
  return new Client({
    host: url.hostname,
    port: Number.parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ssl: { rejectUnauthorized: false },
  }) as RoleAssignmentPgClient;
}

export async function updateUserRoleForAdminSettings(
  input: {
    userId: string;
    roleId: string;
    actorHasFullAccess: boolean;
  },
  createClient: RoleAssignmentPgClientFactory = createRoleAssignmentPgClient
): Promise<void> {
  const client = createClient();
  await client.connect();

  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');

    const targetResult = await client.query<TargetProfileRoleRow>(
      `
        SELECT
          profile.id AS profile_id,
          profile.role_id,
          role.id,
          role.name,
          role.role_class,
          role.is_super_admin
        FROM public.profiles profile
        INNER JOIN public.roles role ON role.id = profile.role_id
        WHERE profile.id = $1
        FOR UPDATE OF profile
      `,
      [input.userId]
    );
    const currentRole = targetResult.rows[0];
    if (!currentRole) {
      throw new AdminSettingsRoleAssignmentError('User not found', 404);
    }

    const requestedResult = await client.query<RoleAccessRow>(
      `
        SELECT id, name, role_class, is_super_admin
        FROM public.roles
        WHERE id = $1
        FOR SHARE
      `,
      [input.roleId]
    );
    const requestedRole = requestedResult.rows[0];
    if (!requestedRole) {
      throw new AdminSettingsRoleAssignmentError('Role not found', 400);
    }

    if (
      !canAdminSettingsActorAssignRole(
        input.actorHasFullAccess,
        currentRole,
        requestedRole
      )
    ) {
      throw new AdminSettingsRoleAssignmentError(
        'Delegated Admin Settings access cannot alter or assign Admin roles',
        403
      );
    }

    if (hasRoleFullAccess(currentRole) && !hasRoleFullAccess(requestedRole)) {
      await client.query(
        'DELETE FROM public.user_module_permissions WHERE user_id = $1',
        [input.userId]
      );
    }

    const updateResult = await client.query<{ id: string }>(
      `
        UPDATE public.profiles
        SET role_id = $1
        WHERE id = $2
          AND role_id = $3
        RETURNING id
      `,
      [input.roleId, input.userId, currentRole.role_id]
    );
    if (!updateResult.rows[0]) {
      throw new AdminSettingsRoleAssignmentError(
        'User role changed while this update was being processed. Refresh and try again.',
        409
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
