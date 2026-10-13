import { NextRequest } from 'next/server';
import { getExternalDocument, updateExternalDocument } from '@/lib/server/external-documents';

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  return getExternalDocument(request, id);
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  return updateExternalDocument(request, id);
}
