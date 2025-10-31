import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, role, full_name')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: 'Failed to verify user' }, { status: 403 });
    }

    // Get query parameters
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get('status'); // 'pending' | 'signed' | 'all'

    // All users (including managers/admins): Get only assigned documents
    // The /rams/manage page has separate logic for viewing all documents
    let query = supabase
      .from('rams_assignments')
      .select(`
        *,
        document:rams_documents!rams_assignments_rams_document_id_fkey(*)
      `)
      .eq('employee_id', user.id);

    // Filter by status if provided
    if (status === 'pending') {
      query = query.in('status', ['pending', 'read']);
    } else if (status === 'signed') {
      query = query.eq('status', 'signed');
    }

    query = query.order('assigned_at', { ascending: false });

    const { data: assignments, error } = await query;

    if (error) {
      console.error('Error fetching assignments:', error);
      return NextResponse.json(
        { error: 'Failed to fetch assignments' },
        { status: 500 }
      );
    }

    // Transform data to include document details
    const documents = assignments?.map(assignment => ({
      ...assignment.document,
      assignment_id: assignment.id,
      assignment_status: assignment.status,
      assigned_at: assignment.assigned_at,
      signed_at: assignment.signed_at,
    })) || [];

    return NextResponse.json({
      success: true,
      documents,
    });
  } catch (error) {
    console.error('Unexpected error in GET /api/rams:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}

