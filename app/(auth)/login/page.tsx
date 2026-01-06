'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import { Lock } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true); // Default to true for better UX
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Load remember me preference on mount
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
      const { error } = await signIn(email, password);
      
      if (error) {
        setError(error.message);
      } else {
        // Store remember me preference
        localStorage.setItem('rememberMe', rememberMe ? 'true' : 'false');
        
        // Check if user needs to change password
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('must_change_password')
            .eq('id', user.id)
            .single();

          if (profile?.must_change_password) {
            // Redirect to password change page
            router.push('/change-password');
            router.refresh();
            return;
          }
        }
        
        router.push('/dashboard');
        router.refresh();
      }
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-start justify-center p-4 pt-12 sm:pt-16 md:pt-24 relative overflow-hidden bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950">
      {/* Subtle background pattern */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(241,214,74,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(241,214,74,0.03)_1px,transparent_1px)] bg-[size:64px_64px]" />

      <div className="w-full max-w-md relative z-10">
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
        <Card className="bg-slate-800/40 backdrop-blur-xl border-slate-700/50 shadow-2xl">
          <CardContent className="p-8">
            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div className="p-3 text-sm text-red-300 bg-red-900/30 border border-red-700/50 rounded-lg backdrop-blur-sm">
                  {error}
                </div>
              )}
              
              <div className="space-y-2">
                <Label htmlFor="email" className="text-slate-300 font-medium">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                  autoComplete="email"
                  className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-500 focus:border-avs-yellow focus:ring-avs-yellow/20 h-12"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-slate-300 font-medium">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={loading}
                  autoComplete="current-password"
                  className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-500 focus:border-avs-yellow focus:ring-avs-yellow/20 h-12"
                />
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="remember"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-600 bg-slate-700/50 text-avs-yellow focus:ring-avs-yellow focus:ring-offset-slate-800"
                  disabled={loading}
                />
                <Label 
                  htmlFor="remember" 
                  className="text-sm font-normal cursor-pointer text-slate-300"
                >
                  Keep me signed in
                </Label>
              </div>

              <Button
                type="submit"
                className="w-full h-12 bg-avs-yellow hover:bg-avs-yellow-hover text-slate-900 font-semibold text-base shadow-lg shadow-avs-yellow/20 transition-all"
                disabled={loading}
              >
                {loading ? 'Signing in...' : 'Sign In'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="mt-6 text-center text-sm text-slate-400">
          <p>Contact your administrator for account access</p>
        </div>
      </div>
    </div>
  );
}

