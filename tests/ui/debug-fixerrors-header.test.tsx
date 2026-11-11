/** @vitest-environment happy-dom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { lazy, Suspense, type ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DebugPage from '@/app/(dashboard)/debug/page';
import { FIXERRORS_LOCAL_ORIGIN, publicQueueState } from '@/lib/fixerrors/protocol';
import { FixtureStore, now } from '../unit/fixerrors-control-fixtures';

const navigation = vi.hoisted(() => ({
  params: new URLSearchParams('tab=error-log'),
  router: { replace: vi.fn(), push: vi.fn() },
}));
const auth = vi.hoisted(() => ({
  profile: { email: 'debug@example.invalid' }, loading: false, isActualSuperAdmin: true, isViewingAs: false,
}));
const supabase = {};
vi.mock('next/navigation', () => ({
  usePathname: () => '/debug',
  useRouter: () => navigation.router,
  useSearchParams: () => navigation.params,
}));
vi.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('@/lib/hooks/useBrowserSupabaseClient', () => ({ useBrowserSupabaseClient: () => supabase }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<{ default: ComponentType }>) => {
    const Component = lazy(loader);
    return function DynamicPanel() {
      return <Suspense fallback={null}><Component /></Suspense>;
    };
  },
}));
vi.mock('@/app/(dashboard)/debug/components/AuditLogDebugPanel', () => ({ AuditLogDebugPanel: () => <p>Audit panel</p> }));
vi.mock('@/app/(dashboard)/debug/components/UserAnalyticsDebugPanel', () => ({ UserAnalyticsDebugPanel: () => <p>Analytics panel</p> }));
vi.mock('@/app/(dashboard)/debug/components/DVLASyncDebugPanel', () => ({ DVLASyncDebugPanel: () => <p>DVLA panel</p> }));
vi.mock('@/app/(dashboard)/debug/components/TestFleetDebugPanel', () => ({ TestFleetDebugPanel: () => <p>Fleet panel</p> }));
vi.mock('@/app/(dashboard)/debug/components/LegacyJobCodesDebugPanel', () => ({ LegacyJobCodesDebugPanel: () => <p>Job codes panel</p> }));
vi.mock('@/app/(dashboard)/debug/components/NotificationSettingsDebugPanel', () => ({ NotificationSettingsDebugPanel: () => <p>Notification panel</p> }));
vi.mock('@/app/(dashboard)/debug/components/EmulationTestsDebugPanel', () => ({ EmulationTestsDebugPanel: () => <p>Emulation panel</p> }));
vi.mock('@/app/(dashboard)/debug/components/YardKioskDebugPanel', () => ({ YardKioskDebugPanel: () => <p>Kiosk panel</p> }));

beforeEach(() => {
  navigation.params = new URLSearchParams('tab=error-log');
  navigation.router.replace.mockClear();
  auth.isActualSuperAdmin = true;
  auth.isViewingAs = false;
  vi.spyOn(Date, 'now').mockReturnValue(now);
  const snapshot = { enabled: true, executionAvailable: true, origin: FIXERRORS_LOCAL_ORIGIN, ...publicQueueState(new FixtureStore().state) };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true, json: async () => url === '/api/debug/fixerrors' ? snapshot : { logs: [] },
  })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Debug Fixerrors header', () => {
  it('mounts one compact toolbar in the orange banner and none in the error-log body', async () => {
    const timer = vi.spyOn(globalThis, 'setInterval');
    const { container } = render(<DebugPage />);
    await screen.findByText('No errors logged');
    const banner = container.querySelector('.bg-gradient-to-r')!;
    expect(within(banner as HTMLElement).getByText('Fixerrors')).toBeDefined();
    expect(screen.getAllByLabelText('Fixerrors companion')).toHaveLength(1);
    const toolbar = screen.getByLabelText('Fixerrors companion');
    expect(toolbar.children).toHaveLength(2);
    expect(within(toolbar.children[0] as HTMLElement).getByRole('button', { name: 'Review' })).toBeDefined();
    expect(within(toolbar.children[0] as HTMLElement).getByRole('button', { name: 'Run batch' })).toBeDefined();
    expect(within(toolbar.children[1] as HTMLElement).getByRole('button', { name: 'Activity (0)' })).toBeDefined();
    expect(within(toolbar.children[1] as HTMLElement).getByRole('button', { name: 'History (0)' })).toBeDefined();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/debug/fixerrors')).toHaveLength(1);
    expect(timer.mock.calls.filter(([, delay]) => delay === 15_000)).toHaveLength(1);
    expect(toolbar.className).toContain('min-w-0');
    expect(toolbar.children[0].className).toContain('flex-wrap');
    expect(toolbar.parentElement?.className).toContain('flex-col');
    expect(toolbar.parentElement?.className).toContain('xl:flex-row');
  });

  it('stops the only polling loop on tab navigation and starts one fresh loop on return', async () => {
    const timer = vi.spyOn(globalThis, 'setInterval');
    const clear = vi.spyOn(globalThis, 'clearInterval');
    const view = render(<DebugPage />);
    await screen.findByText('No errors logged');
    const pollingIndex = timer.mock.calls.findIndex(([, delay]) => delay === 15_000);
    const callback = timer.mock.calls[pollingIndex][0];
    await act(async () => { if (typeof callback === 'function') callback(); });
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/debug/fixerrors')).toHaveLength(2);
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Audit Log' }), { button: 0, ctrlKey: false });
    expect(navigation.router.replace).toHaveBeenCalledWith('/debug?tab=audit-log', { scroll: false });
    navigation.params = new URLSearchParams('tab=audit-log');
    view.rerender(<DebugPage />);
    await screen.findByText('Audit panel');
    expect(screen.queryByLabelText('Fixerrors companion')).toBeNull();
    expect(clear).toHaveBeenCalledWith(timer.mock.results[pollingIndex].value);
    navigation.params = new URLSearchParams('tab=error-log');
    view.rerender(<DebugPage />);
    await screen.findByText('No errors logged');
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/debug/fixerrors')).toHaveLength(3));
    expect(timer.mock.calls.filter(([, delay]) => delay === 15_000)).toHaveLength(2);
    expect(screen.getAllByLabelText('Fixerrors companion')).toHaveLength(1);
  });

  it.each(['audit-log', 'usage-analytics', 'dvla-sync', 'test-fleet', 'job-code-corrections', 'notification-settings', 'emulation-tests', 'yard-kiosk'])(
    'preserves original title markup and never starts companion polling on %s', async tab => {
      navigation.params = new URLSearchParams(`tab=${tab}`);
      const timer = vi.spyOn(globalThis, 'setInterval');
      const { container } = render(<DebugPage />);
      const banner = container.querySelector('.bg-gradient-to-r')!;
      expect(banner.className).toBe('rounded-lg bg-gradient-to-r from-red-600 to-orange-500 p-6 text-white shadow-sm');
      expect(banner.children).toHaveLength(1);
      expect(banner.firstElementChild?.className).toBe('flex items-center gap-3');
      expect(screen.getByRole('heading', { name: 'SuperAdmin Debug Console' }).className).toBe('mb-1 text-2xl font-bold md:mb-2 md:text-3xl');
      expect(screen.getByText('Developer tools and operational diagnostics')).toBeDefined();
      expect(screen.queryByText('Fixerrors')).toBeNull();
      await act(async () => {});
      expect(fetch).not.toHaveBeenCalled();
      expect(timer.mock.calls.filter(([, delay]) => delay === 15_000)).toHaveLength(0);
    },
  );

  it('does not mount or fetch the toolbar in denied/View As mode', () => {
    auth.isViewingAs = true;
    render(<DebugPage />);
    expect(screen.queryByLabelText('Fixerrors companion')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
