/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DailyAllocationBoardPage from '@/app/(dashboard)/daily-allocation/page';

const gate = vi.hoisted(() => ({
  permissionLoading: false,
  hasPermission: true,
  levelLoading: false,
  accessLevel: 5,
  fetchRuntime: vi.fn(async () => ({ board_enabled: false, writes_enabled: false })),
}));

const loads = vi.hoisted(() => ({
  legacyImports: 0,
  progressiveImports: 0,
  legacyRenders: 0,
  progressiveRenders: 0,
}));

vi.mock('@/lib/client/daily-allocation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/client/daily-allocation')>();
  return {
    ...actual,
    fetchDailyAllocationRuntime: () => gate.fetchRuntime(),
  };
});

vi.mock('@/lib/hooks/usePermissionCheck', () => ({
  usePermissionCheck: () => ({
    hasPermission: gate.hasPermission,
    loading: gate.permissionLoading,
  }),
}));

vi.mock('@/lib/hooks/useModuleAccessLevel', () => ({
  useModuleAccessLevel: () => ({
    accessLevel: gate.accessLevel,
    canUseLevel: (minimumLevel: number) => gate.accessLevel >= minimumLevel,
    isLoading: gate.levelLoading,
  }),
}));

vi.mock('@/components/layout/AppPageShell', () => ({
  AppPageShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AppPageHeader: ({
    title,
    description,
  }: {
    title: string;
    description?: string;
  }) => (
    <header>
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
    </header>
  ),
}));

vi.mock('@/components/layout/AppPageLoadingShell', () => ({
  AppPageLoadingShell: ({ message }: { message: string }) => <div>{message}</div>,
}));

vi.mock('@/components/daily-allocation/LegacyDailyAllocationManager', () => {
  loads.legacyImports += 1;
  return {
    LegacyDailyAllocationManager: () => {
      loads.legacyRenders += 1;
      return <div>legacy-manager</div>;
    },
  };
});

vi.mock('@/app/(dashboard)/daily-allocation/ProgressiveAllocationManager', () => {
  loads.progressiveImports += 1;
  return {
    ProgressiveAllocationManager: () => {
      loads.progressiveRenders += 1;
      return <div>progressive-manager</div>;
    },
  };
});

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <DailyAllocationBoardPage />
    </QueryClientProvider>
  );
}

describe('daily allocation manager selection', () => {
  beforeEach(() => {
    cleanup();
    gate.permissionLoading = false;
    gate.hasPermission = true;
    gate.levelLoading = false;
    gate.accessLevel = 5;
    gate.fetchRuntime.mockReset();
    gate.fetchRuntime.mockResolvedValue({ board_enabled: false, writes_enabled: false });
    loads.legacyRenders = 0;
    loads.progressiveRenders = 0;
  });

  it('keeps both manager chunks unloaded while permission or level is unresolved', () => {
    gate.permissionLoading = true;
    renderPage();
    expect(screen.getByText('Loading daily allocation...')).toBeInTheDocument();

    cleanup();
    gate.permissionLoading = false;
    gate.levelLoading = true;
    renderPage();
    expect(screen.getByText('Loading daily allocation...')).toBeInTheDocument();
    expect(loads.legacyImports).toBe(0);
    expect(loads.progressiveImports).toBe(0);
    expect(gate.fetchRuntime).not.toHaveBeenCalled();
  });

  it('keeps both manager chunks unloaded below level 4', () => {
    gate.accessLevel = 2;
    renderPage();
    expect(screen.getByText('Level 4 manager access is required to plan this board.')).toBeInTheDocument();
    expect(loads.legacyImports).toBe(0);
    expect(loads.progressiveImports).toBe(0);
    expect(loads.legacyRenders).toBe(0);
    expect(loads.progressiveRenders).toBe(0);
    expect(gate.fetchRuntime).not.toHaveBeenCalled();
  });

  it('keeps both manager chunks unloaded while the runtime flag is unresolved', () => {
    gate.fetchRuntime.mockImplementation(() => new Promise(() => undefined));
    renderPage();
    expect(screen.getByText('Loading daily allocation...')).toBeInTheDocument();
    expect(loads.legacyImports).toBe(0);
    expect(loads.progressiveImports).toBe(0);
  });

  it('loads only the legacy manager when the flag is off or the runtime read fails', async () => {
    renderPage();
    expect(await screen.findByText('legacy-manager')).toBeInTheDocument();
    expect(loads.legacyImports).toBe(1);
    expect(loads.progressiveImports).toBe(0);
    expect(screen.queryByText('progressive-manager')).not.toBeInTheDocument();

    cleanup();
    loads.legacyRenders = 0;
    gate.fetchRuntime.mockRejectedValue(Object.assign(new Error('schema cache'), { status: 503 }));
    renderPage();
    expect(await screen.findByText('legacy-manager')).toBeInTheDocument();
    expect(loads.progressiveImports).toBe(0);
    expect(loads.progressiveRenders).toBe(0);
  });

  it('loads only the progressive manager when the flag is on', async () => {
    const legacyImportsBefore = loads.legacyImports;
    gate.fetchRuntime.mockResolvedValue({ board_enabled: true, writes_enabled: true });
    renderPage();
    expect(await screen.findByText('progressive-manager')).toBeInTheDocument();
    expect(loads.progressiveImports).toBe(1);
    expect(loads.legacyImports).toBe(legacyImportsBefore);
    expect(loads.legacyRenders).toBe(0);
    expect(screen.queryByText('legacy-manager')).not.toBeInTheDocument();
  });
});
