/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VersionHistoryTabs } from '@/app/(dashboard)/help/version-history/components/VersionHistoryTabs';
import type {
  ReleaseHistoryEntry,
  ReleaseHistoryMonthOption,
} from '@/lib/config/release-version-logic';

const month: ReleaseHistoryMonthOption = {
  key: '2026-07',
  label: 'July 2026',
};

const entry: ReleaseHistoryEntry = {
  version: '0726.19.0',
  updateKind: 'minor',
  title: 'Inventory improvements',
  description: 'Improved Inventory location selection.',
  summary: 'Improved Inventory location selection.',
  details: ['Location options can now be selected reliably.'],
  areas: ['Inventory'],
  pushedAt: '2026-07-23T14:38:42.594Z',
};

describe('VersionHistoryTabs', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the latest version row collapsed by default', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ entries: [entry], month }),
    }));

    render(<VersionHistoryTabs months={[month]} initialMonthKey={month.key} />);

    const versionButton = await screen.findByRole('button', { name: `Version ${entry.version}` });
    expect(versionButton).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('More detail')).not.toBeInTheDocument();

    fireEvent.click(versionButton);

    await waitFor(() => {
      expect(versionButton).toHaveAttribute('aria-expanded', 'true');
    });
    expect(screen.getByText('More detail')).toBeInTheDocument();
  });
});
