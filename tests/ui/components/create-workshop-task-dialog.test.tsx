import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CreateWorkshopTaskDialog } from '@/components/workshop-tasks/CreateWorkshopTaskDialog';
import type React from 'react';

const toastError = vi.fn();
const toastSuccess = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}));

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('@/components/layout/tablet-mode-context', () => ({
  useTabletMode: () => ({ tabletModeEnabled: false }),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open?: boolean }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/select', () => {
  let currentOnChange: ((value: string) => void) | undefined;
  return {
    Select: ({
      children,
      value,
      onValueChange,
    }: {
      children: React.ReactNode;
      value?: string;
      onValueChange?: (value: string) => void;
    }) => {
      currentOnChange = onValueChange;
      return (
        <div data-testid="select" data-value={value}>
          {children}
        </div>
      );
    },
    SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
    SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
      <button type="button" data-value={value} onClick={() => currentOnChange?.(value)}>
        {children}
      </button>
    ),
    SelectGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectSeparator: () => <hr />,
  };
});

const { attachmentTemplates, supabaseClient } = vi.hoisted(() => {
  const attachmentTemplates = [
    { id: 'tmpl-service', name: 'Service A', applies_to: ['van'], is_active: true },
    { id: 'tmpl-pack', name: 'Pack checklist', applies_to: ['van'], is_active: true },
    { id: 'tmpl-other', name: 'Other', applies_to: ['van'], is_active: true },
    { id: 'tmpl-plant', name: 'Plant only', applies_to: ['plant'], is_active: true },
  ];

  function chain(result: { data: unknown; error: null }) {
    const query = {
      select: () => query,
      eq: () => query,
      order: async () => result,
      maybeSingle: async () => result,
      single: async () => result,
    };
    return query;
  }

  const supabaseClient = {
    from(table: string) {
      if (table === 'vans') {
        return chain({
          data: [{ id: 'van-1', reg_number: 'AB12 CDE', nickname: 'Van', van_categories: { name: 'Small' } }],
          error: null,
        });
      }
      if (table === 'hgvs' || table === 'plant') {
        return chain({ data: [], error: null });
      }
      if (table === 'workshop_task_categories') {
        return chain({
          data: [
            { id: 'cat-service', name: 'Service (Van)', slug: 'service-van', is_active: true, sort_order: 1, applies_to: ['van'] },
            { id: 'cat-pack', name: 'Inspection pack', slug: 'inspection-pack', is_active: true, sort_order: 3, applies_to: ['van'] },
            { id: 'cat-repair', name: 'Repair', slug: 'repair', is_active: true, sort_order: 2, applies_to: ['plant'] },
          ],
          error: null,
        });
      }
      if (table === 'workshop_task_subcategories') {
        return chain({ data: [], error: null });
      }
      if (table === 'vehicle_maintenance') {
        return chain({ data: { current_mileage: 10 }, error: null });
      }
      return chain({ data: null, error: null });
    },
  };

  return { attachmentTemplates, supabaseClient };
});

vi.mock('@/lib/hooks/useAttachmentTemplates', () => ({
  useAttachmentTemplates: () => ({
    templates: attachmentTemplates,
  }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => supabaseClient,
}));

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe('CreateWorkshopTaskDialog category-linked attachments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/workshop-tasks/category-attachments')) {
        return jsonResponse({
          templates: [{ templateId: 'tmpl-service' }],
        });
      }
      if (url.includes('/api/workshop-tasks/tasks') && init?.method === 'POST') {
        return jsonResponse({ task: { id: 'task-1' }, meter_reading_updated: true });
      }
      if (url.includes('/api/workshop-tasks/attachments/task/')) {
        return jsonResponse({ error: 'Selected attachment is not linked to this workshop category' }, false, 400);
      }
      return jsonResponse({});
    });
  });

  it('MNT-LINK-001 clears invalid prefill and auto-selects the ordered valid intersection', async () => {
    const { unmount } = render(
      <CreateWorkshopTaskDialog
        open
        onOpenChange={vi.fn()}
        initialVehicleId="van-1"
        initialCategoryId="cat-repair"
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Create Task/i })).toBeDisabled();
    });
    expect(screen.queryByLabelText('Service A')).toBeNull();
    unmount();

    render(
      <CreateWorkshopTaskDialog
        open
        onOpenChange={vi.fn()}
        initialVehicleId="van-1"
        initialCategoryId="cat-service"
      />,
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/workshop-tasks/category-attachments?categoryId=cat-service'),
      );
    });

    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: 'Service A' })).toBeChecked();
    });
    expect(screen.queryByLabelText('Other')).toBeNull();
    expect(screen.queryByLabelText('Plant only')).toBeNull();
  });

  it('MNT-LINK-002 blocks create when configured links have no valid asset-compatible template', async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/workshop-tasks/category-attachments')) {
        return jsonResponse({ templates: [{ templateId: 'tmpl-plant' }] });
      }
      return jsonResponse({});
    });

    render(
      <CreateWorkshopTaskDialog
        open
        onOpenChange={vi.fn()}
        initialVehicleId="van-1"
        initialCategoryId="cat-service"
      />,
    );

    fireEvent.change(screen.getByLabelText(/Task Details/i), {
      target: { value: 'Needs a full service checklist completed' },
    });
    fireEvent.change(screen.getByLabelText(/Current Mileage|Current Hours|Current KM/i), {
      target: { value: '20' },
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Create Task/i })).toBeDisabled();
    });
    expect(screen.getByText(/no active attachments compatible/i)).toBeTruthy();
  });

  it('MNT-PARTIAL-001 reports one residual attachment failure without retry or success toast', async () => {
    render(
      <CreateWorkshopTaskDialog
        open
        onOpenChange={vi.fn()}
        initialVehicleId="van-1"
        initialCategoryId="cat-service"
      />,
    );

    fireEvent.change(screen.getByLabelText(/Task Details/i), {
      target: { value: 'Needs a full service checklist completed' },
    });
    fireEvent.change(screen.getByLabelText(/Current Mileage|Current Hours|Current KM/i), {
      target: { value: '20' },
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Create Task/i })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole('button', { name: /Create Task/i }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('Task created but 1 attachment(s) failed to link');
    });
    expect(toastSuccess).not.toHaveBeenCalled();
    const attachmentPosts = vi.mocked(global.fetch).mock.calls.filter(([input, init]) => (
      String(input).includes('/api/workshop-tasks/attachments/task/') && init?.method === 'POST'
    ));
    expect(attachmentPosts).toHaveLength(1);
    expect(attachmentPosts[0]?.[1]?.body).toContain('tmpl-service');
  });

  it('blocks create while category links are loading or failed', async () => {
    let resolveLinks: ((value: Response) => void) | undefined;
    const linksPromise = new Promise<Response>((resolve) => {
      resolveLinks = resolve;
    });
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/workshop-tasks/category-attachments')) {
        return linksPromise;
      }
      return jsonResponse({});
    });

    render(
      <CreateWorkshopTaskDialog
        open
        onOpenChange={vi.fn()}
        initialVehicleId="van-1"
        initialCategoryId="cat-service"
      />,
    );

    fireEvent.change(screen.getByLabelText(/Task Details/i), {
      target: { value: 'Needs a full service checklist completed' },
    });
    fireEvent.change(screen.getByLabelText(/Current Mileage|Current Hours|Current KM/i), {
      target: { value: '20' },
    });

    await waitFor(() => {
      expect(screen.getByText(/Loading attachments for this workshop category/i)).toBeTruthy();
      expect(screen.getByRole('button', { name: /Create Task/i })).toBeDisabled();
    });

    resolveLinks!(jsonResponse({}, false, 500));

    await waitFor(() => {
      expect(screen.getByText(/Unable to load category attachments/i)).toBeTruthy();
      expect(screen.getByRole('button', { name: /Create Task/i })).toBeDisabled();
    });
  });

  it('clears stale attachments when the workshop category changes', async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('categoryId=cat-pack')) {
        return jsonResponse({ templates: [{ templateId: 'tmpl-pack' }] });
      }
      if (url.includes('/api/workshop-tasks/category-attachments')) {
        return jsonResponse({ templates: [{ templateId: 'tmpl-service' }] });
      }
      return jsonResponse({});
    });

    render(
      <CreateWorkshopTaskDialog
        open
        onOpenChange={vi.fn()}
        initialVehicleId="van-1"
        initialCategoryId="cat-service"
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: 'Service A' })).toBeChecked();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Inspection pack' }));

    await waitFor(() => {
      expect(screen.queryByLabelText('Service A')).toBeNull();
      expect(screen.getByRole('checkbox', { name: 'Pack checklist' })).toBeChecked();
    });
  });

  it('reports a network attachment failure as partial success without retry', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/workshop-tasks/category-attachments')) {
        return jsonResponse({ templates: [{ templateId: 'tmpl-service' }] });
      }
      if (url.includes('/api/workshop-tasks/tasks') && init?.method === 'POST') {
        return jsonResponse({ task: { id: 'task-1' }, meter_reading_updated: true });
      }
      if (url.includes('/api/workshop-tasks/attachments/task/')) {
        throw new TypeError('Failed to fetch');
      }
      return jsonResponse({});
    });

    render(
      <CreateWorkshopTaskDialog
        open
        onOpenChange={vi.fn()}
        initialVehicleId="van-1"
        initialCategoryId="cat-service"
      />,
    );

    fireEvent.change(screen.getByLabelText(/Task Details/i), {
      target: { value: 'Needs a full service checklist completed' },
    });
    fireEvent.change(screen.getByLabelText(/Current Mileage|Current Hours|Current KM/i), {
      target: { value: '20' },
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Create Task/i })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole('button', { name: /Create Task/i }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('Task created but 1 attachment(s) failed to link');
    });
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalledWith('Failed to create task');
    const attachmentPosts = vi.mocked(global.fetch).mock.calls.filter(([input, init]) => (
      String(input).includes('/api/workshop-tasks/attachments/task/') && init?.method === 'POST'
    ));
    expect(attachmentPosts).toHaveLength(1);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
