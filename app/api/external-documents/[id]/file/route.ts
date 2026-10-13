import { NextRequest } from 'next/server';
import { getExternalDocumentFile } from '@/lib/server/external-documents';

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  return getExternalDocumentFile(request, id);
}
