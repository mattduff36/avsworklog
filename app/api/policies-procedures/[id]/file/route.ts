import { NextRequest } from 'next/server';
import { policyDocumentsRoute } from '@/lib/server/policy-documents';
export const runtime = 'nodejs';
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) { return policyDocumentsRoute(request, (await context.params).id, true); }
