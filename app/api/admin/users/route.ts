import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateSecurePassword } from '@/lib/utils/password';
import { sendPasswordEmail } from '@/lib/utils/email';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { canEffectiveRoleAccessModule, canEffectiveRoleAssignRole } from '@/lib/utils/rbac';
import { logServerError } from '@/lib/utils/server-error-logger';
import { isMissingTeamManagerSchemaError, reconcileProfileHierarchy } from '@/lib/server/team-managers';

function isMissingHierarchySchemaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String((error as { code?: unknown }).code || '') : '';
  const message = 'message' in error ? String((error as { message?: unknown }).message || '').toLowerCase() : '';
  return (
    code === '42703' ||
    code === '42P01' ||
    message.includes('line_manager_id') ||
    message.includes('team_id') ||
    message.includes('column') ||
    message.includes('does not exist')
  );
}

async function validateHierarchyReferences(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  input: { line_manager_id?: string | null; team_id?: string | null; profile_id?: string }
): Promise<{ ok: boolean; error?: string; warning?: string }> {
  const { line_manager_id, team_id, profile_id } = input;

  if (profile_id && line_manager_id && profile_id === line_manager_id) {
    return { ok: false, error: 'A user cannot be their own line manager.' };
  }

  if (line_manager_id) {
    const { data: managerRow, error: managerError } = await supabaseAdmin
      .from('profiles')
      .select('id, role:roles(role_class)')
      .eq('id', line_manager_id)
      .single();

    if (managerError || !managerRow) {
      return { ok: false, error: 'Selected line manager does not exist.' };
    }

    const roleClass = (managerRow as { role?: { role_class?: string } | null })?.role?.role_class;
    if (roleClass !== 'manager' && roleClass !== 'admin') {
      return { ok: false, error: 'Selected line manager must have a manager/admin role.' };
    }
  }

  if (team_id) {
    const { data: teamRow, error: teamError } = await supabaseAdmin
      .from('org_teams')
      .select('id')
      .eq('id', team_id)
      .single();

    if (teamError) {
      if (isMissingHierarchySchemaError(teamError)) {
        return { ok: true, warning: 'Team validation skipped because hierarchy schema is not ready yet.' };
      }
      return { ok: false, error: 'Failed to validate selected team.' };
    }
    if (!teamRow) {
      return { ok: false, error: 'Selected team does not exist.' };
    }
  }

  return { ok: true };
}

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

export async function POST(request: NextRequest) {
  try {
    // Check effective role (respects View As mode)
    const effectiveRole = await getEffectiveRole();

    if (!effectiveRole.user_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canAccessUserAdmin = await canEffectiveRoleAccessModule('admin-users');
    if (!canAccessUserAdmin) {
      return NextResponse.json({ error: 'Forbidden: admin-users access required' }, { status: 403 });
    }

    // Get request body
    const body = await request.json();
    const { email, full_name, phone_number, employee_id, role_id, line_manager_id, team_id } = body;

    // Validate required fields (password is now auto-generated)
    if (!email || !full_name) {
      return NextResponse.json(
        { error: 'Email and full name are required' },
        { status: 400 }
      );
    }

    // Validate role_id
    if (!role_id) {
      return NextResponse.json({ error: 'Role is required' }, { status: 400 });
    }

    // Validate role_id is a valid UUID and exists in database
    const supabaseAdmin = getSupabaseAdmin();
    const { data: roleData, error: roleError } = await supabaseAdmin
      .from('roles')
      .select('id, name')
      .eq('id', role_id)
      .single();

    if (roleError || !roleData) {
      console.error('Invalid role_id:', role_id, roleError);
      return NextResponse.json({ 
        error: 'Invalid role selected. Please select a valid role.',
        details: roleError?.message || 'Role not found'
      }, { status: 400 });
    }

    const canAssignRequestedRole = await canEffectiveRoleAssignRole(role_id);
    if (!canAssignRequestedRole) {
      return NextResponse.json(
        { error: 'Forbidden: you cannot assign this role' },
        { status: 403 }
      );
    }

    const hierarchyValidation = await validateHierarchyReferences(supabaseAdmin, {
      line_manager_id: line_manager_id || null,
      team_id: team_id || null,
    });
    if (!hierarchyValidation.ok) {
      return NextResponse.json(
        {
          error: hierarchyValidation.error || 'Invalid hierarchy assignment',
          code: 'INVALID_HIERARCHY_ASSIGNMENT',
        },
        { status: 400 }
      );
    }

    // Generate secure random password
    const temporaryPassword = generateSecurePassword();
    console.log('Generated temporary password for', email);

    // Create auth user
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: temporaryPassword,
      email_confirm: true, // Auto-confirm email
      user_metadata: {
        full_name,
        role_id: role_id, // Pass role_id as string to trigger function
        employee_id: employee_id || null,
      },
    });

    if (authError) {
      console.error('Auth error:', authError);
      console.error('Auth error details:', JSON.stringify(authError, null, 2));
      return NextResponse.json({ 
        error: authError.message || 'Failed to create auth user',
        details: authError.code || 'unknown_error'
      }, { status: 400 });
    }

    if (!authData.user) {
      return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
    }

    const selfManagerValidation = await validateHierarchyReferences(supabaseAdmin, {
      profile_id: authData.user.id,
      line_manager_id: line_manager_id || null,
      team_id: team_id || null,
    });
    if (!selfManagerValidation.ok) {
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      return NextResponse.json(
        { error: selfManagerValidation.error || 'Invalid hierarchy assignment', code: 'INVALID_HIERARCHY_ASSIGNMENT' },
        { status: 400 }
      );
    }

    // Wait a moment for the trigger to create the profile
    await new Promise(resolve => setTimeout(resolve, 500));

    // Upsert profile with additional data and set must_change_password flag
    // Use admin client to bypass RLS policies
    // Use upsert in case trigger hasn't created profile yet
    const baseProfilePayload = {
      id: authData.user.id,
      full_name,
      phone_number: phone_number || null,
      employee_id: employee_id || null,
      role_id,
      must_change_password: true,
    };

    const hierarchyProfilePayload = {
      ...baseProfilePayload,
      line_manager_id: line_manager_id || null,
      team_id: team_id || null,
    };

    let hierarchyFieldsPersisted = true;
    let hierarchyWarning: string | null = null;

    let { error: profileError } = await supabaseAdmin
      .from('profiles')
      .upsert(hierarchyProfilePayload, {
        onConflict: 'id'
      });

    if (profileError && isMissingHierarchySchemaError(profileError)) {
      hierarchyFieldsPersisted = false;
      hierarchyWarning = 'Hierarchy fields were ignored because the database schema is not ready yet.';
      const fallbackResult = await supabaseAdmin
        .from('profiles')
        .upsert(baseProfilePayload, { onConflict: 'id' });
      profileError = fallbackResult.error;
    }

    if (profileError) {
      console.error('Profile error:', profileError);
      console.error('Profile error details:', JSON.stringify(profileError, null, 2));
      // Try to delete the auth user if profile update fails
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      return NextResponse.json({ 
        error: profileError.message || 'Database error creating new user',
        details: profileError.details || 'Failed to create user profile',
        code: profileError.code || profileError.hint || 'unknown_error'
      }, { status: 500 });
    }

    if (hierarchyFieldsPersisted) {
      try {
        await reconcileProfileHierarchy(supabaseAdmin, authData.user.id);
      } catch (error) {
        if (!isMissingTeamManagerSchemaError(error) && !isMissingHierarchySchemaError(error)) {
          await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
          return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to reconcile hierarchy assignments' },
            { status: 500 }
          );
        }
      }
    }

    // Send email to user with temporary password
    const emailResult = await sendPasswordEmail({
      to: email,
      userName: full_name,
      temporaryPassword,
      isReset: false,
    });

    if (!emailResult.success) {
      console.warn('Failed to send welcome email:', emailResult.error);
      // Don't fail the user creation if email fails - just log it
    }

    return NextResponse.json({
      success: true,
      user: {
        id: authData.user.id,
        email: authData.user.email,
        full_name,
        employee_id,
        role_id,
      },
      temporaryPassword, // Return password to show admin
      emailSent: emailResult.success,
      hierarchyFieldsPersisted,
      hierarchyWarning: hierarchyWarning || hierarchyValidation.warning || selfManagerValidation.warning || null,
    });
  } catch (error) {
    console.error('Error creating user:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/users',
      additionalData: {
        endpoint: '/api/admin/users',
      },
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

