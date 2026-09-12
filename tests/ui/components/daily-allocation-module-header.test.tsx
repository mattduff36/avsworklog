/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DailyAllocationModuleHeader } from '@/components/daily-allocation/board/DailyAllocationModuleHeader';

describe('DailyAllocationModuleHeader', () => {
  it('uses the shared Squires page header with module-level publication actions', () => {
    const onOpenHistory = vi.fn();
    const onPublish = vi.fn();
    render(
      <DailyAllocationModuleHeader
        latestPublicationLabel="Rev 3 · Casey"
        onOpenHistory={onOpenHistory}
        onPublish={onPublish}
      />
    );

    const header = screen.getByTestId('daily-allocation-module-header');
    expect(header).toContainElement(screen.getByRole('heading', { name: 'Daily Allocation' }));
    expect(header).toHaveTextContent(
      'Place timed visits against catalogue jobs, assign people and plant, then publish an immutable allocation.'
    );
    expect(header).toHaveTextContent('Rev 3 · Casey');
    fireEvent.click(screen.getByRole('button', { name: 'Publication history' }));
    expect(onOpenHistory).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('daily-allocation-publish'));
    expect(onPublish).toHaveBeenCalledTimes(1);
  });

  it('explains why Publish is disabled on an uninitialized date', () => {
    render(
      <DailyAllocationModuleHeader
        onPublish={vi.fn()}
        publishDisabled
        publishDisabledReason="Add a timed visit before publishing."
      />
    );

    expect(screen.getByTestId('daily-allocation-publish')).toBeDisabled();
    expect(screen.getByTestId('daily-allocation-publish-reason')).toHaveTextContent(
      'Add a timed visit before publishing.'
    );
    expect(screen.getByTestId('daily-allocation-publish')).toHaveAttribute(
      'aria-describedby',
      'daily-allocation-publish-reason'
    );
  });
});
