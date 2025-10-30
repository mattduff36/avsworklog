import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { generateSecurePassword } from '@/lib/utils/password';
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

export async function POST(
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

    // Get target user's profile
    const { data: targetProfile, error: profileError } = await supabase
      .from('profiles')
      .select('email, full_name')
      .eq('id', userId)
      .single();

    if (profileError || !targetProfile) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Generate new temporary password
    const temporaryPassword = generateSecurePassword();
    console.log('Generated temporary password for', targetProfile.email);

    // Update password using admin API
    const supabaseAdmin = getSupabaseAdmin();
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      userId,
      {
        password: temporaryPassword,
      }
    );

    if (updateError) {
      console.error('Password update error:', updateError);
      return NextResponse.json(
        { error: 'Failed to reset password' },
        { status: 500 }
      );
    }

    // Set must_change_password flag
    const { error: flagError } = await supabase
      .from('profiles')
      .update({
        must_change_password: true,
      })
      .eq('id', userId);

    if (flagError) {
      console.error('Flag update error:', flagError);
      // Password was changed but flag update failed - log but don't fail
      console.warn('Password reset successful but failed to set must_change_password flag');
    }

    // Send email to user with new temporary password
    const emailResult = await sendPasswordEmail({
      to: targetProfile.email!,
      userName: targetProfile.full_name!,
      temporaryPassword,
      isReset: true,
    });

    if (!emailResult.success) {
      console.warn('Failed to send password reset email:', emailResult.error);
      // Don't fail the reset if email fails - just log it
    }

    return NextResponse.json({
      success: true,
      temporaryPassword, // Return password to show admin
      emailSent: emailResult.success,
    });
  } catch (error) {
    console.error('Error resetting password:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

