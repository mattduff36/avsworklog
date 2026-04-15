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
const VERSION_ID = '55555555-5555-4555-8555-555555555555';
const SECTION_ID = '66666666-6666-4666-8666-666666666666';
const FIELD_ID = '77777777-7777-4777-8777-777777777777';

function createUserClient() {
  const taskSingle = vi.fn().mockResolvedValue({
    data: { id: TASK_ID, action_type: 'workshop_vehicle_task' },
    error: null,
  });
  const taskSelect = vi.fn(() => ({
    eq: vi.fn(() => ({ single: taskSingle })),
  }));

  const templateSingle = vi.fn().mockResolvedValue({
    data: { id: TEMPLATE_ID },
    error: null,
  });
  const templateSelect = vi.fn(() => ({
    eq: vi.fn(() => ({ single: templateSingle })),
  }));

  const duplicateSingle = vi.fn().mockResolvedValue({
    data: null,
    error: { code: 'PGRST116', message: 'No rows found' },
  });
  const duplicateSelect = vi.fn(() => ({
    eq: vi.fn(() => ({
      eq: vi.fn(() => ({ single: duplicateSingle })),
    })),
  }));

  const attachmentSingle = vi.fn().mockResolvedValue({
    data: {
      id: ATTACHMENT_ID,
      task_id: TASK_ID,
      template_id: TEMPLATE_ID,
      status: 'pending',
      created_by: USER_ID,
      workshop_attachment_templates: {
        id: TEMPLATE_ID,
        name: 'Safety checklist',
        description: 'V2 template',
        is_active: true,
      },
    },
    error: null,
  });
  const attachmentInsert = vi.fn(() => ({
    select: vi.fn(() => ({ single: attachmentSingle })),
  }));
  const attachmentDeleteEq = vi.fn().mockResolvedValue({ error: null });
  const attachmentDelete = vi.fn(() => ({
    eq: attachmentDeleteEq,
  }));

  const versionsOrder = vi.fn().mockResolvedValue({
    data: [{ id: VERSION_ID, status: 'published' }],
    error: null,
  });
  const versionsSelect = vi.fn(() => ({
    eq: vi.fn(() => ({ order: versionsOrder })),
  }));

  const sectionsOrder = vi.fn().mockResolvedValue({
    data: [
      {
        id: SECTION_ID,
        section_key: 'general',
        title: 'General',
        description: null,
        sort_order: 1,
      },
    ],
    error: null,
  });
  const sectionsSelect = vi.fn(() => ({
    eq: vi.fn(() => ({ order: sectionsOrder })),
  }));

  const fieldsOrder = vi.fn().mockResolvedValue({
    data: [
      {
        id: FIELD_ID,
        section_id: SECTION_ID,
        field_key: 'inspector_name',
        label: 'Inspector name',
        help_text: null,
        field_type: 'text',
        is_required: true,
        sort_order: 1,
        options_json: null,
        validation_json: null,
      },
    ],
    error: null,
  });
  const fieldsSelect = vi.fn(() => ({
    in: vi.fn(() => ({ order: fieldsOrder })),
  }));

  const from = vi.fn((table: string) => {
    if (table === 'actions') {
      return { select: taskSelect };
    }
    if (table === 'workshop_attachment_templates') {
      return { select: templateSelect };
    }
    if (table === 'workshop_task_attachments') {
      return {
        select: duplicateSelect,
        insert: attachmentInsert,
        delete: attachmentDelete,
      };
    }
    if (table === 'workshop_attachment_template_versions') {
      return { select: versionsSelect };
    }
    if (table === 'workshop_attachment_template_sections') {
      return { select: sectionsSelect };
    }
    if (table === 'workshop_attachment_template_fields') {
      return { select: fieldsSelect };
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
    attachmentDeleteEq,
  };
}

function createAdminSupabaseClient(snapshotInsertError: { message: string; code?: string } | null = null) {
  const snapshotInsert = vi.fn().mockResolvedValue({ error: snapshotInsertError });
  const from = vi.fn((table: string) => {
    if (table === 'workshop_attachment_schema_snapshots') {
      return { insert: snapshotInsert };
    }

    throw new Error(`Unexpected admin client table: ${table}`);
  });

  return {
    client: { from },
    from,
    snapshotInsert,
  };
}

async function callPost() {
  const { POST } = await import('@/app/api/workshop-tasks/attachments/task/[taskId]/route');

  return POST(
    new NextRequest(`http://localhost/api/workshop-tasks/attachments/task/${TASK_ID}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ template_id: TEMPLATE_ID }),
    }),
    { params: Promise.resolve({ taskId: TASK_ID }) }
  );
}

describe('POST /api/workshop-tasks/attachments/task/[taskId]', () => {
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogServerError.mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockClear();
  });

  it('creates the immutable schema snapshot with the admin client', async () => {
    const userClient = createUserClient();
    const adminClient = createAdminSupabaseClient();
    mockCreateClient.mockResolvedValue(userClient.client as never);
    mockCreateAdminClient.mockReturnValue(adminClient.client as never);

    const response = await callPost();
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.success).toBe(true);
    expect(mockCreateAdminClient).toHaveBeenCalledTimes(1);
    expect(adminClient.snapshotInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        attachment_id: ATTACHMENT_ID,
        template_version_id: VERSION_ID,
        created_by: USER_ID,
        snapshot_json: expect.objectContaining({
          template_id: TEMPLATE_ID,
          sections: expect.arrayContaining([
            expect.objectContaining({
              id: SECTION_ID,
            }),
          ]),
        }),
      })
    );
    expect(userClient.from.mock.calls.map(([table]) => table)).not.toContain('workshop_attachment_schema_snapshots');
  });

  it('rolls back the attachment if the admin snapshot insert fails', async () => {
    const userClient = createUserClient();
    const adminClient = createAdminSupabaseClient({
      code: '42501',
      message: 'new row violates row-level security policy',
    });
    mockCreateClient.mockResolvedValue(userClient.client as never);
    mockCreateAdminClient.mockReturnValue(adminClient.client as never);

    const response = await callPost();
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toBe('Internal server error');
    expect(userClient.attachmentDeleteEq).toHaveBeenCalledWith('id', ATTACHMENT_ID);
    expect(mockLogServerError).toHaveBeenCalledTimes(1);
  });
});
