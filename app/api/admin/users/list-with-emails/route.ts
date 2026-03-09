import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';

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
    const canAccessUserAdmin = await canEffectiveRoleAccessModule('admin-users');
    if (!canAccessUserAdmin) {
      return NextResponse.json(
        { error: 'Forbidden: admin-users access required' },
        { status: 403 }
      );
    }

    // Fetch ALL auth users by paginating (default page size is 50)
    const supabaseAdmin = getSupabaseAdmin();
    const allUsers: { id: string; email: string | undefined }[] = [];
    let page = 1;
    const perPage = 1000;

    while (true) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });

      if (error) {
        console.error('Error fetching auth users (page ' + page + '):', error);
        return NextResponse.json(
          { error: 'Failed to fetch users' },
          { status: 500 }
        );
      }

      for (const u of data.users) {
        allUsers.push({ id: u.id, email: u.email });
      }

      if (data.users.length < perPage) break;
      page++;
    }

    const usersWithEmails = allUsers;

    return NextResponse.json({ users: usersWithEmails });
  } catch (error) {
    console.error('Error in list-with-emails:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

