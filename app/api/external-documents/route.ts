import { NextRequest } from 'next/server';
import { createExternalDocument, listExternalDocuments } from '@/lib/server/external-documents';

export async function GET(request: NextRequest) {
  return listExternalDocuments(request);
}

export async function POST(request: NextRequest) {
  return createExternalDocument(request);
}
