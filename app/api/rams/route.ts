import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getProfileWithRole } from '@/lib/utils/permissions';
import { logServerError } from '@/lib/utils/server-error-logger';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user profile with role
    const profile = await getProfileWithRole(user.id);

    if (!profile) {
      return NextResponse.json({ error: 'Failed to verify user' }, { status: 403 });
    }

    const isManagerOrAdmin = profile.role?.is_manager_admin || false;

    // Get query parameters
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get('status'); // 'pending' | 'signed' | 'all'
    const showAll = searchParams.get('all') === 'true'; // For manage page

    // Managers/Admins requesting all documents (for /rams/manage page)
    if (isManagerOrAdmin && showAll) {
      const { data: documents, error } = await supabase
        .from('rams_documents')
        .select(`
          *,
          uploader:profiles!rams_documents_uploaded_by_fkey(full_name)
        `)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching documents:', error);
        return NextResponse.json(
          { error: 'Failed to fetch documents' },
          { status: 500 }
        );
      }

      // Get assignment stats for each document
      const documentsWithStats = await Promise.all(
        documents.map(async (doc) => {
          const { data: assignments } = await supabase
            .from('rams_assignments')
            .select('status')
            .eq('rams_document_id', doc.id);

          const totalAssigned = assignments?.length || 0;
          const totalSigned = assignments?.filter(a => a.status === 'signed').length || 0;
          const totalPending = assignments?.filter(a => a.status === 'pending' || a.status === 'read').length || 0;

          return {
            ...doc,
            uploader_name: doc.uploader?.full_name || 'Unknown',
            total_assigned: totalAssigned,
            total_signed: totalSigned,
            total_pending: totalPending,
          };
        })
      );

      return NextResponse.json({
        success: true,
        documents: documentsWithStats,
      });
    }

    // All users: Get only assigned documents (default behavior)
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

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/rams',
      additionalData: {
        endpoint: '/api/rams',
      },
    });
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}

