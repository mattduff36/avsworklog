import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument } from 'pdf-lib';

const state = vi.hoisted(() => ({
  userId: '22222222-2222-4222-8222-222222222222' as string | null,
  level: 4,
  superAdmin: true,
  pin: false,
  insertError: false,
  row: {} as Record<string, unknown>,
  admin: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  signed: vi.fn(),
}));
vi.mock('@/lib/utils/view-as', () => ({ getEffectiveRole: vi.fn(async () => ({ user_id: state.userId, is_actual_super_admin: state.superAdmin, is_viewing_as: state.superAdmin })) }));
vi.mock('@/lib/utils/rbac', () => ({ getEffectiveModuleAccessLevel: vi.fn(async () => state.level) }));
vi.mock('@/lib/server/sensitive-module-access', () => ({ requireSensitiveModuleAccess: vi.fn(async () => state.pin ? NextResponse.json({ error: 'PIN required' }, { status: 428 }) : null) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: state.admin }));
vi.mock('@/lib/utils/server-error-logger', () => ({ logServerError: vi.fn(async () => undefined) }));

import { GET as list, POST as create } from '@/app/api/external-documents/route';
import { GET as detail, PATCH as update } from '@/app/api/external-documents/[id]/route';
import { GET as file } from '@/app/api/external-documents/[id]/file/route';

const id = '33333333-3333-4333-8333-333333333333';
const context = { params: Promise.resolve({ id }) };
function request(path = '', init?: RequestInit) { return new NextRequest(`http://localhost/api/external-documents${path}`, init); }

beforeEach(() => {
  vi.clearAllMocks();
  state.superAdmin = true;
  state.userId = '22222222-2222-4222-8222-222222222222'; state.level = 4; state.pin = false; state.insertError = false;
  state.row = {
    id, title: 'Sample', category: 'Service record', external_company: 'Sample provider', document_date: '2026-10-13', expiry_date: null,
    reference: null, notes: null, van_id: null, plant_id: null, hgv_id: null, shared_with: [state.userId], file_name: 'sample.pdf', file_size: 100,
    page_count: 1, source: 'upload', source_files: ['sample.pdf'], uploaded_by: state.userId, created_at: '2026-10-13T09:00:00Z',
    updated_at: '2026-10-13T09:00:00Z', is_archived: false, storage_path: `${id}.pdf`,
  };
  state.upload.mockResolvedValue({ data: { path: `${id}.pdf` }, error: null });
  state.remove.mockResolvedValue({ data: [], error: null });
  state.signed.mockResolvedValue({ data: { signedUrl: 'https://storage.example.test/private' }, error: null });
  state.admin.mockImplementation(() => ({
    from: () => {
      let inserted = false;
      const chain = {
        select: vi.fn(() => chain), eq: vi.fn(() => chain), contains: vi.fn(() => chain), or: vi.fn(() => chain), order: vi.fn(() => chain),
        update: vi.fn(() => chain), insert: vi.fn(() => { inserted = true; return chain; }),
        maybeSingle: vi.fn(async () => ({ data: state.row, error: null })),
        single: vi.fn(async () => {
          if (inserted && state.insertError) return { data: null, error: { message: 'Fixture insert failure' } };
          const { storage_path: _path, ...row } = state.row;
          return { data: row, error: null };
        }),
        range: vi.fn(async () => { const { storage_path: _path, ...row } = state.row; return { data: [row], error: null, count: 1 }; }),
      };
      return chain;
    },
    storage: { from: () => ({ upload: state.upload, remove: state.remove, createSignedUrl: state.signed }) },
  }));
});

describe('External Documents server boundaries', () => {
  it('rejects unauthenticated and Level 0 reads without data access', async () => {
    state.userId = null;
    expect((await list(request())).status).toBe(401);
    state.userId = '22222222-2222-4222-8222-222222222222'; state.level = 0;
    expect((await list(request())).status).toBe(403);
    expect(state.admin).not.toHaveBeenCalled();
  });

  it('does not restore actual-admin powers during View As', async () => {
    state.level = 2;
    expect((await create(request('', { method: 'POST' }))).status).toBe(403);
    expect((await update(request(`/${id}`, { method: 'PATCH' }), context)).status).toBe(403);
    expect((await list(request('?options=1'))).status).toBe(403);
    expect(state.admin).not.toHaveBeenCalled();
  });

  it('requires a configured sensitive PIN before data access', async () => {
    state.pin = true;
    expect((await list(request())).status).toBe(428);
    expect((await file(request(`/${id}/file`), context)).status).toBe(428);
    expect(state.admin).not.toHaveBeenCalled();
  });

  it('allows shared active documents but refuses unshared and archived direct file URLs', async () => {
    state.level = 2;
    expect((await detail(request(`/${id}`), context)).status).toBe(200);
    expect((await file(request(`/${id}/file`), context)).status).toBe(200);
    state.signed.mockClear(); state.row.shared_with = [];
    expect((await detail(request(`/${id}`), context)).status).toBe(404);
    expect((await file(request(`/${id}/file`), context)).status).toBe(404);
    state.row.shared_with = [state.userId]; state.row.is_archived = true;
    expect((await file(request(`/${id}/file`), context)).status).toBe(404);
    expect(state.signed).not.toHaveBeenCalled();
  });

  it('allows managers to retrieve archived unshared documents, without exposing storage paths', async () => {
    state.row.shared_with = []; state.row.is_archived = true;
    const response = await detail(request(`/${id}`), context);
    expect(response.status).toBe(200);
    expect(await response.json()).not.toHaveProperty('storage_path');
    expect((await file(request(`/${id}/file`), context)).status).toBe(200);
  });

  it('rejects invalid identifiers and forbidden archive listing', async () => {
    expect((await detail(request('/bad'), { params: Promise.resolve({ id: 'bad' }) })).status).toBe(400);
    state.level = 2;
    expect((await list(request('?archive=all'))).status).toBe(403);
  });

  it('cleans up its newly uploaded object when metadata insert fails', async () => {
    const pdf = await PDFDocument.create(); pdf.addPage();
    const form = new FormData();
    form.set('file', new File([new Uint8Array(await pdf.save())], 'sample.pdf', { type: 'application/pdf' }));
    form.set('metadata', JSON.stringify({ title: 'Sample', category: 'Service record', external_company: 'Sample provider', document_date: '2026-10-13', source_files: ['sample.pdf'] }));
    state.insertError = true;
    const response = await create(request('', { method: 'POST', body: form }));
    expect(response.status).toBe(500);
    expect(state.upload).toHaveBeenCalledOnce();
    expect(state.remove).toHaveBeenCalledWith([state.upload.mock.calls[0][0]]);
  });
});

const ordinaryId = '44444444-4444-4444-8444-444444444444';
const hiddenEmailOnlyId = '55555555-5555-4555-8555-555555555555';
const hiddenEmployeeId = '66666666-6666-4666-8666-666666666666';
const placeholderId = '77777777-7777-4777-8777-777777777777';
const systemId = '88888888-8888-4888-8888-888888888888';

const readerState = vi.hoisted(() => ({
  selects: [] as string[],
  mutations: [] as string[],
  listUsers: vi.fn(),
}));

function profile(id: string, fullName: string, employeeId: string, flags?: { placeholder?: boolean; system?: boolean }) {
  return {
    id,
    full_name: fullName,
    employee_id: employeeId,
    is_placeholder: flags?.placeholder === true,
    is_system_account: flags?.system === true,
    deleted_at: null,
  };
}

const readerProfiles = [
  profile(ordinaryId, 'Ordinary Person', 'EMP100'),
  profile(hiddenEmailOnlyId, 'Email Only Hidden', 'EMP200'),
  profile(hiddenEmployeeId, 'Employee Hidden', 'TS-ADM'),
  profile(placeholderId, 'Placeholder Person', 'EMP300', { placeholder: true }),
  profile(systemId, 'System Person', 'EMP400', { system: true }),
];

function installReaderAdmin(options?: { listUsers?: 'missing' | 'error' | 'paged' }) {
  readerState.selects = [];
  readerState.mutations = [];
  readerState.listUsers.mockReset();
  if (options?.listUsers === 'error') {
    readerState.listUsers.mockResolvedValue({ data: { users: [] }, error: { message: 'auth unavailable' } });
  } else if (options?.listUsers === 'paged') {
    readerState.listUsers.mockImplementation(async ({ page, perPage }: { page: number; perPage: number }) => {
      if (page === 1) {
        return {
          data: {
            users: Array.from({ length: perPage }, (_, index) => ({
              id: `page-one-${index}`,
              email: `person${index}@example.com`,
            })),
          },
          error: null,
        };
      }
      return {
        data: { users: [{ id: hiddenEmailOnlyId, email: 'testsuite-admin@squiresapp.test' }] },
        error: null,
      };
    });
  } else if (options?.listUsers !== 'missing') {
    readerState.listUsers.mockResolvedValue({
      data: { users: [{ id: hiddenEmailOnlyId, email: 'manager@avsworklog.test' }] },
      error: null,
    });
  }

  state.admin.mockImplementation(() => ({
    from: (table: string) => {
      let inserted = false;
      let updated = false;
      const chain = {
        select: vi.fn((columns: string) => {
          readerState.selects.push(`${table}:${columns}`);
          return chain;
        }),
        eq: vi.fn(() => chain),
        is: vi.fn(() => chain),
        or: vi.fn(() => chain),
        order: vi.fn(() => chain),
        contains: vi.fn(() => chain),
        in: vi.fn(async (_column: string, ids: string[]) => {
          if (readerState.selects.some((columns) => columns.includes('email'))) {
            return { data: null, error: { message: 'column profiles.email does not exist' } };
          }
          const allowed = new Set(ids.map((id) => id.toLowerCase()));
          return {
            data: table === 'profiles' ? readerProfiles.filter((row) => allowed.has(row.id.toLowerCase())) : [],
            error: null,
          };
        }),
        limit: vi.fn(async () => {
          if (readerState.selects.some((columns) => columns.includes('email'))) {
            return { data: null, error: { message: 'column profiles.email does not exist' }, count: null };
          }
          return {
            data: table === 'profiles' ? readerProfiles : [],
            error: null,
            count: table === 'profiles' ? readerProfiles.length : 0,
          };
        }),
        insert: vi.fn(() => { inserted = true; readerState.mutations.push('insert'); return chain; }),
        update: vi.fn(() => { updated = true; readerState.mutations.push('update'); return chain; }),
        maybeSingle: vi.fn(async () => ({ data: state.row, error: null })),
        single: vi.fn(async () => {
          if (inserted && state.insertError) return { data: null, error: { message: 'Fixture insert failure' } };
          if (!inserted && !updated) return { data: null, error: { message: 'Unexpected single' } };
          const { storage_path: _path, ...row } = state.row;
          return { data: row, error: null };
        }),
        range: vi.fn(async () => ({ data: [], error: null, count: 0 })),
      };
      return chain;
    },
    auth: options?.listUsers === 'missing' ? { admin: {} } : { admin: { listUsers: readerState.listUsers } },
    storage: { from: () => ({ upload: state.upload, remove: state.remove, createSignedUrl: state.signed }) },
  }));
}

async function uploadForm(sharedWith: string[]) {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const form = new FormData();
  form.set('file', new File([new Uint8Array(await pdf.save())], 'sample.pdf', { type: 'application/pdf' }));
  form.set('metadata', JSON.stringify({
    title: 'Sample',
    category: 'Service record',
    external_company: 'Sample provider',
    document_date: '2026-10-13',
    source_files: ['sample.pdf'],
    shared_with: sharedWith,
  }));
  return form;
}

describe('External Documents reader exclusions', () => {
  it('loads reader options for a level 5 administrator without superadmin or View As privileges', async () => {
    state.superAdmin = false;
    state.level = 5;
    installReaderAdmin();
    const response = await list(request('?options=1'));
    expect(response.status).toBe(200);
    expect((await response.json()).readers).toEqual([{ id: ordinaryId, label: 'Ordinary Person' }]);
    expect(readerState.selects.some((columns) => columns.includes('email'))).toBe(false);
    expect(readerState.mutations).toEqual([]);
  });

  it('returns ordinary readers and excludes placeholder, system, profile, and email-only hidden accounts', async () => {
    installReaderAdmin({ listUsers: 'paged' });
    const response = await list(request('?options=1'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.readers).toEqual([{ id: ordinaryId, label: 'Ordinary Person' }]);
    expect(readerState.listUsers).toHaveBeenCalledTimes(2);
    expect(readerState.selects.some((columns) => columns.includes('email'))).toBe(false);
    expect(readerState.mutations).toEqual([]);
  });

  it('rejects email-only hidden readers on create and update without writing', async () => {
    installReaderAdmin();
    const created = await create(request('', { method: 'POST', body: await uploadForm([hiddenEmailOnlyId]) }));
    expect(created.status).toBe(400);
    const updated = await update(
      request(`/${id}`, { method: 'PATCH', body: JSON.stringify({ shared_with: [hiddenEmailOnlyId] }) }),
      context,
    );
    expect(updated.status).toBe(400);
    expect(state.upload).not.toHaveBeenCalled();
    expect(readerState.mutations).toEqual([]);
    expect(readerState.selects.some((columns) => columns.includes('email'))).toBe(false);
  });

  it('shares with an ordinary reader', async () => {
    installReaderAdmin();
    const created = await create(request('', { method: 'POST', body: await uploadForm([ordinaryId]) }));
    expect(created.status).toBe(201);
    const updated = await update(
      request(`/${id}`, { method: 'PATCH', body: JSON.stringify({ shared_with: [ordinaryId] }) }),
      context,
    );
    expect(updated.status).toBe(200);
    expect(readerState.mutations).toEqual(['insert', 'update']);
  });

  it('fails closed when hidden-account auth enumeration fails', async () => {
    installReaderAdmin({ listUsers: 'error' });
    expect((await list(request('?options=1'))).status).toBe(500);
    installReaderAdmin({ listUsers: 'missing' });
    const created = await create(request('', { method: 'POST', body: await uploadForm([ordinaryId]) }));
    expect(created.status).toBe(500);
    expect(state.upload).not.toHaveBeenCalled();
    expect(readerState.mutations).toEqual([]);
  });


});
