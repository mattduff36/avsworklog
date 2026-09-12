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
      />
    );

    expect(screen.getByText('Thu 13 Aug 2026')).toBeInTheDocument();
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
      />
    );

    expect(screen.getByText('10 Aug – 16 Aug 2026')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
    expect(onDateChange).toHaveBeenCalledWith('2026-08-20');
  });

  it('keeps the FFTS title row compact and parks Squires actions on the instruction row', () => {
    render(
      <BoardToolbar
        title="Daily job board"
        selectedDate="2026-08-13"
        view={DAILY_ALLOCATION_BOARD_VIEWS.daily}
        onDateChange={vi.fn()}
        onViewChange={vi.fn()}
        jobSearch=""
        onJobSearchChange={vi.fn()}
        onTimelineModeChange={vi.fn()}
        onAddVisit={vi.fn()}
        onAssign={vi.fn()}
        teams={[
          { id: 'team-1', name: 'Team One' },
          { id: 'team-2', name: 'Team Two' },
        ]}
        activeTeamId="team-1"
      />
    );

    const titleRow = screen.getByTestId('daily-allocation-board-title-row');
    const instructionRow = screen.getByTestId('daily-allocation-board-instruction-row');
    expect(titleRow).toHaveClass('flex-nowrap');
    expect(titleRow.className.split(/\s+/)).not.toContain('flex-col');
    expect(titleRow).toHaveClass('overflow-y-hidden');
    expect(screen.getByLabelText('Search jobs')).toHaveClass('overflow-hidden');
    expect(titleRow).toContainElement(screen.getByTestId('daily-allocation-view-heading'));
    expect(titleRow).toContainElement(screen.getByLabelText('Search jobs'));
    expect(titleRow).toContainElement(screen.getByLabelText('Active team'));
    expect(titleRow).toContainElement(screen.getByLabelText('Selected date'));
    expect(instructionRow).toContainElement(screen.getByRole('button', { name: 'Fit timeline to width' }));
    expect(instructionRow).toContainElement(screen.getByRole('button', { name: 'Add visit' }));
    expect(screen.queryByRole('button', { name: 'Publication history' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('daily-allocation-publish')).not.toBeInTheDocument();
    expect(screen.getByTestId('daily-allocation-view-heading')).toHaveTextContent('Daily job board');
    expect(screen.getByLabelText('Selected date')).toHaveClass('date-input-compact');
    expect(screen.getByLabelText('Selected date')).toHaveClass('date-input-overlay');
  });

  it('disables Fit and marks Scroll pressed when the timeline cannot fit', () => {
    render(
      <BoardToolbar
        selectedDate="2026-08-13"
        view={DAILY_ALLOCATION_BOARD_VIEWS.daily}
        onDateChange={vi.fn()}
        onViewChange={vi.fn()}
        timelineMode="fit"
        timelineFitEligible={false}
        onTimelineModeChange={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Fit timeline to width' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Fit timeline to width' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Use scrollable timeline' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows a compact team selector only when more than one team is available', () => {
    const onTeamChange = vi.fn();
    const { rerender } = render(
      <BoardToolbar
        selectedDate="2026-08-13"
        view={DAILY_ALLOCATION_BOARD_VIEWS.daily}
        onDateChange={vi.fn()}
        onViewChange={vi.fn()}
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

  it('keeps legacy conversion as a compact instruction-row action', () => {
    const onReview = vi.fn();
    render(
      <BoardToolbar
        selectedDate="2026-08-13"
        view={DAILY_ALLOCATION_BOARD_VIEWS.daily}
        onDateChange={vi.fn()}
        onViewChange={vi.fn()}
        legacyReview={{ labourCount: 1, plantCount: 2, onReview }}
      />
    );

    const chip = screen.getByTestId('daily-allocation-legacy-conversion');
    expect(screen.getByTestId('daily-allocation-board-instruction-row')).toContainElement(chip);
    expect(screen.getByTestId('daily-allocation-board-title-row')).not.toContainElement(chip);
    fireEvent.click(screen.getByRole('button', { name: 'Review and convert' }));
    expect(onReview).toHaveBeenCalledTimes(1);
  });

});
