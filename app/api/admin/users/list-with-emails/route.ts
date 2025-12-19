import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getProfileWithRole } from '@/lib/utils/permissions';
import { logServerError } from '@/lib/utils/server-error-logger';

// Helper to create admin client with service role key
function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

export async function GET() {
  try {
    // Check if requester is admin
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is admin
    const profile = await getProfileWithRole(user.id);

    if (!profile || profile.role?.name !== 'admin') {
      return NextResponse.json(
        { error: 'Forbidden: Admin access required' },
        { status: 403 }
      );
    }

    // Get all auth users with emails
    const supabaseAdmin = getSupabaseAdmin();
    const { data: authUsers, error: authError } = await supabaseAdmin.auth.admin.listUsers();

    if (authError) {
      console.error('Error fetching auth users:', authError);
      return NextResponse.json(
        { error: 'Failed to fetch users' },
        { status: 500 }
      );
    }

    // Return users with id and email
    const usersWithEmails = authUsers.users.map(u => ({
      id: u.id,
      email: u.email
    }));

    return NextResponse.json({ users: usersWithEmails });
  } catch (error) {
    console.error('Error in list-with-emails:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/users/list-with-emails',
      additionalData: {
        endpoint: '/api/admin/users/list-with-emails',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

