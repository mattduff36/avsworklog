import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getProfileWithRole } from '@/lib/utils/permissions';
import { logServerError } from '@/lib/utils/server-error-logger';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const db = supabase as unknown as { from: (table: string) => any };

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

    // Managers/Admins requesting all documents (for /projects/manage page)
    if (isManagerOrAdmin && showAll) {
      const q = searchParams.get('q')?.trim() || '';
      const typeFilter = searchParams.get('type') || '';
      const signatureFilter = searchParams.get('signature') || '';
      const sortBy = searchParams.get('sortBy') || 'created_at';
      const sortDir = searchParams.get('sortDir') || 'desc';
      const limit = Math.min(Number(searchParams.get('limit')) || 50, 200);
      const offset = Math.max(Number(searchParams.get('offset')) || 0, 0);

      // Base query for documents
      let docsQuery = db
        .from('rams_documents')
        .select(`
          *,
          uploader:profiles!rams_documents_uploaded_by_fkey(full_name),
          document_type:project_document_types(id, name, required_signature)
        `, { count: 'exact' })
        .eq('is_active', true);

      // Server-side text search
      if (q) {
        docsQuery = docsQuery.or(`title.ilike.%${q}%,description.ilike.%${q}%`);
      }

      // Document type filter
      if (typeFilter) {
        docsQuery = docsQuery.eq('document_type_id', typeFilter);
      }

      // Sort
      const ascending = sortDir === 'asc';
      switch (sortBy) {
        case 'title':
          docsQuery = docsQuery.order('title', { ascending });
          break;
        case 'created_at':
        default:
          docsQuery = docsQuery.order('created_at', { ascending });
          break;
      }

      // Pagination
      docsQuery = docsQuery.range(offset, offset + limit - 1);

      const { data: documents, error, count: totalCount } = await docsQuery;

      if (error) {
        console.error('Error fetching documents:', error);
        return NextResponse.json(
          { error: 'Failed to fetch documents' },
          { status: 500 }
        );
      }

      const typedDocuments = (documents || []) as Array<{
        id: string;
        uploader?: { full_name?: string | null } | null;
        document_type?: { id: string; name: string; required_signature?: boolean | null } | null;
      } & Record<string, unknown>>;
      const docIds = typedDocuments.map((d) => d.id);

      // Batch-fetch all assignment stats in one query instead of N+1
      const { data: allAssignments } = docIds.length > 0
        ? await db
            .from('rams_assignments')
            .select('rams_document_id, status')
            .in('rams_document_id', docIds)
        : { data: [] as { rams_document_id: string; status: string }[] };

      const statsMap = new Map<string, { assigned: number; signed: number; pending: number }>();
      for (const a of allAssignments || []) {
        const entry = statsMap.get(a.rams_document_id) || { assigned: 0, signed: 0, pending: 0 };
        entry.assigned++;
        if (a.status === 'signed') entry.signed++;
        if (a.status === 'pending' || a.status === 'read') entry.pending++;
        statsMap.set(a.rams_document_id, entry);
      }

      // Check which docs are favourited by this user
      const { data: userFavs } = docIds.length > 0
        ? await db
            .from('project_favourites')
            .select('document_id')
            .eq('user_id', user.id)
            .in('document_id', docIds)
        : { data: [] as { document_id: string }[] };

      const favSet = new Set(((userFavs || []) as Array<{ document_id: string }>).map((f) => f.document_id));

      let documentsWithStats = typedDocuments.map((doc) => {
        const stats = statsMap.get(doc.id) || { assigned: 0, signed: 0, pending: 0 };
        const reqSig = doc.document_type?.required_signature ?? true;
        return {
          ...doc,
          uploader_name: doc.uploader?.full_name || 'Unknown',
          total_assigned: stats.assigned,
          total_signed: stats.signed,
          total_pending: stats.pending,
          document_type_name: doc.document_type?.name || null,
          required_signature: reqSig,
          is_favourite: favSet.has(doc.id),
        };
      });

      // Post-filter: signature type (needs the joined field)
      if (signatureFilter === 'required') {
        documentsWithStats = documentsWithStats.filter(d => d.required_signature);
      } else if (signatureFilter === 'read-only') {
        documentsWithStats = documentsWithStats.filter(d => !d.required_signature);
      }

      // Post-sort by uploader or completion (requires joined data)
      if (sortBy === 'uploader') {
        documentsWithStats.sort((a, b) => {
          const cmp = a.uploader_name.localeCompare(b.uploader_name);
          return ascending ? cmp : -cmp;
        });
      } else if (sortBy === 'completion') {
        documentsWithStats.sort((a, b) => {
          const pctA = a.total_assigned ? a.total_signed / a.total_assigned : 0;
          const pctB = b.total_assigned ? b.total_signed / b.total_assigned : 0;
          return ascending ? pctA - pctB : pctB - pctA;
        });
      }

      // Compute category counts (unfiltered, for stat cards)
      const { data: allDocs } = await db
        .from('rams_documents')
        .select('id, created_at, document_type_id, document_type:project_document_types(required_signature)')
        .eq('is_active', true);

      const now = Date.now();
      const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
      const counts = {
        all: allDocs?.length || 0,
        needs_signature: allDocs?.filter((d: { document_type?: { required_signature?: boolean } | null }) => d.document_type?.required_signature !== false).length || 0,
        read_only: allDocs?.filter((d: { document_type?: { required_signature?: boolean } | null }) => d.document_type?.required_signature === false).length || 0,
        recently_uploaded: allDocs?.filter((d: { created_at: string }) => new Date(d.created_at).getTime() > sevenDaysAgo).length || 0,
      };

      return NextResponse.json({
        success: true,
        documents: documentsWithStats,
        counts,
        total: totalCount ?? documentsWithStats.length,
      });
    }

    // All users: Get only assigned documents (default behavior)
    let query = db
      .from('rams_assignments')
      .select(`
        *,
        document:rams_documents!rams_assignments_rams_document_id_fkey(
          *,
          document_type:project_document_types(id, name, required_signature)
        )
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
    const typedAssignments = (assignments || []) as Array<{
      id: string;
      status: string;
      assigned_at: string | null;
      signed_at: string | null;
      document: Record<string, unknown> | null;
    }>;
    const documents = typedAssignments.map((assignment) => {
      const doc = assignment.document as {
        document_type?: { name?: string; required_signature?: boolean };
      } & Record<string, unknown>;
      return {
        ...doc,
        assignment_id: assignment.id,
        assignment_status: assignment.status,
        assigned_at: assignment.assigned_at,
        signed_at: assignment.signed_at,
        document_type_name: doc?.document_type?.name || null,
        required_signature: doc?.document_type?.required_signature ?? true,
      };
    });

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

