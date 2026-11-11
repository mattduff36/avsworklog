/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ErrorBadgeKey } from '@/app/(dashboard)/debug/components/ErrorLogsDebugPanel';

afterEach(cleanup);
const labels = ['Critical', 'Handled with Message', 'Console / Investigate', 'Low Priority / API'];
const descriptions = [
  'Unhandled or likely user-blocking. The app may not have shown a helpful recovery message.',
  'The app caught the issue and showed a toast, inline state, or modal to the user.',
  'Usually surfaced through console logging. Worth checking, but user impact can vary.',
  'Often API-side, background, or lower-urgency telemetry with less direct UI impact.',
];

describe('Compact error badge key', () => {
  it('keeps the four coloured badges and short labels inline with two-column mobile wrapping', () => {
    render(<ErrorBadgeKey />);
    const key = screen.getByRole('region', { name: 'Error badge key' });
    expect(within(key).getAllByText('Error')).toHaveLength(4);
    labels.forEach(label => expect(within(key).getByText(label)).toBeDefined());
    descriptions.forEach(description => expect(screen.queryByText(description)).toBeNull());
    const grid = key.lastElementChild!;
    expect(grid.className).toContain('grid-cols-2');
    expect(grid.className).toContain('lg:grid-cols-4');
    expect(key.className).toContain('py-2');
    expect(grid.querySelectorAll('p')).toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows all existing severity and context explanations only in the Guide popup', async () => {
    render(<ErrorBadgeKey />);
    fireEvent.click(screen.getByRole('button', { name: 'Guide' }));
    const guide = await screen.findByRole('dialog', { name: 'Error badge guide' });
    expect(within(guide).getByText('Filled error badges show severity, not a different error type. Outline badges show extra context like classification, component, or device.')).toBeDefined();
    labels.forEach(label => expect(within(guide).getByText(label)).toBeDefined());
    descriptions.forEach(description => expect(within(guide).getByText(description)).toBeDefined());
  });

  it.each(['Escape', 'outside'])('dismisses Guide with %s and returns focus to its trigger', async method => {
    render(<ErrorBadgeKey />);
    const trigger = screen.getByRole('button', { name: 'Guide' });
    fireEvent.click(trigger);
    await screen.findByRole('dialog', { name: 'Error badge guide' });
    await new Promise(resolve => setTimeout(resolve, 0));
    if (method === 'Escape') fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    else fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    if (method === 'Escape') await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
