import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockLogServerError,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockLogServerError: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: mockLogServerError,
}));

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const TEMPLATE_ID = '22222222-2222-4222-8222-222222222222';
const ATTACHMENT_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const SNAPSHOT_ID = '55555555-5555-4555-8555-555555555555';
const RESPONSE_ID = '66666666-6666-4666-8666-666666666666';

function createUserClientForTaskAttachmentsGet() {
  const attachmentsOrder = vi.fn().mockResolvedValue({
    data: [
      {
        id: ATTACHMENT_ID,
        task_id: TASK_ID,
        template_id: TEMPLATE_ID,
        status: 'pending',
        workshop_attachment_templates: {
          id: TEMPLATE_ID,
          name: '6 Week Inspection - Trailer',
          description: 'Trailer inspection',
          is_active: true,
        },
      },
    ],
    error: null,
  });
  const attachmentsSelect = vi.fn(() => ({
    eq: vi.fn(() => ({ order: attachmentsOrder })),
  }));

  const from = vi.fn((table: string) => {
    if (table === 'workshop_task_attachments') {
      return { select: attachmentsSelect };
    }

    throw new Error(`Unexpected user client table: ${table}`);
  });

  return {
    client: {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: USER_ID } },
          error: null,
        }),
      },
      from,
    },
    from,
  };
}

function createUserClientForAttachmentGet() {
  const attachmentSingle = vi.fn().mockResolvedValue({
    data: {
      id: ATTACHMENT_ID,
      task_id: TASK_ID,
      template_id: TEMPLATE_ID,
      status: 'pending',
      workshop_attachment_templates: {
        id: TEMPLATE_ID,
        name: '6 Week Inspection - Trailer',
        description: 'Trailer inspection',
        is_active: true,
      },
    },
    error: null,
  });
  const attachmentSelect = vi.fn(() => ({
    eq: vi.fn(() => ({ single: attachmentSingle })),
  }));

  const from = vi.fn((table: string) => {
    if (table === 'workshop_task_attachments') {
      return { select: attachmentSelect };
    }

    throw new Error(`Unexpected user client table: ${table}`);
  });

  return {
    client: {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: USER_ID } },
          error: null,
        }),
      },
      from,
    },
    from,
  };
}

function createAdminClientForAttachmentReads() {
  const snapshotIn = vi.fn().mockResolvedValue({
    data: [
      {
        id: SNAPSHOT_ID,
        attachment_id: ATTACHMENT_ID,
        snapshot_json: {
          sections: [
            {
              section_key: 'general',
              title: 'General',
              fields: [
                {
                  field_key: 'inspector_name',
                  label: 'Inspector name',
                  field_type: 'text',
                  is_required: true,
                  sort_order: 1,
                },
              ],
            },
          ],
        },
      },
    ],
    error: null,
  });
  const snapshotLimit = vi.fn().mockResolvedValue({
    data: [
      {
        id: SNAPSHOT_ID,
        attachment_id: ATTACHMENT_ID,
        snapshot_json: {
          sections: [
            {
              section_key: 'general',
              title: 'General',
              fields: [
                {
                  field_key: 'inspector_name',
                  label: 'Inspector name',
                  field_type: 'text',
                  is_required: true,
                  sort_order: 1,
                },
              ],
            },
          ],
        },
      },
    ],
    error: null,
  });
  const fieldResponsesIn = vi.fn().mockResolvedValue({
    data: [
      {
        id: RESPONSE_ID,
        attachment_id: ATTACHMENT_ID,
        section_key: 'general',
        field_key: 'inspector_name',
        response_value: 'Luke Williams',
        response_json: null,
      },
    ],
    error: null,
  });
  const fieldResponsesEq = vi.fn().mockResolvedValue({
    data: [
      {
        id: RESPONSE_ID,
        attachment_id: ATTACHMENT_ID,
        section_key: 'general',
        field_key: 'inspector_name',
        response_value: 'Luke Williams',
        response_json: null,
      },
    ],
    error: null,
  });

  const from = vi.fn((table: string) => {
    if (table === 'workshop_attachment_schema_snapshots') {
      return {
        select: vi.fn(() => ({
          in: snapshotIn,
          eq: vi.fn(() => ({ limit: snapshotLimit })),
        })),
      };
    }

    if (table === 'workshop_attachment_field_responses') {
      return {
        select: vi.fn(() => ({
          in: fieldResponsesIn,
          eq: fieldResponsesEq,
        })),
      };
    }

    throw new Error(`Unexpected admin client table: ${table}`);
  });

  return {
    client: { from },
    from,
    snapshotIn,
    snapshotLimit,
    fieldResponsesIn,
    fieldResponsesEq,
  };
}

async function callTaskAttachmentsGet() {
  const { GET } = await import('@/app/api/workshop-tasks/attachments/task/[taskId]/route');

  return GET(
    new NextRequest(`http://localhost/api/workshop-tasks/attachments/task/${TASK_ID}`, {
      method: 'GET',
    }),
    { params: Promise.resolve({ taskId: TASK_ID }) },
  );
}

async function callAttachmentGet() {
  const { GET } = await import('@/app/api/workshop-tasks/attachments/[id]/route');

  return GET(
    new NextRequest(`http://localhost/api/workshop-tasks/attachments/${ATTACHMENT_ID}`, {
      method: 'GET',
    }),
    { params: Promise.resolve({ id: ATTACHMENT_ID }) },
  );
}

describe('workshop attachment read routes', () => {
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogServerError.mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockClear();
  });

  it('loads task attachment snapshots through the admin client after attachment authorization', async () => {
    const userClient = createUserClientForTaskAttachmentsGet();
    const adminClient = createAdminClientForAttachmentReads();
    mockCreateClient.mockResolvedValue(userClient.client as never);
    mockCreateAdminClient.mockReturnValue(adminClient.client as never);

    const response = await callTaskAttachmentsGet();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.attachments).toHaveLength(1);
    expect(payload.attachments[0].schema_snapshot?.snapshot_json?.sections).toHaveLength(1);
    expect(payload.attachments[0].field_responses).toHaveLength(1);
    expect(userClient.from.mock.calls.map(([table]) => table)).toEqual(['workshop_task_attachments']);
    expect(adminClient.snapshotIn).toHaveBeenCalledWith('attachment_id', [ATTACHMENT_ID]);
    expect(adminClient.fieldResponsesIn).toHaveBeenCalledWith('attachment_id', [ATTACHMENT_ID]);
  });

  it('loads single attachment snapshots through the admin client after attachment authorization', async () => {
    const userClient = createUserClientForAttachmentGet();
    const adminClient = createAdminClientForAttachmentReads();
    mockCreateClient.mockResolvedValue(userClient.client as never);
    mockCreateAdminClient.mockReturnValue(adminClient.client as never);

    const response = await callAttachmentGet();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.attachment.schema_snapshot?.snapshot_json?.sections).toHaveLength(1);
    expect(payload.attachment.field_responses).toHaveLength(1);
    expect(userClient.from.mock.calls.map(([table]) => table)).toEqual(['workshop_task_attachments']);
    expect(adminClient.snapshotIn).toHaveBeenCalledWith('attachment_id', [ATTACHMENT_ID]);
    expect(adminClient.fieldResponsesEq).toHaveBeenCalledWith('attachment_id', ATTACHMENT_ID);
  });
});
