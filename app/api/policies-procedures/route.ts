import { NextRequest } from 'next/server';
import { policyDocumentsRoute } from '@/lib/server/policy-documents';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) { return policyDocumentsRoute(request); }
export async function POST(request: NextRequest) { return policyDocumentsRoute(request); }
