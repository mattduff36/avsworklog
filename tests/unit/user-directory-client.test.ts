import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchUserDirectory } from '@/lib/client/user-directory';

describe('fetchUserDirectory', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches all pages by default', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          users: [{ id: 'user-1', full_name: 'Alex Able', employee_id: 'E001' }],
          pagination: { has_more: true },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          users: [{ id: 'user-2', full_name: 'Blake Baker', employee_id: 'E002' }],
          pagination: { has_more: false },
        }),
      } as Response);

    const users = await fetchUserDirectory({ includeRole: true });

    expect(users).toEqual([
      { id: 'user-1', full_name: 'Alex Able', employee_id: 'E001' },
      { id: 'user-2', full_name: 'Blake Baker', employee_id: 'E002' },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/api/users/directory?includeRole=true&limit=500&offset=0');
    expect(fetchMock.mock.calls[1]?.[0]).toContain('/api/users/directory?includeRole=true&limit=500&offset=500');
  });

  it('preserves single-page behavior when limit or offset is provided', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        users: [{ id: 'user-3', full_name: 'Casey Cole', employee_id: 'E003' }],
      }),
    } as Response);

    const users = await fetchUserDirectory({ limit: 25, offset: 50 });

    expect(users).toEqual([
      { id: 'user-3', full_name: 'Casey Cole', employee_id: 'E003' },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/api/users/directory?limit=25&offset=50');
  });
});
