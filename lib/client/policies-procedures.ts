import type { PolicyAdapter } from '@/lib/policies-procedures/schema';

export function policyHttpAdapter(headers: Record<string, string> = {}): PolicyAdapter {
  const base = '/api/policies-procedures';
  async function request(path = '', init?: RequestInit) {
    const response = await fetch(`${base}${path}`, { ...init, cache: 'no-store', headers: { ...headers, ...init?.headers } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to load policies.');
    return result;
  }
  return {
    async list() { return (await request()).documents; },
    async versions(id) { return (await request(`/${id}`)).documents; },
    async upload(file, metadata) {
      const form = new FormData(); form.set('file', file); form.set('metadata', JSON.stringify(metadata));
      await request('', { method: 'POST', body: form });
    },
    async action(id, action) { await request(`/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action) }); },
    async file(id, versionId) { return (await request(`/${id}/file?version=${versionId}`)).url; },
  };
}
