/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />
import { useEffect, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '@/lib/providers/auth-provider';
import type { ClientAuthSessionResult } from '@/lib/app-auth/client-session';

const fixture = vi.hoisted(() => ({ load: vi.fn(), queryClient: { invalidateQueries: vi.fn() }, selection: { roleId: '', teamId: '' }, changed: vi.fn(), unmounted: vi.fn() }));
vi.mock('@tanstack/react-query', async original => ({ ...await original<typeof import('@tanstack/react-query')>(), useQueryClient: () => fixture.queryClient }));
vi.mock('@/lib/app-auth/client-session', () => ({ loadClientAuthSession: fixture.load }));
vi.mock('@/lib/app-auth/client', () => ({ broadcastAuthStateChange: vi.fn(), clearRetiredAccountSwitchClientState: vi.fn(), subscribeToAuthStateChange: () => () => {} }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}), invalidateCachedDataToken: vi.fn() }));
vi.mock('@/lib/utils/fetch-with-auth', () => ({ installGlobalAuthAwareFetch: () => () => {} }));
vi.mock('@/lib/app-auth/recovery-bridge', () => ({ registerAuthRecoveryHandlers: () => () => {} }));
vi.mock('@/lib/app-auth/client-service-health', () => ({ getClientServiceOutage: () => null }));
vi.mock('@/lib/utils/view-as-cookie', () => ({ clearViewAsSelection: vi.fn(), getViewAsSelection: () => fixture.selection, VIEW_AS_CHANGE_EVENT: 'test-view-as' }));

function session(patch: Record<string, unknown> = {}): ClientAuthSessionResult {
  return { status: 'authenticated', responseStatus: 200, error: null, payload: {
    authenticated: true, user: { id: 'user-1', email: 'test@example.test' }, profile: {
      id: 'user-1', full_name: 'Test user', team_id: 'team-1', super_admin: false,
      role: { name: 'employee', display_name: 'Employee', role_class: 'employee', is_manager_admin: false, is_super_admin: false },
      ...patch,
    },
  } };
}
function Draft() {
  const [note, setNote] = useState('');
  useEffect(() => () => fixture.unmounted(), []);
  return <input aria-label="Defect note" value={note} onChange={event => setNote(event.target.value)} />;
}
function Consumer() {
  const auth = useAuth();
  useEffect(() => { if (auth.user && auth.profile) fixture.changed(auth.user, auth.profile); }, [auth.user, auth.profile]);
  return <><span>{auth.profile?.full_name || 'Signed out'}</span><button onClick={() => void auth.recoverFromAuthFailure({ statusCode: 401 })}>Recover</button>
    {auth.loading || !auth.user ? <span>Loading page</span> : <Draft />}</>;
}
async function flush() { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); }
async function resume(event: 'focus' | 'visibilitychange') {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(31_000);
    (event === 'focus' ? window : document).dispatchEvent(new Event(event));
    await vi.advanceTimersByTimeAsync(801);
  });
}
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); window.localStorage.clear(); window.history.replaceState({}, '', '/hgv-inspections/test');
  fixture.selection = { roleId: '', teamId: '' };
  fixture.queryClient.invalidateQueries.mockResolvedValue(undefined);
  fixture.load.mockImplementation(async () => session());
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ roles: [{ id: 'manager', name: 'manager', display_name: 'Manager', role_class: 'manager', is_manager_admin: true, is_super_admin: false }], teams: [] }) })));
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('background authentication refresh preserves active forms', () => {
  it('revalidates on focus and visibility without changing equal identities or losing the draft', async () => {
    render(<AuthProvider><Consumer /></AuthProvider>); await flush();
    fireEvent.change(screen.getByLabelText('Defect note'), { target: { value: 'Unsaved defect note' } });
    const first = fixture.changed.mock.calls[0];
    await resume('focus'); await resume('visibilitychange');
    expect(fixture.load).toHaveBeenCalledTimes(3);
    expect(fixture.changed).toHaveBeenCalledTimes(1);
    expect(fixture.changed.mock.calls[0]).toEqual(first);
    expect(fixture.unmounted).not.toHaveBeenCalled();
    expect(screen.queryByText('Loading page')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Defect note')).toHaveValue('Unsaved defect note');
  });
  it('keeps View As metadata stable but still propagates changed profile data', async () => {
    fixture.selection = { roleId: 'manager', teamId: '' };
    fixture.load.mockImplementation(async () => session({ super_admin: true }));
    render(<AuthProvider><Consumer /></AuthProvider>); await flush();
    fixture.unmounted.mockClear();
    fireEvent.change(screen.getByLabelText('Defect note'), { target: { value: 'Keep my draft' } });
    await resume('focus');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fixture.unmounted).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Defect note')).toHaveValue('Keep my draft');
    fixture.load.mockImplementation(async () => session({ super_admin: true, full_name: 'Updated name', team_id: 'team-2' }));
    await resume('visibilitychange');
    expect(screen.getByText('Updated name')).toBeInTheDocument();
    expect(fixture.changed).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('still clears the session and redirects when explicit auth recovery confirms expiry', async () => {
    const redirect = vi.spyOn(window.location, 'replace').mockImplementation(() => {});
    render(<AuthProvider><Consumer /></AuthProvider>); await flush();
    fixture.load.mockResolvedValue({ status: 'unauthenticated', responseStatus: 401, error: null, payload: null });
    fireEvent.click(screen.getByRole('button', { name: 'Recover' })); await flush();
    expect(screen.getByText('Signed out')).toBeInTheDocument();
    expect(screen.queryByLabelText('Defect note')).not.toBeInTheDocument();
    expect(redirect).toHaveBeenCalledWith(expect.stringContaining('/login'));
  });
});
