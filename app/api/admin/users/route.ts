import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { generateSecurePassword, validatePasswordStrength } from '@/lib/utils/password';
import { sendPasswordEmail } from '@/lib/utils/email';

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
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (!profile || profile.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    // Get request body
    const body = await request.json();
    const { email, full_name, employee_id, role } = body;

    // Validate required fields (password is now auto-generated)
    if (!email || !full_name) {
      return NextResponse.json(
        { error: 'Email and full name are required' },
        { status: 400 }
      );
    }

    // Validate role
    const validRoles = ['admin', 'manager', 'employee'];
    if (!validRoles.includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }

    // Generate secure random password
    const temporaryPassword = generateSecurePassword();
    console.log('Generated temporary password for', email);

    // Create auth user
    const supabaseAdmin = getSupabaseAdmin();
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: temporaryPassword,
      email_confirm: true, // Auto-confirm email
      user_metadata: {
        full_name,
      },
    });

    if (authError) {
      console.error('Auth error:', authError);
      return NextResponse.json({ error: authError.message }, { status: 400 });
    }

    if (!authData.user) {
      return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
    }

    // Update profile with additional data and set must_change_password flag
    const { error: profileError } = await supabase
      .from('profiles')
      .update({
        full_name,
        employee_id: employee_id || null,
        role,
        must_change_password: true, // Force password change on first login
      })
      .eq('id', authData.user.id);

    if (profileError) {
      console.error('Profile error:', profileError);
      // Try to delete the auth user if profile update fails
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      return NextResponse.json({ error: 'Failed to create user profile' }, { status: 500 });
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
        role,
      },
      temporaryPassword, // Return password to show admin
      emailSent: emailResult.success,
    });
  } catch (error) {
    console.error('Error creating user:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

