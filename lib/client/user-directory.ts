import type { ModuleName } from '@/types/roles';

export interface DirectoryUserRole {
  id?: string | null;
  name?: string | null;
  display_name?: string | null;
  is_manager_admin?: boolean | null;
}

export interface DirectoryUserTeam {
  id?: string | null;
  name?: string | null;
}

export interface DirectoryUser {
  id: string;
  full_name: string | null;
  employee_id: string | null;
  annual_holiday_allowance_days?: number | null;
  role?: DirectoryUserRole | null;
  team?: DirectoryUserTeam | null;
  has_module_access?: boolean;
}

export interface FetchUserDirectoryOptions {
  includeRole?: boolean;
  includeAllowance?: boolean;
  ids?: string[];
  module?: ModuleName;
}

export async function fetchUserDirectory(
  options: FetchUserDirectoryOptions = {}
): Promise<DirectoryUser[]> {
  const params = new URLSearchParams();

  if (options.includeRole) {
    params.set('includeRole', 'true');
  }

  if (options.includeAllowance) {
    params.set('includeAllowance', 'true');
  }

  if (options.ids?.length) {
    params.set('ids', options.ids.join(','));
  }

  if (options.module) {
    params.set('module', options.module);
  }

  const query = params.toString();
  const response = await fetch(
    query ? `/api/users/directory?${query}` : '/api/users/directory',
    { cache: 'no-store' }
  );
  const payload = (await response.json()) as {
    error?: string;
    users?: DirectoryUser[];
  };

  if (!response.ok) {
    throw new Error(payload.error || 'Failed to load users');
  }

  return payload.users || [];
}
