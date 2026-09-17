export const DUPLICATE_EMPLOYEE_ID_CODE = 'DUPLICATE_EMPLOYEE_ID';
export const DUPLICATE_EMPLOYEE_ID_MESSAGE = 'Employee ID is already in use';

export type ParsedEmployeeId =
  | { ok: true; value: string | null }
  | { ok: false };

type ProfileLookupResult = {
  data: { id: string } | null;
  error: { message?: string; code?: string } | null;
};

type ProfileLookupQuery = {
  maybeSingle: () => PromiseLike<ProfileLookupResult>;
  neq: (column: string, value: string) => { maybeSingle: () => PromiseLike<ProfileLookupResult> };
};

type EmployeeIdLookupClient = {
  from: (table: 'profiles') => {
    select: (columns: string) => {
      eq: (column: string, value: string) => ProfileLookupQuery;
    };
  };
};

export function parseEmployeeId(input: unknown): ParsedEmployeeId {
  if (input == null) {
    return { ok: true, value: null };
  }
  if (typeof input !== 'string') {
    return { ok: false };
  }
  const trimmed = input.trim();
  return { ok: true, value: trimmed.length === 0 ? null : trimmed };
}

export function isEmployeeIdUniqueViolation(error: unknown): boolean {
  if (!error) return false;

  if (typeof error === 'string') {
    return error.includes('profiles_employee_id_key');
  }

  if (typeof error !== 'object') return false;

  const code = 'code' in error ? String((error as { code?: unknown }).code || '') : '';
  const message = 'message' in error ? String((error as { message?: unknown }).message || '') : '';
  const details = 'details' in error ? String((error as { details?: unknown }).details || '') : '';
  const hint = 'hint' in error ? String((error as { hint?: unknown }).hint || '') : '';
  const combined = `${message} ${details} ${hint}`;

  if (!combined.includes('profiles_employee_id_key')) {
    return false;
  }

  return code === '23505' || combined.includes('duplicate key') || combined.includes('unique constraint');
}

export function duplicateEmployeeIdPayload() {
  return {
    error: DUPLICATE_EMPLOYEE_ID_MESSAGE,
    code: DUPLICATE_EMPLOYEE_ID_CODE,
  };
}

export async function findEmployeeIdOwner(
  supabaseAdmin: object,
  employeeId: string,
  excludeProfileId?: string,
): Promise<{ ok: true; ownerId: string | null } | { ok: false }> {
  const query = (supabaseAdmin as EmployeeIdLookupClient)
    .from('profiles')
    .select('id')
    .eq('employee_id', employeeId);

  const result = excludeProfileId
    ? await query.neq('id', excludeProfileId).maybeSingle()
    : await query.maybeSingle();

  if (result.error) {
    return { ok: false };
  }

  return { ok: true, ownerId: result.data?.id ?? null };
}
