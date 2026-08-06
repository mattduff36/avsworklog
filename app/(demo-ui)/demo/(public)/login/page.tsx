'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { clearRetiredAccountSwitchClientState } from '@/lib/app-auth/client';

const DEMO_REMEMBER_ME_KEY = 'demo-ui:remember-me';

export default function DemoLoginPage() {
  const router = useRouter();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(DEMO_REMEMBER_ME_KEY);
    if (saved !== null) setRememberMe(saved === 'true');
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await signIn(email, password, {
        rememberMe,
        deferRedirect: true,
      });

      if (result.error) {
        setError(result.error.message);
        return;
      }

      clearRetiredAccountSwitchClientState();
      window.localStorage.setItem(DEMO_REMEMBER_ME_KEY, rememberMe ? 'true' : 'false');

      if (result.data?.profile?.must_change_password === true) {
        router.replace('/change-password');
        return;
      }

      router.replace('/demo/dashboard');
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="dui-login">
      <section className="dui-login-brand" aria-label="Squires Fresh UI">
        <div className="dui-login-wordmark">SQUIRES</div>
        <div className="dui-login-statement">
          <h1>Work in clear view.</h1>
          <p>
            Sign in to review the parallel Fresh UI against your real role, permissions and operational data.
          </p>
        </div>
        <small>Fresh UI demo using live Squires data</small>
      </section>

      <section className="dui-login-panel">
        <form className="dui-login-form" onSubmit={handleSubmit}>
          <h2>Welcome back</h2>
          <p>Use your existing Squires account.</p>

          {error ? <div className="dui-login-error" role="alert">{error}</div> : null}

          <label className="dui-field">
            <span>Email Address</span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>

          <label className="dui-field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          <div className="dui-login-options">
            <label>
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(event) => setRememberMe(event.target.checked)}
              />
              Remember me
            </label>
            <span>Live account</span>
          </div>

          <button
            type="submit"
            className="dui-button dui-button-primary"
            disabled={loading}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </section>
    </main>
  );
}
