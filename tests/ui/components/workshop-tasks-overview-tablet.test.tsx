import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { TabletModeProvider } from '@/components/layout/tablet-mode-context';
import { WorkshopTasksOverviewTab } from '@/app/(dashboard)/workshop-tasks/components/WorkshopTasksOverviewTab';
import { Tabs } from '@/components/ui/tabs';

vi.mock('@/lib/app-auth/client', () => ({
  subscribeToAuthStateChange: () => vi.fn(),
}));

function renderOverview() {
  return render(
    <TabletModeProvider>
      <Tabs value="overview" onValueChange={vi.fn()}>
        <WorkshopTasksOverviewTab
          assetTab="all"
          onAssetTabChange={vi.fn()}
          statusFilter="all"
          onStatusFilterChange={vi.fn()}
          vehicleFilter="all"
          onVehicleFilterChange={vi.fn()}
          vehicles={[]}
          loading={false}
          tabFilteredTasks={[]}
          pendingTasks={[]}
          highPriorityPendingCount={0}
          inProgressTasks={[]}
          onHoldTasks={[]}
          completedTasks={[]}
          showPending={true}
          onShowPendingChange={vi.fn()}
          showInProgress={true}
          onShowInProgressChange={vi.fn()}
          showOnHold={false}
          onShowOnHoldChange={vi.fn()}
          showCompleted={false}
          onShowCompletedChange={vi.fn()}
          updatingStatus={new Set()}
          taskAttachmentCounts={new Map()}
          getStatusIcon={() => null}
          getVehicleReg={() => 'VAN-1'}
          getSourceLabel={() => 'Workshop Task'}
          getAssetDisplay={() => 'VAN-1'}
          onCreateTask={vi.fn()}
          onOpenTaskModal={vi.fn()}
          onOpenComments={vi.fn()}
          onMarkInProgress={vi.fn()}
          onMarkComplete={vi.fn()}
          onMarkOnHold={vi.fn()}
          onResumeTask={vi.fn()}
          onUndoLogged={vi.fn()}
          onUndoComplete={vi.fn()}
          onEditTask={vi.fn()}
          onDeleteTask={vi.fn()}
        />
      </Tabs>
    </TabletModeProvider>
  );
}

describe('WorkshopTasksOverviewTab tablet classes', () => {
  beforeEach(() => {
    localStorage.clear();
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/api/auth/session')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            authenticated: true,
            user: { id: 'workshop-test-user' },
          }),
        } as Response;
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response;
    }) as unknown as typeof fetch;
  });

  it('applies touch target classes in tablet mode', async () => {
    localStorage.setItem('tablet_mode:workshop-test-user', 'on');
    renderOverview();

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /All Assets/i }).className).toContain('min-h-11');
    });
  });

  it('keeps desktop sizing when tablet mode is off', async () => {
    renderOverview();

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /All Assets/i }).className).not.toContain('min-h-11');
    });
  });
});

