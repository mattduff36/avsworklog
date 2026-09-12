/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { JobCodePicker } from '@/components/timesheets/JobCodeFields';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('JobCodePicker Radix accessibility', () => {
  it('JOB-DIALOG-A11Y-001 exposes an accessible title without a missing-title warning', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    render(
      <JobCodePicker
        value=""
        onChange={() => undefined}
        jobCodeOptions={[]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select job code' }));

    expect(
      await screen.findByRole('dialog', { name: 'Choose job code' })
    ).toBeInTheDocument();
    expect(
      consoleError.mock.calls.some((args) =>
        args.some((arg) => String(arg).includes('requires a `DialogTitle`'))
      )
    ).toBe(false);
    expect(
      consoleWarn.mock.calls.some((args) =>
        args.some((arg) => String(arg).includes('for {DialogContent}'))
      )
    ).toBe(false);
  });
});
