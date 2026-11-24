import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { HgvRepairAssignment } from '@/components/workshop-tasks/HgvRepairAssignment';

afterEach(() => vi.unstubAllGlobals());

it('shows both assets and submits a workshop diagnosis against the displayed assignment', async () => {
  const post = vi.fn().mockResolvedValue({ ok: true });
  const refresh = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('fetch', post);
  render(<HgvRepairAssignment taskId="task" pair={{tractor_label:'XT71 AVS', trailer_label:'C517773 Nooteboom'}}
    side="pair" editable refresh={refresh} />);
  expect(screen.getByText(/XT71 AVS.*C517773 Nooteboom/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', {name:'Assign to trailer'}));
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(post).toHaveBeenCalledWith('/api/workshop-tasks/tasks/task/assign-hgv-repair',
    expect.objectContaining({method:'PATCH',body:JSON.stringify({side:'trailer',expectedSide:'pair'})}));
  expect(screen.getByText('Repair assigned to trailer')).toBeTruthy();
  expect(screen.queryByRole('button',{name:'Assign to trailer'})).toBeNull();
});
