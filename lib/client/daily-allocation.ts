import type {
  DailyAllocationAssignmentDeleteInput,
  DailyAllocationConvertInput,
  DailyAllocationConvertResult,
  DailyAllocationLabourAssignInput,
  DailyAllocationOverrideInput,
  DailyAllocationPlantAssignInput,
  DailyAllocationPublishV2Input,
  DailyAllocationRangeBoardPayload,
  DailyAllocationV2Runtime,
  DailyAllocationVisitDeleteInput,
  DailyAllocationVisitMoveInput,
  DailyAllocationVisitMoveResult,
  DailyAllocationVisitMutationResult,
  DailyAllocationVisitUpsertInput,
} from '@/types/daily-allocation';

export const DAILY_ALLOCATION_BOARD_QUERY_ROOT = 'daily-allocation-board';
export const OPTIMISTIC_ENTITY_PREFIX = 'optimistic:';

export function dailyAllocationBoardQueryKey(startDate: string, endDate: string) {
  return [DAILY_ALLOCATION_BOARD_QUERY_ROOT, startDate, endDate] as const;
}

export function dailyAllocationBoardOptimisticKey(startDate: string, endDate: string): string {
  return `board:${startDate}:${endDate}`;
}

export class DailyAllocationApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly payload: Record<string, unknown>;

  constructor(
    message: string,
    status: number,
    payload: Record<string, unknown> = {},
    code?: string
  ) {
    super(message);
    this.name = 'DailyAllocationApiError';
    this.status = status;
    this.payload = payload;
    this.code = code
      ?? (typeof payload.code === 'string' ? payload.code : undefined);
  }
}

export function isDailyAllocationApiError(error: unknown): error is DailyAllocationApiError {
  return error instanceof DailyAllocationApiError;
}

export function isDailyAllocationStaleOrConflictError(error: unknown): boolean {
  return isDailyAllocationApiError(error) && error.status === 409;
}

export function isProvisionalDailyAllocationId(value: string | null | undefined): boolean {
  return Boolean(value?.startsWith(OPTIMISTIC_ENTITY_PREFIX));
}

function readErrorMessage(payload: Record<string, unknown>): string {
  if (typeof payload.error === 'string' && payload.error.trim()) {
    return payload.error;
  }
  if (payload.error && typeof payload.error === 'object' && 'message' in payload.error) {
    const nested = String((payload.error as { message?: unknown }).message || '').trim();
    if (nested) return nested;
  }
  if (typeof payload.message === 'string' && payload.message.trim()) {
    return payload.message;
  }
  return 'Daily allocation request failed.';
}

async function readResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new DailyAllocationApiError(
      readErrorMessage(payload),
      response.status,
      payload
    );
  }
  return payload as T;
}

const IDENTITY_KEYS = new Set([
  'id',
  'visit_id',
  'plan_day_id',
  'assignment_id',
  'override_id',
  'profile_id',
  'plant_id',
  'resource_id',
  'tag_ids',
]);

function isIdentityField(key: string): boolean {
  return IDENTITY_KEYS.has(key) || key.endsWith('_id') || key.endsWith('_ids');
}

export function assertNoProvisionalDailyAllocationIds(
  value: unknown,
  path = 'daily allocation mutation'
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertNoProvisionalDailyAllocationIds(item, `${path}[${index}]`);
    });
    return;
  }
  if (!value || typeof value !== 'object') return;

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const itemPath = `${path}.${key}`;
    if (isIdentityField(key) && typeof item === 'string' && isProvisionalDailyAllocationId(item)) {
      throw new DailyAllocationApiError(
        `Wait for ${itemPath} to finish saving.`,
        409,
        { code: 'PROVISIONAL_ID' },
        'PROVISIONAL_ID'
      );
    }
    if (isIdentityField(key) && Array.isArray(item)) {
      for (const id of item) {
        if (typeof id === 'string' && isProvisionalDailyAllocationId(id)) {
          throw new DailyAllocationApiError(
            `Wait for ${itemPath} to finish saving.`,
            409,
            { code: 'PROVISIONAL_ID' },
            'PROVISIONAL_ID'
          );
        }
      }
    }
    if (item && typeof item === 'object') {
      assertNoProvisionalDailyAllocationIds(item, itemPath);
    }
  }
}

function jsonRequest(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export async function fetchDailyAllocationRuntime(): Promise<DailyAllocationV2Runtime> {
  return readResponse(await fetch('/api/daily-allocation/runtime'));
}

export async function fetchDailyAllocationBoardRange(
  startDate: string,
  endDate: string
): Promise<DailyAllocationRangeBoardPayload> {
  return readResponse(
    await fetch(
      `/api/daily-allocation/board?start=${encodeURIComponent(startDate)}&end=${encodeURIComponent(endDate)}`
    )
  );
}

export async function convertDailyAllocationPlanDay(
  input: DailyAllocationConvertInput
): Promise<DailyAllocationConvertResult> {
  assertNoProvisionalDailyAllocationIds(input);
  return readResponse(
    await fetch('/api/daily-allocation/convert', jsonRequest('POST', input))
  );
}

export async function createDailyAllocationVisit(
  input: DailyAllocationVisitUpsertInput
): Promise<DailyAllocationVisitMutationResult> {
  assertNoProvisionalDailyAllocationIds(input);
  return readResponse(
    await fetch('/api/daily-allocation/visits', jsonRequest('POST', input))
  );
}

export async function updateDailyAllocationVisit(
  visitId: string,
  input: DailyAllocationVisitUpsertInput
): Promise<DailyAllocationVisitMutationResult> {
  assertNoProvisionalDailyAllocationIds({ ...input, visit_id: visitId });
  return readResponse(
    await fetch(`/api/daily-allocation/visits/${encodeURIComponent(visitId)}`, jsonRequest('PATCH', input))
  );
}

export async function moveDailyAllocationVisit(
  input: DailyAllocationVisitMoveInput
): Promise<DailyAllocationVisitMoveResult> {
  assertNoProvisionalDailyAllocationIds(input);
  return readResponse(
    await fetch(
      `/api/daily-allocation/visits/${encodeURIComponent(input.visit_id)}/move`,
      jsonRequest('POST', {
        target_plan_day_id: input.target_plan_day_id,
        expected_source_plan_version: input.expected_source_plan_version,
        expected_target_plan_version: input.expected_target_plan_version,
        expected_row_version: input.expected_row_version,
        starts_at: input.starts_at,
        ends_at: input.ends_at,
      })
    )
  );
}

export async function deleteDailyAllocationVisit(
  input: DailyAllocationVisitDeleteInput
): Promise<{ visit_id: string }> {
  assertNoProvisionalDailyAllocationIds(input);
  return readResponse(
    await fetch(`/api/daily-allocation/visits/${encodeURIComponent(input.visit_id)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expected_plan_version: input.expected_plan_version,
        expected_row_version: input.expected_row_version,
      }),
    })
  );
}

export async function assignDailyAllocationLabour(
  input: DailyAllocationLabourAssignInput
): Promise<{ assignment_id: string }> {
  assertNoProvisionalDailyAllocationIds(input);
  return readResponse(
    await fetch('/api/daily-allocation/assignments/labour', jsonRequest('POST', input))
  );
}

export async function unassignDailyAllocationLabour(
  assignmentId: string,
  input: DailyAllocationAssignmentDeleteInput
): Promise<{ assignment_id: string }> {
  assertNoProvisionalDailyAllocationIds({
    assignment_id: assignmentId,
    expected_plan_version: input.expected_plan_version,
  });
  return readResponse(
    await fetch(`/api/daily-allocation/assignments/labour/${encodeURIComponent(assignmentId)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expected_plan_version: input.expected_plan_version }),
    })
  );
}

export async function assignDailyAllocationPlant(
  input: DailyAllocationPlantAssignInput
): Promise<{ assignment_id: string }> {
  assertNoProvisionalDailyAllocationIds(input);
  return readResponse(
    await fetch('/api/daily-allocation/assignments/plant', jsonRequest('POST', input))
  );
}

export async function unassignDailyAllocationPlant(
  assignmentId: string,
  input: DailyAllocationAssignmentDeleteInput
): Promise<{ assignment_id: string }> {
  assertNoProvisionalDailyAllocationIds({
    assignment_id: assignmentId,
    expected_plan_version: input.expected_plan_version,
  });
  return readResponse(
    await fetch(`/api/daily-allocation/assignments/plant/${encodeURIComponent(assignmentId)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expected_plan_version: input.expected_plan_version }),
    })
  );
}

export async function createDailyAllocationConflictOverride(
  input: DailyAllocationOverrideInput
): Promise<{ override_id: string }> {
  assertNoProvisionalDailyAllocationIds(input);
  return readResponse(
    await fetch('/api/daily-allocation/overrides', jsonRequest('POST', input))
  );
}

export async function publishDailyAllocationPlanV2(
  input: DailyAllocationPublishV2Input
): Promise<{ publication_id: string; snapshot_version: 2 }> {
  assertNoProvisionalDailyAllocationIds(input);
  return readResponse(
    await fetch('/api/daily-allocation/publish', jsonRequest('POST', {
      snapshot_version: 2,
      plan_day_id: input.plan_day_id,
      expected_plan_version: input.expected_plan_version,
      idempotency_key: input.idempotency_key,
      confirm_unallocated: input.confirm_unallocated,
    }))
  );
}
