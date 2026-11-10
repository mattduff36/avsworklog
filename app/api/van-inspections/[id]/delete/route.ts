import { NextRequest } from 'next/server';
import { handleInspectionDeletion } from '@/lib/server/inspection-deletion-route';

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleInspectionDeletion(request, params, 'van');
}
