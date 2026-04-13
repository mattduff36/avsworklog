/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TrainingDeclineDialog } from '@/app/(dashboard)/timesheets/components/TrainingDeclineDialog';

describe('TrainingDeclineDialog', () => {
  it('renders the confirmation copy and calls the confirm handler', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();

    render(
      <TrainingDeclineDialog
        open
        dayLabel="Tuesday"
        trainingLabel="Training (AM)"
        pending={false}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    );

    expect(screen.getByText('Remove Training Booking?')).toBeInTheDocument();
    expect(screen.getByText(/Tuesday is currently marked as Training \(AM\)/)).toBeInTheDocument();
    expect(screen.getByText(/team manager plus Sarah Hubbard will be notified/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm Did Not Attend' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('disables actions while the decline is pending', () => {
    render(
      <TrainingDeclineDialog
        open
        dayLabel="Wednesday"
        trainingLabel="Training"
        pending
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Removing...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });
});
