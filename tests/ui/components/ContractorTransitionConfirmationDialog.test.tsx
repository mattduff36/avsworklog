/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ContractorTransitionConfirmationDialog } from '@/components/admin/ContractorTransitionConfirmationDialog';

describe('ContractorTransitionConfirmationDialog', () => {
  it('requires an explicit confirmation and explains the cleanup scope', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ContractorTransitionConfirmationDialog
        open
        userName="Steve O'Conner"
        saving={false}
        error=""
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    );

    expect(screen.getByRole('dialog')).toHaveTextContent("Steve O'Conner");
    expect(screen.getByRole('dialog')).toHaveTextContent('annual leave allowance');
    expect(screen.getByRole('dialog')).toHaveTextContent('future auto-generated bank holidays');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Convert to Contractor' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('surfaces conflicts and prevents duplicate actions while saving', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ContractorTransitionConfirmationDialog
        open
        userName="Blocked User"
        saving
        error="Annual Leave requires manual review"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent('manual review');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Converting...' })).toBeDisabled();
  });
});
