import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument } from 'pdf-lib';

const state = vi.hoisted(() => ({
  userId: '22222222-2222-4222-8222-222222222222' as string | null,
  level: 4,
  pin: false,
  insertError: false,
  row: {} as Record<string, unknown>,
  admin: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  signed: vi.fn(),
}));
vi.mock('@/lib/utils/view-as', () => ({ getEffectiveRole: vi.fn(async () => ({ user_id: state.userId, is_actual_super_admin: true, is_viewing_as: true })) }));
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
