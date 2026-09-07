import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { AppSessionValidationResult } from '@/lib/server/app-auth/session';

const {
  mockRequireWorkshopTasksAccess,
  mockCreateAdminSupabaseClient,
  mockCreateUserClient,
  mockCreateAdminClient,
  mockLogServerError,
  mockGetAdminSchemaSnapshotForAttachment,
} = vi.hoisted(() => ({
  mockRequireWorkshopTasksAccess: vi.fn(),
  mockCreateAdminSupabaseClient: vi.fn(),
  mockCreateUserClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockLogServerError: vi.fn(),
  mockGetAdminSchemaSnapshotForAttachment: vi.fn(),
}));

vi.mock('@/lib/server/workshop-tasks/auth', () => ({
  requireWorkshopTasksAccess: mockRequireWorkshopTasksAccess,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: mockCreateAdminSupabaseClient,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateUserClient,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: mockLogServerError,
}));

vi.mock('@/lib/server/workshop-attachment-admin', () => ({
  getAdminSchemaSnapshotForAttachment: mockGetAdminSchemaSnapshotForAttachment,
  getAdminFieldResponsesForAttachment: vi.fn(),
}));

import { PATCH as patchTimestamp } from '@/app/api/workshop-tasks/tasks/[taskId]/timeline/[timelineItemId]/timestamp/route';
import { POST as postSchema } from '@/app/api/workshop-tasks/attachments/[id]/schema/route';

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const ATTACHMENT_ID = '22222222-2222-4222-8222-222222222222';
const CORRECTION_EVENT_ID = 'evt-corrected';

function missingSession(): AppSessionValidationResult {
  return {
    status: 'missing',
    session: null,
    profileId: null,
    email: null,
    cookieValue: null,
    cookieExpiresAt: null,
    secretRotated: false,
    failureReason: 'missing_cookie',
    kioskDeviceIdHint: null,
  };
}

function activeSession(): AppSessionValidationResult {
  return {
    status: 'active',
    session: null,
    profileId: 'manager-1',
    email: null,
    cookieValue: null,
    cookieExpiresAt: null,
    secretRotated: false,
    failureReason: null,
    kioskDeviceIdHint: null,
  };
}

describe('completed workshop correction first-review blockers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLogServerError.mockResolvedValue(undefined);
  });

  it('WT-CORR-B2 authorizes timestamp writes before admin and 409s completed schema POSTs', async () => {
    mockRequireWorkshopTasksAccess.mockResolvedValue({
      ok: false,
      status: 401,
      validation: missingSession(),
    });

    const unauthorized = await patchTimestamp(
      new NextRequest(
        `http://localhost/api/workshop-tasks/tasks/${TASK_ID}/timeline/created/timestamp`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ itemType: 'created', timestamp: '2026-04-13T08:30:00.000Z' }),
        }
      ),
      { params: Promise.resolve({ taskId: TASK_ID, timelineItemId: 'created' }) }
    );
    expect(unauthorized.status).toBe(401);
    expect(mockCreateAdminSupabaseClient).not.toHaveBeenCalled();

    const actionUpdate = vi.fn();
    mockRequireWorkshopTasksAccess.mockResolvedValue({
      ok: true,
      userId: 'manager-1',
      validation: activeSession(),
    });
    mockCreateAdminSupabaseClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'actions') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: TASK_ID,
                    action_type: 'workshop_vehicle_task',
                    title: 'Workshop Task - Test Asset',
                    description: 'Routine workshop task',
                    workshop_comments: 'Routine workshop task',
                    created_at: '2026-04-13T09:00:00.000Z',
                    created_by: 'user-created',
                    logged_at: '2026-04-13T10:00:00.000Z',
                    logged_by: 'user-started',
                    logged_comment: 'Started work',
                    actioned: true,
                    actioned_at: '2026-04-13T12:00:00.000Z',
                    actioned_by: 'user-completed',
                    actioned_comment: 'Completed work',
                    actioned_signature_data: null,
                    actioned_signed_at: null,
                    van_id: null,
                    hgv_id: null,
                    plant_id: null,
                    workshop_task_categories: null,
                    workshop_task_subcategories: null,
                    status_history: [
                      {
                        id: 'event-started',
                        type: 'status',
                        status: 'logged',
                        created_at: '2026-04-13T10:00:00.000Z',
                        author_id: 'user-started',
                        author_name: 'Starter',
                        body: 'Started work',
                      },
                      {
                        id: 'event-completed',
                        type: 'status',
                        status: 'completed',
                        created_at: '2026-04-13T12:00:00.000Z',
                        author_id: 'user-completed',
                        author_name: 'Completer',
                        body: 'Completed work',
                      },
                      {
                        id: CORRECTION_EVENT_ID,
                        type: 'status',
                        status: 'corrected',
                        created_at: '2026-04-14T09:00:00.000Z',
                        author_id: 'manager-1',
                        author_name: 'Manager',
                        body: 'Corrected comments after completion',
                        meta: { event_kind: 'completed_task_correction' },
                      },
                    ],
                  },
                  error: null,
                }),
              })),
            })),
            update: actionUpdate,
          };
        }
        if (table === 'workshop_task_comments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn().mockResolvedValue({ data: [], error: null }),
              })),
            })),
          };
        }
        if (table === 'profiles') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { full_name: 'Manager One' },
                  error: null,
                }),
              })),
            })),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const correctionTimestamp = await patchTimestamp(
      new NextRequest(
        `http://localhost/api/workshop-tasks/tasks/${TASK_ID}/timeline/${CORRECTION_EVENT_ID}/timestamp`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            itemType: 'status_event',
            timestamp: '2026-04-14T10:00:00.000Z',
          }),
        }
      ),
      { params: Promise.resolve({ taskId: TASK_ID, timelineItemId: CORRECTION_EVENT_ID }) }
    );
    const correctionPayload = await correctionTimestamp.json();
    expect(correctionTimestamp.status).toBe(400);
    expect(correctionPayload.error).toBe('Correction events cannot have their timestamps adjusted');
    expect(actionUpdate).not.toHaveBeenCalled();

    const upsert = vi.fn();
    mockCreateUserClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }),
      },
      from: vi.fn((table: string) => {
        if (table === 'workshop_task_attachments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: ATTACHMENT_ID,
                    status: 'pending',
                    task_id: TASK_ID,
                  },
                  error: null,
                }),
              })),
            })),
          };
        }
        if (table === 'actions') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { id: TASK_ID, status: 'completed' },
                  error: null,
                }),
              })),
            })),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    });
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({ upsert })),
    });

    const schemaResponse = await postSchema(
      new NextRequest(`http://localhost/api/workshop-tasks/attachments/${ATTACHMENT_ID}/schema`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          responses: [
            {
              section_key: 'details',
              field_key: 'odometer_reading',
              response_value: '650153',
            },
          ],
        }),
      }),
      { params: Promise.resolve({ id: ATTACHMENT_ID }) }
    );
    expect(schemaResponse.status).toBe(409);
    expect(upsert).not.toHaveBeenCalled();
    expect(mockGetAdminSchemaSnapshotForAttachment).not.toHaveBeenCalled();
  });
});
