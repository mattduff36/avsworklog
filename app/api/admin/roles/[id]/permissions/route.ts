import { NextResponse } from 'next/server';

/**
 * PUT /api/admin/roles/[id]/permissions
 * Deprecated: use the team permission matrix instead.
 */
export async function PUT() {
  return NextResponse.json(
    {
      error: 'Role-based module permissions have been retired. Use the team permission matrix instead.',
    },
    { status: 410 }
  );
}

