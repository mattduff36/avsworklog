import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getEffectiveRole } from '@/lib/utils/view-as';

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
    // Check effective role (respects View As mode)
    const effectiveRole = await getEffectiveRole();

    if (!effectiveRole.user_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!effectiveRole.is_manager_admin) {
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
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

