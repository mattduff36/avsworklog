import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createSupabaseQueryMock } from '@/tests/utils/supabase-query-mock';

const mocks = vi.hoisted(() => ({
  user: vi.fn(), visible: vi.fn(), service: vi.fn(), from: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: mocks.user }, from: mocks.visible }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.service }));
import { POST } from '@/app/api/inspection-photos/route';

const query = <T>(data: T, error: unknown = null) =>
  createSupabaseQueryMock({ data, error }, ['select', 'eq', 'in', 'order']);
const photo = {
  id: 'photo', inspection_id: 'deleted-check', item_number: 1, day_of_week: 1,
  photo_url: 'https://fixture.test/photo.jpg', caption: 'Retained evidence', created_at: '2026-11-10T10:00:00Z',
};
const request = () => new NextRequest('http://localhost/api/inspection-photos', {
  method: 'POST', body: JSON.stringify({ taskIds: ['allowed-task', 'hidden-task'] }),
});

describe('Retained workshop inspection-photo access', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.user.mockResolvedValue({ data: { user: { id: 'actor' } }, error: null });
    mocks.visible.mockReturnValue(query([{ id: 'allowed-task' }]));
    mocks.service.mockReturnValue({ from: mocks.from });
  });
  it('rejects missing identity without any privileged evidence query', async () => {
    mocks.user.mockResolvedValue({ data: { user: null }, error: null });
    expect((await POST(request())).status).toBe(401);
    expect(mocks.service).not.toHaveBeenCalled();
  });
  it('never looks up retained evidence for an invisible task', async () => {
    mocks.visible.mockReturnValue(query([]));
    expect(await (await POST(request())).json()).toEqual({ photosByTask: {} });
    expect(mocks.service).not.toHaveBeenCalled();
  });
  it('returns retained photos for a detached, visible inspection-defect task', async () => {
    const tasks = query([{ id: 'allowed-task', action_type: 'inspection_defect', inspection_id: null, inspection_item_id: null }]);
    const retained = query([{ ...photo, task_id: 'allowed-task' }]);
    mocks.from.mockReturnValueOnce(tasks).mockReturnValueOnce(retained);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ photosByTask: { 'allowed-task': [photo] } });
    expect(tasks.in).toHaveBeenCalledWith('id', ['allowed-task']);
    expect(tasks.eq).toHaveBeenCalledWith('action_type', 'inspection_defect');
    expect(retained.in).toHaveBeenCalledWith('task_id', ['allowed-task']);
  });
  it('does not expose retained evidence for another task type', async () => {
    mocks.from.mockReturnValue(query([]));
    expect(await (await POST(request())).json()).toEqual({ photosByTask: {} });
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });
  it('merges live and retained photos without duplicates', async () => {
    const live = { ...photo, id: 'live', inspection_id: 'live-check' };
    mocks.from
      .mockReturnValueOnce(query([{ id: 'allowed-task', action_type: 'inspection_defect', inspection_id: 'live-check', inspection_item_id: 'item' }]))
      .mockReturnValueOnce(query([{ ...photo, task_id: 'allowed-task' }, { ...live, task_id: 'allowed-task' }]))
      .mockReturnValueOnce(query([{ id: 'item', inspection_id: 'live-check', item_number: 1, day_of_week: 1 }]))
      .mockReturnValueOnce(query([live]));
    const body = await (await POST(request())).json();
    expect(body.photosByTask['allowed-task']).toHaveLength(2);
    expect(body.photosByTask['allowed-task']).toEqual(expect.arrayContaining([photo, live]));
  });
  it('does not silently omit retained evidence on query failure', async () => {
    mocks.from
      .mockReturnValueOnce(query([{ id: 'allowed-task', action_type: 'inspection_defect', inspection_id: null, inspection_item_id: null }]))
      .mockReturnValueOnce(query(null, { message: 'private details' }));
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('private details');
  });
});
