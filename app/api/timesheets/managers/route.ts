import { NextResponse } from 'next/server';
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import type { Database } from '@/types/database';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { logServerError } from '@/lib/utils/server-error-logger';

type Manager = {
  id: string;
  full_name: string;
  email: string | null;
  role: {
    name: string;
    display_name: string;
  } | null;
};

const SUZANNE_EMAIL = 'suzanne@avsquires.co.uk';

function getSupabaseAdmin() {
  return createSupabaseAdmin<Database>(
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

function compareManagers(a: Manager, b: Manager): number {
  if (a.email === SUZANNE_EMAIL) return -1;
  if (b.email === SUZANNE_EMAIL) return 1;
  return (a.full_name || '').localeCompare(b.full_name || '');
}

export async function GET() {
  try {
    // Use effective role (respects View As mode for super admins)
    const effectiveRole = await getEffectiveRole();

    if (!effectiveRole.user_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!effectiveRole.is_manager_admin) {
      return NextResponse.json(
        { error: 'Only managers and admins can view this list' },
        { status: 403 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Query profiles with roles, then get emails from auth.users
    const { data: profilesData, error } = await supabaseAdmin
      .from('profiles')
      .select(`
        id,
        full_name,
        roles!inner(
          name,
          display_name,
          is_manager_admin
        )
      `)
      .eq('roles.is_manager_admin', true)
      .order('full_name');

    if (error) {
      console.error('Error fetching manager/admin profiles:', error);
      return NextResponse.json(
        { error: 'Failed to fetch managers' },
        { status: 500 }
      );
    }

    // Get emails from auth.users for these profiles
    // Fetch each user by ID to avoid pagination limits of listUsers()
    const emailMap = new Map<string, string | null>();
    
    for (const profile of profilesData ?? []) {
      try {
        const { data: { user }, error: userError } = await supabaseAdmin.auth.admin.getUserById(profile.id);
        if (!userError && user?.email) {
          emailMap.set(profile.id, user.email);
        } else {
          console.error(`Error fetching email for user ${profile.id}:`, userError);
          emailMap.set(profile.id, null);
        }
      } catch (err) {
        console.error(`Exception fetching email for user ${profile.id}:`, err);
        emailMap.set(profile.id, null);
      }
    }

    // Merge profiles with emails
    const data = (profilesData ?? []).map((profile) => ({
      ...profile,
      email: emailMap.get(profile.id) || null,
    }));

    const rawManagers = (data ?? []) as Array<{
      id: string;
      full_name: string;
      email: string | null;
      roles: { name: string; display_name: string; is_manager_admin: boolean } | null;
    }>;

    // Transform to a clean payload for the client
    const managers: Manager[] = rawManagers.map((m) => ({
      id: m.id,
      full_name: m.full_name,
      email: m.email,
      role: m.roles
        ? {
            name: m.roles.name,
            display_name: m.roles.display_name,
          }
        : null,
    }));

    // Ensure Suzanne Squires is first in the response
    managers.sort(compareManagers);

    return NextResponse.json({ managers });
  } catch (error) {
    console.error('Unexpected error fetching managers:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/timesheets/managers',
      additionalData: {
        endpoint: '/api/timesheets/managers',
      },
    });
    return NextResponse.json(
      { error: 'Failed to fetch managers' },
      { status: 500 }
    );
  }
}
