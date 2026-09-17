import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MarkTaskCompleteDialog, type TaskForCompletion } from '@/components/workshop-tasks/MarkTaskCompleteDialog';

vi.mock('@/components/layout/tablet-mode-context', () => ({
  useTabletMode: () => ({ tabletModeEnabled: false }),
}));

vi.mock('@/lib/hooks/useWorkshopDraftPersistence', () => ({
  useWorkshopDraftPersistence: () => ({ clearDraft: vi.fn() }),
}));

vi.mock('@/components/forms/SignaturePad', () => ({
  SignaturePad: () => <div>signature</div>,
}));

function serviceTask(): TaskForCompletion {
  return {
    id: 'task-1',
    status: 'logged',
    van_id: 'van-1',
    workshop_task_categories: {
      id: 'cat-service',
      name: 'Service (Van)',
    },
  };
}

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as Response;
}

function mockServiceFetches(options: {
  attachments?: Array<{ template_id: string; status: string }> | unknown;
  attachmentsOk?: boolean;
  links?: Array<{ templateId: string }>;
  linksOk?: boolean;
  rotation?: Array<{ id: string; position: number; templateId: string }>;
}) {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/fleet/service-types')) {
      return jsonResponse({
        templates: [{ templateId: 'tmpl-a', templateName: 'A', compactLabel: 'A' }],
        rotation: options.rotation ?? [{ id: 'step-1', position: 1, templateId: 'tmpl-a' }],
      });
    }
    if (url.includes('/api/workshop-tasks/attachments/task/')) {
      return jsonResponse(
        { attachments: options.attachments ?? [{ template_id: 'tmpl-a', status: 'completed' }] },
        options.attachmentsOk !== false,
      );
    }
    if (url.includes('/api/workshop-tasks/category-attachments')) {
      return jsonResponse(
        { templates: options.links ?? [{ templateId: 'tmpl-a' }] },
        options.linksOk !== false,
      );
    }
    return jsonResponse({});
  });
}

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText(/Completion Note/i), { target: { value: 'Work completed successfully.' } });
  fireEvent.change(screen.getByLabelText(/Actual/i), { target: { value: '1000' } });
}

describe('MarkTaskCompleteDialog service attachment readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('SVC-UI-001 enables completion only for one completed linked rotation attachment', async () => {
    mockServiceFetches({});
    render(
      <MarkTaskCompleteDialog
        open
        onOpenChange={vi.fn()}
        task={serviceTask()}
        onConfirm={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByText(/Checking the linked service attachment/i)).toBeNull();
      expect(screen.queryByText(/Retry attachment check/i)).toBeNull();
    });
    fillRequiredFields();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Mark Complete/i })).toBeEnabled();
    });
    expect(screen.queryByText(/Complete the linked service checklist/i)).toBeNull();
  });

  it('SVC-UI-002 blocks loading, failed, incomplete, count, and stale-link states, then retries', async () => {
    mockServiceFetches({
      attachments: [{ template_id: 'tmpl-a', status: 'in_progress' }],
    });
    const { rerender } = render(
      <MarkTaskCompleteDialog
        open
        onOpenChange={vi.fn()}
        task={serviceTask()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /Mark Complete/i })).toBeDisabled();
    await waitFor(() => {
      expect(screen.getByText(/Complete the linked service checklist/i)).toBeTruthy();
    });

    mockServiceFetches({ attachments: [] });
    rerender(
      <MarkTaskCompleteDialog
        open
        onOpenChange={vi.fn()}
        task={{ ...serviceTask(), id: 'task-2' }}
        onConfirm={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/exactly one linked attachment/i)).toBeTruthy();
    });

    mockServiceFetches({
      attachments: [
        { template_id: 'tmpl-a', status: 'completed' },
        { template_id: 'tmpl-b', status: 'completed' },
      ],
    });
    rerender(
      <MarkTaskCompleteDialog
        open
        onOpenChange={vi.fn()}
        task={{ ...serviceTask(), id: 'task-3' }}
        onConfirm={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/exactly one linked attachment/i)).toBeTruthy();
    });

    mockServiceFetches({ attachments: { malformed: true } });
    rerender(
      <MarkTaskCompleteDialog
        open
        onOpenChange={vi.fn()}
        task={{ ...serviceTask(), id: 'task-4' }}
        onConfirm={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/Unable to verify the linked service attachment/i)).toBeTruthy();
    });

    mockServiceFetches({
      attachments: [{ template_id: 'tmpl-stale', status: 'completed' }],
    });
    rerender(
      <MarkTaskCompleteDialog
        open
        onOpenChange={vi.fn()}
        task={{ ...serviceTask(), id: 'task-5' }}
        onConfirm={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/not linked to this service category/i)).toBeTruthy();
    });

    mockServiceFetches({
      attachments: [{ template_id: 'tmpl-a', status: 'completed' }],
      rotation: [{ id: 'step-1', position: 1, templateId: 'tmpl-other' }],
    });
    rerender(
      <MarkTaskCompleteDialog
        open
        onOpenChange={vi.fn()}
        task={{ ...serviceTask(), id: 'task-6' }}
        onConfirm={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/not part of the active service rotation/i)).toBeTruthy();
    });

    mockServiceFetches({ attachmentsOk: false });
    rerender(
      <MarkTaskCompleteDialog
        open
        onOpenChange={vi.fn()}
        task={{ ...serviceTask(), id: 'task-7' }}
        onConfirm={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/Unable to verify the linked service attachment/i)).toBeTruthy();
    });

    mockServiceFetches({});
    fireEvent.click(screen.getByRole('button', { name: /Retry attachment check/i }));
    fillRequiredFields();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Mark Complete/i })).toBeEnabled();
    });
  });
});
