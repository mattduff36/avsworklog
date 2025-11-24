import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { generateSecurePassword, validatePasswordStrength } from '@/lib/utils/password';
import { sendPasswordEmail } from '@/lib/utils/email';
import { getProfileWithRole } from '@/lib/utils/permissions';

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
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    // Get request body
    const body = await request.json();
    const { email, full_name, phone_number, employee_id, role_id } = body;

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
      .select('id')
      .eq('id', role_id)
      .single();

    if (roleError || !roleData) {
      console.error('Invalid role_id:', role_id, roleError);
      return NextResponse.json({ 
        error: 'Invalid role selected. Please select a valid role.',
        details: roleError?.message || 'Role not found'
      }, { status: 400 });
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

    // Wait a moment for the trigger to create the profile
    await new Promise(resolve => setTimeout(resolve, 500));

    // Get the role name from the roles table (required for CHECK constraint)
    const { data: roleData, error: roleLookupError } = await supabaseAdmin
      .from('roles')
      .select('name')
      .eq('id', role_id)
      .single();

    if (roleLookupError || !roleData) {
      console.error('Failed to lookup role name:', roleLookupError);
      // Try to delete the auth user if we can't get role name
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      return NextResponse.json({ 
        error: 'Invalid role selected',
        details: roleLookupError?.message || 'Role not found'
      }, { status: 400 });
    }

    // Upsert profile with additional data and set must_change_password flag
    // Use admin client to bypass RLS policies
    // Use upsert in case trigger hasn't created profile yet
    // IMPORTANT: Must set both role_id AND role (role is required by CHECK constraint)
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .upsert({
        id: authData.user.id,
        full_name,
        phone_number: phone_number || null,
        employee_id: employee_id || null,
        role_id,
        role: roleData.name, // Set role field from roles table (required by CHECK constraint)
        must_change_password: true, // Force password change on first login
      }, {
        onConflict: 'id'
      });

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
    });
  } catch (error) {
    console.error('Error creating user:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

