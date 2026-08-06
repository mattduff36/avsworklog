/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LegacyQuoteLocationOptIn } from '@/app/(dashboard)/inventory/components/LegacyQuoteLocationOptIn';

describe('LegacyQuoteLocationOptIn', () => {
  it('uses muted light-grey idle and pressed treatments', () => {
    const onEnabledChange = vi.fn();
    const { rerender } = render(
      <LegacyQuoteLocationOptIn enabled={false} onEnabledChange={onEnabledChange} />,
    );

    const toggle = screen.getByRole('button', { name: 'Include legacy locations' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).toHaveClass(
      'border-slate-600/40',
      'bg-slate-800/30',
      'text-slate-400',
    );
    expect(toggle.className).not.toContain('amber');

    fireEvent.click(toggle);
    expect(onEnabledChange).toHaveBeenCalledWith(true);

    rerender(
      <LegacyQuoteLocationOptIn enabled onEnabledChange={onEnabledChange} />,
    );
    const pressed = screen.getByRole('button', { name: 'Legacy locations included' });
    expect(pressed).toHaveAttribute('aria-pressed', 'true');
    expect(pressed).toHaveClass(
      'border-slate-500/50',
      'bg-slate-700/40',
      'text-slate-200',
    );
    expect(pressed.className).not.toContain('amber');
  });
});
