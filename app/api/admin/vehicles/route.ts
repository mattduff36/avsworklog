import { NextRequest } from 'next/server';
import { redirectToLegacyVanEndpoint } from '@/lib/api/error-handler';

export async function GET(request: NextRequest) {
  return redirectToLegacyVanEndpoint(request, '/api/admin/vehicles');
}

export async function POST(request: NextRequest) {
  return redirectToLegacyVanEndpoint(request, '/api/admin/vehicles');
}
