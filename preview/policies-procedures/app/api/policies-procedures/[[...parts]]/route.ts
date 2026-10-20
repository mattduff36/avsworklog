import { NextRequest } from 'next/server';
import { localRoute } from '../../../local-store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ parts?: string[] }> };
async function route(request: NextRequest, context: Context) {
  const parts = (await context.params).parts || [];
  return localRoute(request, parts[0], parts[1] === 'file');
}
export { route as GET, route as POST, route as PATCH };
