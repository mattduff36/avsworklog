/** @vitest-environment happy-dom */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { WeekSelector } from '@/app/(dashboard)/timesheets/components/WeekSelector';

const maybeSingleMock = vi.fn();
const inMock = vi.fn();
const eqMock = vi.fn();
const selectMock = vi.fn();
const fromMock = vi.fn();
const createClientMock = vi.fn();

vi.mock('@/lib/utils/date', () => ({
  getWeekEnding: () => new Date('2026-03-29T00:00:00.000Z'),
  formatDateISO: (date: Date | string) => {
    const value = typeof date === 'string' ? new Date(date) : date;
    return value.toISOString().slice(0, 10);
  },
  getWeekEndingSundayOptions: () => ([
    { isoDate: '2026-03-08', label: 'Sunday 8 Mar 2026' },
    { isoDate: '2026-03-15', label: 'Sunday 15 Mar 2026' },
    { isoDate: '2026-03-22', label: 'Sunday 22 Mar 2026' },
    { isoDate: '2026-03-29', label: 'Sunday 29 Mar 2026' },
    { isoDate: '2026-04-05', label: 'Sunday 5 Apr 2026' },
    { isoDate: '2026-04-12', label: 'Sunday 12 Apr 2026' },
  ]),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => createClientMock(),
}));

describe('WeekSelector target employee context', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const queryBuilder = {
      eq: eqMock,
      in: inMock,
      maybeSingle: maybeSingleMock,
    };
    eqMock.mockImplementation(() => queryBuilder);
    inMock.mockResolvedValue({ data: [], error: null });
    selectMock.mockImplementation(() => queryBuilder);
    fromMock.mockImplementation(() => ({ select: selectMock }));
    createClientMock.mockReturnValue({ from: fromMock });
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
  });

  it('checks duplicate timesheet weeks against the selected employee id', async () => {
    const onWeekSelected = vi.fn();

    render(
      <WeekSelector
        targetUserId="employee-2"
        onWeekSelected={onWeekSelected}
        initialWeek={null}
      />
    );

    await waitFor(() => {
      expect(eqMock).toHaveBeenCalledWith('user_id', 'employee-2');
      expect(inMock).toHaveBeenCalledWith('week_ending', [
        '2026-03-08',
        '2026-03-15',
        '2026-03-22',
        '2026-03-29',
        '2026-04-05',
        '2026-04-12',
      ]);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Continue to Timesheet' }));

    await waitFor(() => {
      expect(fromMock).toHaveBeenCalledWith('timesheets');
      expect(eqMock).toHaveBeenCalledWith('user_id', 'employee-2');
      expect(eqMock).toHaveBeenCalledWith('week_ending', '2026-03-29');
    });
  });

  it('disables submitted/finalized Sundays but keeps draft selectable', async () => {
    inMock.mockResolvedValue({
      data: [
        { id: 't1', week_ending: '2026-03-22', status: 'submitted' },
        { id: 't2', week_ending: '2026-03-29', status: 'draft' },
      ],
      error: null,
    });

    render(
      <WeekSelector
        targetUserId="employee-2"
        onWeekSelected={vi.fn()}
        initialWeek={null}
      />
    );

    fireEvent.click(screen.getByRole('combobox', { name: 'Week Ending Date (Sunday)' }));

    const submittedOption = await screen.findByRole('option', {
      name: 'Sunday 22 Mar 2026 (Submitted)',
    });
    const draftOption = await screen.findByRole('option', {
      name: 'Sunday 29 Mar 2026 (Draft)',
    });

    expect(submittedOption).toHaveAttribute('aria-disabled', 'true');
    expect(draftOption).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('shows blocked-week message if locked week is selected programmatically', async () => {
    inMock.mockResolvedValue({
      data: [{ id: 't1', week_ending: '2026-03-22', status: 'submitted' }],
      error: null,
    });
    maybeSingleMock.mockResolvedValue({
      data: { id: 't1', status: 'submitted' },
      error: null,
    });

    render(
      <WeekSelector
        targetUserId="employee-2"
        onWeekSelected={vi.fn()}
        initialWeek="2026-03-22"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Continue to Timesheet' }));

    await waitFor(() => {
      expect(
        screen.getByText(
          'You already have a submitted timesheet for this week. You cannot create another timesheet for the same week.'
        )
      ).toBeInTheDocument();
    });
  });
});
