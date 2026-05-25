'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { isAccountSwitcherEnabled } from '@/lib/account-switch/feature-flag';
import {
  getAccountSwitchDeviceLabel,
  getOrCreateAccountSwitchDeviceId,
} from '@/lib/account-switch/device';
import { clearLegacyAccountSwitchClientState } from '@/lib/app-auth/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Lock } from 'lucide-react';

export default function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const savedPreference = localStorage.getItem('rememberMe');
    if (savedPreference !== null) {
      setRememberMe(savedPreference === 'true');
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const accountSwitcherEnabled = isAccountSwitcherEnabled();
      const { error } = await signIn(email, password, {
        rememberMe,
        deviceId: accountSwitcherEnabled ? getOrCreateAccountSwitchDeviceId() : null,
        deviceLabel: accountSwitcherEnabled ? getAccountSwitchDeviceLabel() : null,
      });

      if (error) {
        setError(error.message);
        return;
      }

      clearLegacyAccountSwitchClientState();

      localStorage.setItem('rememberMe', rememberMe ? 'true' : 'false');
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-dvh sm:h-auto sm:min-h-screen flex items-start justify-center px-4 pb-4 pt-0 sm:pt-16 md:pt-24 relative overflow-y-auto overflow-x-hidden bg-slate-950">
      {/* Fixed background starts at the viewport edge so iOS can render it under the native status bar. */}
      <div className="fixed inset-0 z-0 pointer-events-none bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(241,214,74,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(241,214,74,0.03)_1px,transparent_1px)] bg-[size:64px_64px]" />
      </div>

      <div className="w-full max-w-lg relative z-10 translate-y-[clamp(1.5rem,10svh,5rem)] sm:translate-y-0">
        {/* AVS Yellow Icon */}
        <div className="flex justify-center mb-6">
          <div className="bg-avs-yellow rounded-2xl p-5 shadow-lg shadow-avs-yellow/20">
            <Lock className="h-10 w-10 text-slate-900" strokeWidth={2.5} />
          </div>
        </div>

        {/* Title */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">SQUIRES</h1>
        </div>

        {/* Glass-morphism Card */}
        <Card className="bg-card/40 backdrop-blur-xl border-border/50 shadow-2xl">
          <CardContent className="login-card-content p-6 sm:p-8">
            <form onSubmit={handleSubmit} className="login-form space-y-5 sm:space-y-6">
              {error && (
                <div className="p-3 text-sm text-red-300 bg-red-900/30 border border-red-700/50 rounded-lg backdrop-blur-sm">
                  {error}
                </div>
              )}
              
              <div className="login-field-group space-y-2.5">
                <Label htmlFor="email" className="login-field-label text-base font-medium text-muted-foreground">
                  Email Address
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                  autoComplete="email"
                  className="login-form-input h-14 bg-input border-border px-4 text-base text-white placeholder:text-muted-foreground focus:border-avs-yellow focus:ring-avs-yellow/20"
                />
              </div>

              <div className="login-field-group space-y-2.5">
                <Label htmlFor="password" className="login-field-label text-base font-medium text-muted-foreground">
                  Password
                </Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={loading}
                  autoComplete="current-password"
                  className="login-form-input h-14 bg-input border-border px-4 text-base text-white placeholder:text-muted-foreground focus:border-avs-yellow focus:ring-avs-yellow/20"
                />
              </div>

              <div className="login-remember-row flex items-center space-x-3">
                <input
                  type="checkbox"
                  id="remember"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="login-checkbox h-5 w-5 rounded border-slate-600 bg-slate-700/50 text-avs-yellow focus:ring-avs-yellow focus:ring-offset-slate-800"
                  disabled={loading}
                />
                <Label 
                  htmlFor="remember" 
                  className="login-remember-label cursor-pointer text-base font-normal leading-none text-muted-foreground"
                >
                  Keep me signed in
                </Label>
              </div>

              <Button
                type="submit"
                className="login-submit h-14 w-full bg-avs-yellow text-base font-semibold text-slate-900 shadow-lg shadow-avs-yellow/20 transition-all hover:bg-avs-yellow-hover"
                disabled={loading}
              >
                {loading ? 'Signing in...' : 'Sign In'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="mt-6 text-center text-sm text-muted-foreground">
          <p>Contact your administrator for account access or password resets.</p>
        </div>
      </div>
    </div>
  );
}

