/** @vitest-environment happy-dom */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { OverrideDialog } from '@/components/daily-allocation/board/AllocationDialogs';

describe('daily allocation override dialog', () => {
  it('clears evidence when the warning dialog closes', () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <OverrideDialog
        open
        kind="pending_absence"
        onOpenChange={onOpenChange}
        onConfirm={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText('Evidence'), {
      target: { value: 'First employee evidence' },
    });
    expect(screen.getByLabelText('Evidence')).toHaveValue('First employee evidence');

    rerender(
      <OverrideDialog
        open={false}
        kind={null}
        onOpenChange={onOpenChange}
        onConfirm={vi.fn()}
      />
    );
    rerender(
      <OverrideDialog
        open
        kind="off_shift"
        onOpenChange={onOpenChange}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByLabelText('Evidence')).toHaveValue('');
  });
});
