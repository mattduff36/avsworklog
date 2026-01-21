'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, CheckCircle2, AlertCircle, Eye, EyeOff, KeyRound } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { validatePasswordStrength, getPasswordRequirements } from '@/lib/utils/password';

export default function ChangePasswordPage() {
  const router = useRouter();
  const supabase = createClient();

  // State
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [userName, setUserName] = useState('');

  // Check if user is logged in and needs to change password
  useEffect(function () {
    async function checkUser() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          router.replace('/login');
          return;
        }

        // Get profile to check must_change_password flag
        const { data: profile } = await supabase
          .from('profiles')
          .select('must_change_password, full_name')
          .eq('id', user.id)
          .single();

        if (!profile) {
          router.replace('/login');
          return;
        }

        setUserName(profile.full_name || 'User');

        // If they don't need to change password, redirect to dashboard
        if (!profile.must_change_password) {
          router.replace('/dashboard');
          return;
        }

        setLoading(false);
      } catch (error) {
        console.error('Error checking user:', error);
        router.replace('/login');
      }
    }

    checkUser();
  }, [supabase, router]);

  // Handle password change
  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    // Validate passwords
    if (!newPassword || !confirmPassword) {
      setError('Please fill in all fields');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    // Validate password strength
    const validation = validatePasswordStrength(newPassword);
    if (!validation.valid) {
      setError(validation.errors[0]);
      return;
    }

    try {
      setSubmitting(true);

      // Update password
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) throw updateError;

      // Get current user
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) throw new Error('User not found');

      // Clear must_change_password flag
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ must_change_password: false })
        .eq('id', user.id);

      if (profileError) throw profileError;

      setSuccess(true);

      // Redirect to dashboard after 2 seconds
      setTimeout(() => {
        router.push('/dashboard');
      }, 2000);
    } catch (error) {
      console.error('Error changing password:', error);
      setError(error instanceof Error ? error.message : 'Failed to change password');
    } finally {
      setSubmitting(false);
    }
  }

  // Password strength indicator
  function getPasswordStrength(password: string): { strength: string; color: string } {
    if (!password) return { strength: '', color: '' };

    const validation = validatePasswordStrength(password);
    if (validation.valid) {
      return { strength: 'Strong', color: 'text-green-500' };
    }

    if (password.length >= 8 && (/[A-Z]/.test(password) || /[a-z]/.test(password) || /[0-9]/.test(password))) {
      return { strength: 'Medium', color: 'text-amber-500' };
    }

    return { strength: 'Weak', color: 'text-red-500' };
  }

  const passwordStrength = getPasswordStrength(newPassword);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
        <Card className="w-full max-w-md border-border">
          <CardContent className="pt-6">
            <div className="text-center space-y-4">
              <div className="flex justify-center">
                <div className="rounded-full bg-green-500/10 p-3">
                  <CheckCircle2 className="h-12 w-12 text-green-500" />
                </div>
              </div>
              <h2 className="text-2xl font-bold text-white">Password Changed Successfully!</h2>
              <p className="text-muted-foreground">Redirecting you to the dashboard...</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
      <Card className="w-full max-w-md border-border">
        <CardHeader className="text-center space-y-2">
          <div className="flex justify-center mb-2">
            <div className="rounded-full bg-amber-500/10 p-3">
              <KeyRound className="h-8 w-8 text-amber-500" />
            </div>
          </div>
          <CardTitle className="text-2xl text-white">Change Your Password</CardTitle>
          <CardDescription className="text-muted-foreground">
            Welcome, <strong className="text-white">{userName}</strong>! For security reasons, you must change your temporary password before continuing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handlePasswordChange} className="space-y-4">
            {error && (
              <div className="bg-red-500/10 border border-red-500/50 rounded p-3 text-sm text-red-400 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Password Requirements */}
            <div className="bg-blue-500/10 border border-blue-500/50 rounded p-3 space-y-2">
              <p className="text-sm font-medium text-blue-400">Password Requirements:</p>
              <ul className="text-xs text-blue-400 space-y-1">
                {getPasswordRequirements().map((req, index) => (
                  <li key={index} className="flex items-center gap-2">
                    <span className="text-blue-500">•</span>
                    {req}
                  </li>
                ))}
              </ul>
            </div>

            {/* New Password */}
            <div className="space-y-2">
              <Label htmlFor="new-password" className="text-white">
                New Password *
              </Label>
              <div className="relative">
                <Input
                  id="new-password"
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter your new password"
                  autoComplete="new-password"
                  className="bg-input border-border text-white pr-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-muted-foreground"
                >
                  {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {newPassword && passwordStrength.strength && (
                <p className={`text-xs ${passwordStrength.color}`}>
                  Password strength: {passwordStrength.strength}
                </p>
              )}
            </div>

            {/* Confirm Password */}
            <div className="space-y-2">
              <Label htmlFor="confirm-password" className="text-white">
                Confirm Password *
              </Label>
              <div className="relative">
                <Input
                  id="confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm your new password"
                  autoComplete="new-password"
                  className="bg-input border-border text-white pr-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-muted-foreground"
                >
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {confirmPassword && newPassword && (
                <p className={`text-xs ${confirmPassword === newPassword ? 'text-green-500' : 'text-red-500'}`}>
                  {confirmPassword === newPassword ? '✓ Passwords match' : '✗ Passwords do not match'}
                </p>
              )}
            </div>

            {/* Submit Button */}
            <Button
              type="submit"
              disabled={submitting}
              className="w-full bg-[#F1D64A] text-slate-950 hover:bg-[#F1D64A]/90 font-semibold"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Changing Password...
                </>
              ) : (
                <>
                  <KeyRound className="h-4 w-4 mr-2" />
                  Change Password
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

