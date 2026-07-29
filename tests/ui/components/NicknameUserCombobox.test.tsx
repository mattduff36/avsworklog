/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NicknameUserCombobox } from '@/components/fleet/NicknameUserCombobox';

const fetchUserDirectory = vi.fn();

vi.mock('@/lib/client/user-directory', () => ({
  fetchUserDirectory: (...args: unknown[]) => fetchUserDirectory(...args),
}));

describe('NicknameUserCombobox', () => {
  beforeEach(() => {
    fetchUserDirectory.mockReset();
    fetchUserDirectory.mockResolvedValue([
      { id: 'u1', full_name: 'Conway Evans', employee_id: 'E001' },
      { id: 'u2', full_name: 'Matt Duffill', employee_id: 'E002' },
    ]);
  });

  it('filters users and selects one into nickname + user id', async () => {
    const onNicknameChange = vi.fn();
    const onUserSelect = vi.fn();

    render(
      <NicknameUserCombobox
        value=""
        selectedUserId={null}
        onNicknameChange={onNicknameChange}
        onUserSelect={onUserSelect}
      />
    );

    const input = screen.getByRole('textbox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Con' } });

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Conway Evans/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('option', { name: /Conway Evans/i }));

    expect(onNicknameChange).toHaveBeenCalledWith('Conway Evans');
    expect(onUserSelect).toHaveBeenCalledWith({ id: 'u1', fullName: 'Conway Evans' });
  });

  it('clears selected user when typing free text after a selection', async () => {
    const onNicknameChange = vi.fn();
    const onUserSelect = vi.fn();

    render(
      <NicknameUserCombobox
        value="Conway Evans"
        selectedUserId="u1"
        onNicknameChange={onNicknameChange}
        onUserSelect={onUserSelect}
      />
    );

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Spare Van' } });

    expect(onNicknameChange).toHaveBeenCalledWith('Spare Van');
    expect(onUserSelect).toHaveBeenCalledWith(null);
  });

  it('allows free text with no matching users', async () => {
    render(
      <NicknameUserCombobox
        value="Unique Nickname"
        selectedUserId={null}
        onNicknameChange={vi.fn()}
        onUserSelect={vi.fn()}
      />
    );

    fireEvent.focus(screen.getByRole('textbox'));

    await waitFor(() => {
      expect(screen.getByText(/No matching users/i)).toBeInTheDocument();
    });
  });
});
