import { NextRequest } from 'next/server';
import { redirectToLegacyVanEndpointById } from '@/lib/api/error-handler';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return redirectToLegacyVanEndpointById(request, { params });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return redirectToLegacyVanEndpointById(request, { params });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return redirectToLegacyVanEndpointById(request, { params });
}
