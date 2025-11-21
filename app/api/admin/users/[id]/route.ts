import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { sendProfileUpdateEmail } from '@/lib/utils/email';

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

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
      return NextResponse.json(
        { error: 'Forbidden: Admin access required' },
        { status: 403 }
      );
    }

    const userId = (await params).id;
    const body = await request.json();
    const { email, full_name, phone_number, employee_id, role_id } = body;

    // Validate required fields
    if (!full_name) {
      return NextResponse.json(
        { error: 'Full name is required' },
        { status: 400 }
      );
    }

    // Validate role_id
    if (!role_id) {
      return NextResponse.json({ error: 'Role is required' }, { status: 400 });
    }

    // Fetch existing user data for change tracking and email notification
    const { data: existingUser, error: fetchError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (fetchError || !existingUser) {
      console.error('Error fetching existing user:', fetchError);
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Get existing email from auth
    const supabaseAdmin = getSupabaseAdmin();
    const { data: existingAuthUser } = await supabaseAdmin.auth.admin.getUserById(userId);
    const existingEmail = existingAuthUser?.user?.email || '';

    // Track changes for email notification
    const changes: any = {};
    if (email && email !== existingEmail) {
      changes.email = { old: existingEmail, new: email };
    }
    if (full_name !== existingUser.full_name) {
      changes.full_name = { old: existingUser.full_name, new: full_name };
    }
    if (phone_number !== existingUser.phone_number) {
      changes.phone_number = { old: existingUser.phone_number || '', new: phone_number || '' };
    }
    if (employee_id !== existingUser.employee_id) {
      changes.employee_id = { old: existingUser.employee_id || '', new: employee_id || '' };
    }
    if (role !== existingUser.role) {
      changes.role = { old: existingUser.role, new: role };
    }

    // Update email in auth if it changed
    if (email) {
      const { error: emailError } = await supabaseAdmin.auth.admin.updateUserById(
        userId,
        { email }
      );

      if (emailError) {
        console.error('Email update error:', emailError);
        return NextResponse.json(
          { error: `Failed to update email: ${emailError.message}` },
          { status: 400 }
        );
      }
    }

    // Update profile data (email is only in auth, not in profiles table)
    const { error: profileError } = await supabase
      .from('profiles')
      .update({
        full_name,
        phone_number: phone_number || null,
        employee_id: employee_id || null,
        role_id,
      })
      .eq('id', userId);

    if (profileError) {
      console.error('Profile update error:', profileError);
      return NextResponse.json(
        { error: 'Failed to update user profile' },
        { status: 500 }
      );
    }

    // Send notification email if there were changes
    if (Object.keys(changes).length > 0) {
      const targetEmail = email || existingEmail; // Use new email if changed, otherwise existing
      const emailResult = await sendProfileUpdateEmail({
        to: targetEmail,
        userName: full_name,
        changes,
      });

      if (!emailResult.success) {
        console.warn('Failed to send profile update notification:', emailResult.error);
        // Don't fail the update if email fails - just log it
      }
    }

    return NextResponse.json({
      success: true,
      message: 'User updated successfully',
    });
  } catch (error) {
    console.error('Error updating user:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const userId = (await params).id;

    // Prevent self-deletion
    if (userId === user.id) {
      return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 });
    }

    // Delete auth user (this will cascade to profile via database trigger/RLS)
    const supabaseAdmin = getSupabaseAdmin();
    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId);

    if (authError) {
      console.error('Auth deletion error:', authError);
      return NextResponse.json({ error: authError.message }, { status: 400 });
    }

    // Also delete profile directly (in case cascade doesn't work)
    const { error: profileError } = await supabase
      .from('profiles')
      .delete()
      .eq('id', userId);

    if (profileError) {
      console.error('Profile deletion error:', profileError);
      // Continue anyway, auth user is deleted
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting user:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

