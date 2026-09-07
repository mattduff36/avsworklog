import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { WorkshopHistoricalTasksSection } from '@/app/(dashboard)/workshop-tasks/components/WorkshopHistoricalTasksSection';
import { TabletModeProvider } from '@/components/layout/tablet-mode-context';
import type { Action } from '@/app/(dashboard)/workshop-tasks/types';

vi.mock('@/lib/app-auth/client', () => ({
  subscribeToAuthStateChange: () => vi.fn(),
}));

function createTask(id: string, title: string): Action {
  return {
    id,
    status: 'completed',
    title,
    created_at: '2026-01-01T08:00:00Z',
    actioned_at: '2026-01-01T12:00:00Z',
    action_type: 'workshop_vehicle_task',
    workshop_comments: `${title} comments`,
    description: null,
  } as Action;
}

function renderSection({
  show = false,
  loading = false,
  tasks = [] as Action[],
  displayCount = 3,
  onShowChange = vi.fn(),
}: {
  show?: boolean;
  loading?: boolean;
  tasks?: Action[];
  displayCount?: number;
  onShowChange?: (show: boolean) => void;
} = {}) {
  return render(
    <TabletModeProvider>
      <WorkshopHistoricalTasksSection
        variant="archived"
        tasks={tasks}
        displayCount={displayCount}
        show={show}
        onShowChange={onShowChange}
        loading={loading}
        viewOnly
        taskAttachmentCounts={new Map()}
        taskInspectionPhotos={{}}
        getVehicleReg={(task) => task.title}
        getSourceLabel={() => 'Workshop Task'}
        onOpenTaskModal={vi.fn()}
        onOpenComments={vi.fn()}
        onOpenWhereabouts={vi.fn()}
        onUndoComplete={vi.fn()}
        canCorrectService
        onCorrectService={vi.fn()}
        onEditTask={vi.fn()}
      />
    </TabletModeProvider>
  );
}

describe('WorkshopHistoricalTasksSection completed', () => {
  it('exposes one Correct Task control and keeps undo for non-service tasks', () => {
    const task = createTask('DONE-1', 'DONE-1');
    render(
      <TabletModeProvider>
        <WorkshopHistoricalTasksSection
          variant="completed"
          tasks={[task]}
          displayCount={1}
          show
          onShowChange={vi.fn()}
          taskAttachmentCounts={new Map()}
          taskInspectionPhotos={{}}
          getVehicleReg={(row) => row.title}
          getSourceLabel={() => 'Workshop Task'}
          onOpenTaskModal={vi.fn()}
          onOpenComments={vi.fn()}
          onOpenWhereabouts={vi.fn()}
          onUndoComplete={vi.fn()}
          canCorrectService
          onCorrectService={vi.fn()}
          onEditTask={vi.fn()}
        />
      </TabletModeProvider>
    );

    expect(screen.getAllByRole('button', { name: 'Correct Task' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Correct details' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Correct service' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Undo' }).length).toBeGreaterThan(0);
  });
});

describe('WorkshopHistoricalTasksSection archived', () => {
  it('renders the grey archived accordion from the count before rows load', () => {
    renderSection({ displayCount: 12, tasks: [] });

    expect(screen.getByRole('heading', { name: /Archived Tasks \(12\)/i })).toBeTruthy();
    expect(screen.queryByText('ARCHIVED-1')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('asks the parent to expand and shows a loader instead of rows', () => {
    const onShowChange = vi.fn();
    renderSection({ displayCount: 3, onShowChange, loading: true, show: true });

    fireEvent.click(screen.getByRole('heading', { name: /Archived Tasks \(3\)/i }).closest('button')!);
    expect(onShowChange).toHaveBeenCalledWith(false);
    expect(screen.getByText(/Loading archived tasks/i)).toBeTruthy();
  });

  it('uses the same Show More pagination and hides mutation actions', () => {
    const tasks = Array.from({ length: 31 }, (_, index) => createTask(`ARCHIVED-${index + 1}`, `ARCHIVED-${index + 1}`));
    renderSection({ show: true, tasks, displayCount: 31 });

    expect(screen.getAllByText('ARCHIVED-1').length).toBeGreaterThan(0);
    expect(screen.queryByText('ARCHIVED-21')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Correct details' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Correct service' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Correct Task' })).toBeNull();

    fireEvent.click(screen.getAllByRole('button', { name: 'Show More' })[0]);

    expect(screen.getAllByText('ARCHIVED-21').length).toBeGreaterThan(0);
    expect(screen.queryByText('ARCHIVED-31')).toBeNull();
  });
});
