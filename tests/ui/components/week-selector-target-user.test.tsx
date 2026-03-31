/** @vitest-environment happy-dom */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { WeekSelector } from '@/app/(dashboard)/timesheets/components/WeekSelector';

const maybeSingleMock = vi.fn();
const eqMock = vi.fn();
const selectMock = vi.fn();
const fromMock = vi.fn();
const createClientMock = vi.fn();

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
      maybeSingle: maybeSingleMock,
    };
    eqMock.mockImplementation(() => queryBuilder);
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

    fireEvent.change(screen.getByLabelText('Week Ending Date (Must be Sunday)'), {
      target: { value: '2026-03-29' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Timesheet' }));

    await waitFor(() => {
      expect(fromMock).toHaveBeenCalledWith('timesheets');
      expect(eqMock).toHaveBeenCalledWith('user_id', 'employee-2');
      expect(eqMock).toHaveBeenCalledWith('week_ending', '2026-03-29');
    });
  });
});
