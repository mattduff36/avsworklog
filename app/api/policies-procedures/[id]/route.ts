import { NextRequest } from 'next/server';
import { policyDocumentsRoute } from '@/lib/server/policy-documents';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, context: Context) { return policyDocumentsRoute(request, (await context.params).id); }
export async function PATCH(request: NextRequest, context: Context) { return policyDocumentsRoute(request, (await context.params).id); }
