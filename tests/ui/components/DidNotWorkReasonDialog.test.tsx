/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DidNotWorkReasonDialog } from '@/components/timesheets/DidNotWorkReasonDialog';

describe('DidNotWorkReasonDialog', () => {
  it('confirms sickness directly from the reason choice step', () => {
    const onConfirm = vi.fn();

    render(
      <DidNotWorkReasonDialog
        open
        dayName="Tuesday"
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sick' }));

    expect(onConfirm).toHaveBeenCalledWith({ kind: 'sickness' });
  });

  it('asks for the training session before confirming training', () => {
    const onConfirm = vi.fn();

    render(
      <DidNotWorkReasonDialog
        open
        dayName="Wednesday"
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Training' }));
    fireEvent.click(screen.getByRole('button', { name: 'Half Day PM' }));

    expect(onConfirm).toHaveBeenCalledWith({ kind: 'training', trainingSession: 'PM' });
  });

  it('keeps the existing text reason flow for Other', () => {
    const onConfirm = vi.fn();

    render(
      <DidNotWorkReasonDialog
        open
        dayName="Thursday"
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Other' }));
    fireEvent.change(screen.getByPlaceholderText(/personal appointment/i), {
      target: { value: 'Vehicle issue' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Reason' }));

    expect(onConfirm).toHaveBeenCalledWith({ kind: 'other', reason: 'Vehicle issue' });
  });
});
