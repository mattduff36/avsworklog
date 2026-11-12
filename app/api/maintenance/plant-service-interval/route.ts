import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { isEffectiveRoleManagerOrHigher } from '@/lib/utils/rbac';
import { AssetServiceError, plantServiceInterval } from '@/lib/server/asset-service';

const idSchema = z.string().uuid();
const updateSchema = z.object({ plantId: idSchema, intervalHours: z.number().int().min(1).max(1000000).nullable() }).strict();

async function handle(request: NextRequest, update: boolean) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!await isEffectiveRoleManagerOrHigher()) return NextResponse.json({ error: 'Manager or admin required' }, { status: 403 });
  try {
    if (update) {
      const parsed = updateSchema.safeParse(await request.json());
      if (!parsed.success) return NextResponse.json({ error: 'Provide a Plant ID and a whole-number interval from 1 to 1000000, or null for the global interval' }, { status: 400 });
      return NextResponse.json(await plantServiceInterval(parsed.data.plantId, { intervalHours: parsed.data.intervalHours, actorId: user.id }));
    }
    const parsed = idSchema.safeParse(request.nextUrl.searchParams.get('plantId'));
    if (!parsed.success) return NextResponse.json({ error: 'Invalid Plant ID' }, { status: 400 });
    return NextResponse.json(await plantServiceInterval(parsed.data));
  } catch (error) {
    const status = error instanceof AssetServiceError ? error.status : error instanceof SyntaxError ? 400 : 500;
    return NextResponse.json({ error: error instanceof AssetServiceError ? error.message : 'Unable to load or save Plant service interval' }, { status });
  }
}
export const GET = (request: NextRequest) => handle(request, false);
export const PUT = (request: NextRequest) => handle(request, true);
