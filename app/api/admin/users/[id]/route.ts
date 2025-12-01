import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { sendProfileUpdateEmail } from '@/lib/utils/email';
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
    const profile = await getProfileWithRole(user.id);

    if (!profile || profile.role?.name !== 'admin') {
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
    if (role_id !== existingUser.role_id) {
      changes.role_id = { old: existingUser.role_id, new: role_id };
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
    const profile = await getProfileWithRole(user.id);

    if (!profile || profile.role?.name !== 'admin') {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const userId = (await params).id;

    // Prevent self-deletion
    if (userId === user.id) {
      return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 });
    }

    // Get deletion mode from query parameter (default: keep-data)
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('mode') || 'keep-data';

    const supabaseAdmin = getSupabaseAdmin();

    // Get user's current name for the "(Deleted User)" suffix
    const { data: userProfile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', userId)
      .single();

    if (!userProfile) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (mode === 'keep-data') {
      // MODE 1: Keep company data, only delete user account
      // Update user's name to mark as deleted
      const deletedName = userProfile.full_name.includes('(Deleted User)') 
        ? userProfile.full_name 
        : `${userProfile.full_name} (Deleted User)`;

      await supabase
        .from('profiles')
        .update({ full_name: deletedName })
        .eq('id', userId);

      // Nullify reviewer/assigner references (keeps audit trail of who created data)
      await supabase
        .from('timesheets')
        .update({ reviewed_by: null })
        .eq('reviewed_by', userId);

      await supabase
        .from('vehicle_inspections')
        .update({ reviewed_by: null })
        .eq('reviewed_by', userId);

      await supabase
        .from('timesheets')
        .update({ adjusted_by: null })
        .eq('adjusted_by', userId);

      await supabase
        .from('actions')
        .update({ actioned_by: null })
        .eq('actioned_by', userId);

      // Disable the auth user (ban until far future) instead of deleting
      // This prevents cascade deletion of profile while making account inaccessible
      const farFuture = new Date('2099-12-31').toISOString();
      const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        banned_until: farFuture,
        user_metadata: {
          ...userProfile,
          deleted_at: new Date().toISOString(),
          account_status: 'deleted'
        }
      });

      if (banError) {
        console.error('Error disabling user:', banError);
        return NextResponse.json(
          { error: `Failed to disable account: ${banError.message}` },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        message: 'User account deleted - company data preserved',
        mode: 'keep-data'
      });
    } else {
      // MODE 2: Delete all user data
      // Step 1: Handle foreign key references before deletion
      // Set reviewed_by to NULL in timesheets where this user was the reviewer
      await supabase
        .from('timesheets')
        .update({ reviewed_by: null })
        .eq('reviewed_by', userId);

      // Set reviewed_by to NULL in vehicle_inspections where this user was the reviewer
      await supabase
        .from('vehicle_inspections')
        .update({ reviewed_by: null })
        .eq('reviewed_by', userId);

      // Set adjusted_by to NULL in timesheets if it exists
      await supabase
        .from('timesheets')
        .update({ adjusted_by: null })
        .eq('adjusted_by', userId);

    // Step 2: Delete user's own records
    // First get all timesheet IDs for this user
    const { data: userTimesheets } = await supabase
      .from('timesheets')
      .select('id')
      .eq('user_id', userId);

    // Delete timesheet entries (must delete before timesheets due to FK)
    if (userTimesheets && userTimesheets.length > 0) {
      const timesheetIds = userTimesheets.map(t => t.id);
      await supabase
        .from('timesheet_entries')
        .delete()
        .in('timesheet_id', timesheetIds);
    }

    // Delete timesheets created by this user
    await supabase
      .from('timesheets')
      .delete()
      .eq('user_id', userId);

    // First get all inspection IDs for this user
    const { data: userInspections } = await supabase
      .from('vehicle_inspections')
      .select('id')
      .eq('user_id', userId);

    // Delete inspection items (must delete before inspections due to FK)
    if (userInspections && userInspections.length > 0) {
      const inspectionIds = userInspections.map(i => i.id);
      await supabase
        .from('inspection_items')
        .delete()
        .in('inspection_id', inspectionIds);
    }

    // Delete vehicle inspections created by this user
    await supabase
      .from('vehicle_inspections')
      .delete()
      .eq('user_id', userId);

    // Delete or nullify actions
    await supabase
      .from('actions')
      .delete()
      .eq('created_by', userId);

    await supabase
      .from('actions')
      .update({ actioned_by: null })
      .eq('actioned_by', userId);

    // Delete absences
    await supabase
      .from('absences')
      .delete()
      .eq('profile_id', userId);

    // Delete RAMS assignments
    await supabase
      .from('rams_assignments')
      .delete()
      .eq('employee_id', userId);

    // Nullify audit log references
    await supabase
      .from('audit_log')
      .update({ user_id: null })
      .eq('user_id', userId);

    // Nullify message references
    await supabase
      .from('messages')
      .update({ sender_id: null })
      .eq('sender_id', userId);

    // Delete message recipients
    await supabase
      .from('message_recipients')
      .delete()
      .eq('user_id', userId);

    // Step 3: Delete the profile
    const { error: profileError } = await supabase
      .from('profiles')
      .delete()
      .eq('id', userId);

    if (profileError) {
      console.error('Profile deletion error:', profileError);
      return NextResponse.json(
        { error: `Database error deleting user: ${profileError.message}` },
        { status: 500 }
      );
    }

    // Step 4: Delete the auth user last
    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId);

    if (authError) {
      console.error('Auth deletion error:', authError);
      return NextResponse.json(
        { error: `Failed to delete authentication: ${authError.message}` },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'User and all related data deleted successfully',
      mode: 'delete-all'
    });
  }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    console.error('Error deleting user:', errorMessage, error);
    return NextResponse.json(
      { error: `Internal server error: ${errorMessage}` }, 
      { status: 500 }
    );
  }
}

