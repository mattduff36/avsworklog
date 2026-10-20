import pg from 'pg';
import { NextRequest, NextResponse } from 'next/server';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { getEffectiveModuleAccessLevel } from '@/lib/utils/rbac';
import { requireSensitiveModuleAccess } from '@/lib/server/sensitive-module-access';
import { createAdminClient } from '@/lib/supabase/admin';
import { handlePolicyRequest, type PolicyContext } from '@/lib/server/policy-documents-service';

export async function policyDocumentsRoute(request: NextRequest, id?: string, file = false) {
  const role = await getEffectiveRole();
  if (!role.user_id) return NextResponse.json({ error: 'Sign in to access policies.' }, { status: 401 });
  const level = await getEffectiveModuleAccessLevel('policies-procedures');
  if (level < 1 || (request.method !== 'GET' && level < 4)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const pin = await requireSensitiveModuleAccess('policies-procedures');
  if (pin) return pin;
  const context: PolicyContext = {
    userId: role.user_id, level,
    async transaction(fn) {
      const connection = process.env.POSTGRES_URL_NON_POOLING;
      if (!connection) throw new Error('Policy document database is not configured.');
      const url = new URL(connection);
      const client = new pg.Client({ host: url.hostname, port: Number(url.port || '5432'), database: url.pathname.slice(1), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), ssl: { rejectUnauthorized: false } });
      await client.connect();
      try {
        await client.query('BEGIN');
        const value = await fn(client);
        await client.query('COMMIT');
        return value;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { await client.end(); }
    },
    async upload(path, bytes, contentType) {
      const { error } = await createAdminClient().storage.from('policies-procedures').upload(path, bytes, { contentType, upsert: false });
      if (error) throw error;
    },
    async remove(path) {
      const { error } = await createAdminClient().storage.from('policies-procedures').remove([path]);
      if (error) throw error;
    },
    async fileUrl(path, name) {
      const { data, error } = await createAdminClient().storage.from('policies-procedures').createSignedUrl(path, 900, { download: name });
      if (error || !data) throw error || new Error('File unavailable');
      return data.signedUrl;
    },
  };
  return handlePolicyRequest(request, context, id, file);
}
