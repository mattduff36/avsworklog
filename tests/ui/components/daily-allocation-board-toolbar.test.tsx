/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BoardToolbar } from '@/components/daily-allocation/board/BoardToolbar';
import { DAILY_ALLOCATION_BOARD_VIEWS } from '@/lib/config/daily-allocation-view-preference';

describe('BoardToolbar', () => {
  it('navigates daily ranges one day at a time', () => {
    const onDateChange = vi.fn();
    render(
      <BoardToolbar
        selectedDate="2026-08-13"
        view={DAILY_ALLOCATION_BOARD_VIEWS.daily}
        onDateChange={onDateChange}
        onViewChange={vi.fn()}
        onPublish={vi.fn()}
      />
    );

    expect(screen.getByText('Thursday, 13 August 2026')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next day' }));
    expect(onDateChange).toHaveBeenCalledWith('2026-08-14');
    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }));
    expect(onDateChange).toHaveBeenCalledWith('2026-08-12');
  });

  it('navigates weekly ranges seven days at a time', () => {
    const onDateChange = vi.fn();
    render(
      <BoardToolbar
        selectedDate="2026-08-13"
        view={DAILY_ALLOCATION_BOARD_VIEWS.weekly}
        onDateChange={onDateChange}
        onViewChange={vi.fn()}
        onPublish={vi.fn()}
      />
    );

    expect(screen.getByText('10 Aug – 16 Aug 2026')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
    expect(onDateChange).toHaveBeenCalledWith('2026-08-20');
  });

  it('shows a compact team selector only when more than one team is available', () => {
    const onTeamChange = vi.fn();
    const { rerender } = render(
      <BoardToolbar
        selectedDate="2026-08-13"
        view={DAILY_ALLOCATION_BOARD_VIEWS.daily}
        onDateChange={vi.fn()}
        onViewChange={vi.fn()}
        onPublish={vi.fn()}
        teams={[{ id: 'team-1', name: 'Team One' }]}
        activeTeamId="team-1"
        onTeamChange={onTeamChange}
      />
    );
    expect(screen.queryByLabelText('Active team')).not.toBeInTheDocument();

    rerender(
      <BoardToolbar
        selectedDate="2026-08-13"
        view={DAILY_ALLOCATION_BOARD_VIEWS.daily}
        onDateChange={vi.fn()}
        onViewChange={vi.fn()}
        onPublish={vi.fn()}
        teams={[
          { id: 'team-1', name: 'Team One' },
          { id: 'team-2', name: 'Team Two' },
        ]}
        activeTeamId="team-1"
        onTeamChange={onTeamChange}
      />
    );
    fireEvent.change(screen.getByLabelText('Active team'), { target: { value: 'team-2' } });
    expect(onTeamChange).toHaveBeenCalledWith('team-2');
  });
});
