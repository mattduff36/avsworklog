import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkshopTaskFormDialogs } from '@/app/(dashboard)/workshop-tasks/components/WorkshopTaskFormDialogs';
import { TabletModeProvider } from '@/components/layout/tablet-mode-context';
import type React from 'react';

let outsidePrevented = false;
let escapePrevented = false;

vi.mock('@/lib/app-auth/client', () => ({
  subscribeToAuthStateChange: () => vi.fn(),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({
    children,
    open,
    onOpenChange,
  }: {
    children: React.ReactNode;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }) =>
    open ? (
      <div>
        <button type="button" data-testid="dialog-request-close" onClick={() => onOpenChange?.(false)}>
          Request Close
        </button>
        {children}
      </div>
    ) : null,
  DialogContent: ({
    children,
    className,
    onInteractOutside,
    onEscapeKeyDown,
  }: {
    children: React.ReactNode;
    className?: string;
    onInteractOutside?: (event: { preventDefault: () => void }) => void;
    onEscapeKeyDown?: (event: { preventDefault: () => void }) => void;
  }) => (
    <div data-testid="dialog-content" className={className}>
      <button
        type="button"
        data-testid="dialog-outside"
        onClick={() => {
          outsidePrevented = false;
          onInteractOutside?.({
            preventDefault: () => {
              outsidePrevented = true;
            },
          });
        }}
      >
        Outside
      </button>
      <button
        type="button"
        data-testid="dialog-escape"
        onClick={() => {
          escapePrevented = false;
          onEscapeKeyDown?.({
            preventDefault: () => {
              escapePrevented = true;
            },
          });
        }}
      >
        Escape
      </button>
      {children}
    </div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/select', async () => {
  const React = await import('react');
  const contextHost = globalThis as typeof globalThis & {
    __wtSelectCtx?: React.Context<((value: string) => void) | null>;
  };
  contextHost.__wtSelectCtx ??= React.createContext<((value: string) => void) | null>(null);
  const SelectChangeContext = contextHost.__wtSelectCtx;

  return {
    Select: ({
      children,
      disabled,
      onValueChange,
    }: {
      children: React.ReactNode;
      disabled?: boolean;
      onValueChange?: (value: string) => void;
    }) => (
      <SelectChangeContext.Provider value={disabled ? null : onValueChange || null}>
        <div>{children}</div>
      </SelectChangeContext.Provider>
    ),
    SelectGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectSeparator: () => <hr />,
    SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder || 'value'}</span>,
  };
});

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.ComponentProps<'input'>) => <input {...props} />,
}));

vi.mock('@/components/ui/textarea', () => ({
  Textarea: (props: React.ComponentProps<'textarea'>) => <textarea {...props} />,
}));

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
}));

vi.mock('@/components/ui/tablet-mode-controls', async () => {
  const React = await import('react');
  return {
  TabletAwareButton: ({ children, ...props }: React.ComponentProps<'button'>) => <button {...props}>{children}</button>,
  TabletAwareSelectTrigger: ({ children, ...props }: React.ComponentProps<'button'>) => <button {...props}>{children}</button>,
  TabletAwareSelectContent: ({ children, ...props }: React.ComponentProps<'div'>) => <div {...props}>{children}</div>,
  TabletAwareSelectItem: ({ children, value, ...props }: React.ComponentProps<'button'> & { value?: string }) => {
    const onValueChange = React.useContext(
      (globalThis as typeof globalThis & {
        __wtSelectCtx: React.Context<((next: string) => void) | null>;
      }).__wtSelectCtx,
    );
    return (
      <button
        type="button"
        role="option"
        aria-selected={false}
        value={value}
        {...props}
        onClick={() => onValueChange?.(String(value))}
      >
        {children}
      </button>
    );
  },
  };
});

function createBaseProps(): React.ComponentProps<typeof WorkshopTaskFormDialogs> {
  return {
    showAddModal: true,
    onShowAddModalChange: vi.fn(),
    assetTab: 'van',
    selectedVehicleId: '',
    onSelectedVehicleIdChange: vi.fn(),
    vehicles: [],
    getAssetDisplay: () => 'asset',
    selectedCategoryId: '',
    onSelectedCategoryIdChange: vi.fn(),
    activeCategories: [],
    categoryHasSubcategories: false,
    selectedSubcategoryId: '',
    onSelectedSubcategoryIdChange: vi.fn(),
    filteredSubcategories: [],
    meterReadingType: 'mileage',
    newMeterReading: '',
    onNewMeterReadingChange: vi.fn(),
    currentMeterReading: null,
    workshopComments: '',
    onWorkshopCommentsChange: vi.fn(),
    attachmentTemplates: [],
    selectedAttachmentTemplateIds: [],
    onSelectedAttachmentTemplateIdsChange: vi.fn(),
    submitting: false,
    onResetAddForm: vi.fn(),
    onFetchCurrentMeterReading: vi.fn(),
    onCreateTask: vi.fn(),
    showEditModal: false,
    onShowEditModalChange: vi.fn(),
    editingTask: null,
    editVehicleId: '',
    onEditVehicleIdChange: vi.fn(),
    recentVehicleIds: [],
    editCategoryId: '',
    onEditCategoryIdChange: vi.fn(),
    categories: [],
    plantCategories: [],
    hgvCategories: [],
    editSubcategoryId: '',
    onEditSubcategoryIdChange: vi.fn(),
    subcategories: [],
    plantSubcategories: [],
    hgvSubcategories: [],
    initialEditCategoryId: '',
    initialEditHadSubcategory: false,
    editMileage: '',
    onEditMileageChange: vi.fn(),
    editCurrentMileage: null,
    editComments: '',
    onEditCommentsChange: vi.fn(),
    isSaveEditDisabled: false,
    onSaveEdit: vi.fn(),
    onResetEditForm: vi.fn(),
  };
}

describe('Workshop task dialog tablet safeguards', () => {
  beforeEach(() => {
    localStorage.clear();
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/api/auth/session')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            authenticated: true,
            user: { id: 'workshop-test-user' },
          }),
        } as Response;
      }

      if (url.includes('/api/workshop-tasks/category-attachments')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            templates: [
              { templateId: 'van-template' },
              { templateId: 'hgv-template' },
              { templateId: 'plant-template' },
            ],
          }),
        } as Response;
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response;
    }) as unknown as typeof fetch;
  });

  it('prevents accidental add dialog close when form is dirty', async () => {
    const props = createBaseProps();
    props.workshopComments = 'needs repair details';

    render(
      <TabletModeProvider>
        <WorkshopTaskFormDialogs {...props} />
      </TabletModeProvider>
    );

    fireEvent.click(screen.getByTestId('dialog-request-close'));
    expect(props.onShowAddModalChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('dialog-outside'));
    expect(outsidePrevented).toBe(true);

    fireEvent.click(screen.getByTestId('dialog-escape'));
    expect(escapePrevented).toBe(true);
  });

  it('keeps explicit discard path for dirty add form', async () => {
    const props = createBaseProps();
    props.workshopComments = 'needs repair details';

    render(
      <TabletModeProvider>
        <WorkshopTaskFormDialogs {...props} />
      </TabletModeProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Discard Changes' }));
    expect(props.onShowAddModalChange).toHaveBeenCalledWith(false);
    expect(props.onResetAddForm).toHaveBeenCalled();
  });

  it('applies tablet dialog layout classes when tablet mode is enabled', async () => {
    const props = createBaseProps();
    localStorage.setItem('tablet_mode:workshop-test-user', 'on');

    render(
      <TabletModeProvider>
        <WorkshopTaskFormDialogs {...props} />
      </TabletModeProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('dialog-content').className).toContain('max-w-xl');
    });
    expect(screen.queryByTestId('tablet-action-bar')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Task' })).toBeInTheDocument();
  });

  it('keeps desktop mode unchanged with footer actions', async () => {
    const props = createBaseProps();

    render(
      <TabletModeProvider>
        <WorkshopTaskFormDialogs {...props} />
      </TabletModeProvider>
    );

    await waitFor(() => {
      expect(screen.queryByTestId('tablet-action-bar')).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Task' })).toBeInTheDocument();
  });

  it('uses the same create flow on every tab with no asset-type default', () => {
    const vehicles = [
      { id: 'van-1', reg_number: 'VAN1', nickname: null, asset_type: 'van' as const },
      { id: 'plant-1', reg_number: 'PLANT1', nickname: null, asset_type: 'plant' as const },
      { id: 'hgv-1', reg_number: 'HGV1', nickname: null, asset_type: 'hgv' as const },
    ];

    for (const assetTab of ['all', 'van', 'plant', 'hgv'] as const) {
      const props = createBaseProps();
      props.assetTab = assetTab;
      props.vehicles = vehicles;
      props.getAssetDisplay = (asset) => asset?.reg_number || 'asset';
      const view = render(
        <TabletModeProvider>
          <WorkshopTaskFormDialogs {...props} />
        </TabletModeProvider>
      );

      expect(screen.getByRole('heading', { name: 'Create Workshop Task' })).toBeInTheDocument();
      expect(screen.getByText('Choose an asset type, then the asset and category.')).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Van' })).not.toBeChecked();
      expect(screen.getByRole('radio', { name: 'Plant' })).not.toBeChecked();
      expect(screen.getByRole('radio', { name: 'HGV' })).not.toBeChecked();
      expect(screen.queryByRole('option', { name: 'VAN1' })).not.toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'PLANT1' })).not.toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'HGV1' })).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: /Required form/ })).not.toBeInTheDocument();
      view.unmount();
    }
  });

  it('filters assets by the chosen type and clears dependent fields', async () => {
    const props = createBaseProps();
    props.assetTab = 'van';
    props.vehicles = [
      { id: 'van-1', reg_number: 'VAN1', nickname: null, asset_type: 'van' },
      { id: 'plant-1', reg_number: 'PLANT1', nickname: null, asset_type: 'plant' },
    ];
    props.getAssetDisplay = (asset) => asset?.reg_number || 'asset';
    props.selectedVehicleId = 'van-1';
    props.selectedCategoryId = 'repair';
    props.selectedSubcategoryId = 'sub';
    props.newMeterReading = '120';
    props.selectedAttachmentTemplateIds = ['van-template'];
    props.activeCategories = [
      { id: 'repair', name: 'Repair', slug: 'repair', is_active: true, sort_order: 1 },
      { id: 'service', name: 'Service', slug: 'service', is_active: true, sort_order: 2 },
    ];

    render(
      <TabletModeProvider>
        <WorkshopTaskFormDialogs {...props} />
      </TabletModeProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/no active template matches this asset/)).toBeInTheDocument();
    });
    expect(screen.getByRole('radio', { name: 'Van' })).toBeChecked();
    expect(screen.getByRole('option', { name: 'VAN1' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'PLANT1' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Repair' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Service' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Plant' }));
    expect(props.onSelectedVehicleIdChange).toHaveBeenCalledWith('');
    expect(props.onSelectedCategoryIdChange).toHaveBeenCalledWith('');
    expect(props.onSelectedSubcategoryIdChange).toHaveBeenCalledWith('');
    expect(props.onSelectedAttachmentTemplateIdsChange).toHaveBeenCalledWith([]);
    expect(props.onNewMeterReadingChange).toHaveBeenCalledWith('');
    expect(props.onFetchCurrentMeterReading).toHaveBeenCalledWith('');
    expect(screen.getByRole('option', { name: 'PLANT1' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'VAN1' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('option', { name: 'PLANT1' }));
    expect(props.onSelectedVehicleIdChange).toHaveBeenCalledWith('plant-1');
    expect(props.onFetchCurrentMeterReading).toHaveBeenCalledWith('plant-1');
  });

  it('hides required forms before a category and when the category has no links', async () => {
    const props = createBaseProps();
    props.assetTab = 'hgv';
    props.vehicles = [{ id: 'van-1', reg_number: 'VAN1', nickname: null, asset_type: 'van' }];
    props.selectedVehicleId = 'van-1';
    props.workshopComments = 'needs repair details';
    props.newMeterReading = '100';
    props.attachmentTemplates = [
      { id: 'van-template', name: 'Van Checklist', applies_to: ['van'] },
    ];
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/api/workshop-tasks/category-attachments')) {
        return { ok: true, status: 200, json: async () => ({ templates: [] }) } as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;

    const view = render(
      <TabletModeProvider>
        <WorkshopTaskFormDialogs {...props} />
      </TabletModeProvider>
    );

    expect(screen.queryByRole('heading', { name: /Required form/ })).not.toBeInTheDocument();
    expect(screen.getByText('Choose Repair for repair work. Service and inspection categories may require a checklist.')).toBeInTheDocument();
    view.unmount();

    props.selectedCategoryId = 'repair';
    render(
      <TabletModeProvider>
        <WorkshopTaskFormDialogs {...props} />
      </TabletModeProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('This category does not require a form.')).toBeInTheDocument();
    });
    expect(screen.queryByRole('heading', { name: /Required form/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Van Checklist')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Task' })).toBeEnabled();
  });

  it('requires an explicit linked template and ignores unrelated templates', async () => {
    const props = createBaseProps();
    props.assetTab = 'plant';
    props.vehicles = [{ id: 'van-1', reg_number: 'VAN1', nickname: null, asset_type: 'van' }];
    props.selectedVehicleId = 'van-1';
    props.selectedCategoryId = 'service';
    props.workshopComments = 'needs repair details';
    props.newMeterReading = '100';
    props.attachmentTemplates = [
      { id: 'van-a', name: 'Van Service A', applies_to: ['van'] },
      { id: 'van-b', name: 'Van Service B', applies_to: ['van'] },
      { id: 'hgv-template', name: 'HGV Checklist', applies_to: ['hgv'] },
      { id: 'unlinked', name: 'Unlinked Form', applies_to: ['van'] },
    ];
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/api/workshop-tasks/category-attachments')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ templates: [{ templateId: 'van-a' }, { templateId: 'van-b' }, { templateId: 'hgv-template' }] }),
        } as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;

    render(
      <TabletModeProvider>
        <WorkshopTaskFormDialogs {...props} />
      </TabletModeProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Required form/ })).toBeInTheDocument();
    });
    expect(screen.getByText('This category requires a form. Select the matching form below. Choose Repair instead if this is ordinary repair work.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Van Service A' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Van Service B' })).not.toBeChecked();
    expect(screen.queryByText('HGV Checklist')).not.toBeInTheDocument();
    expect(screen.queryByText('Unlinked Form')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Task' })).toBeDisabled();

    fireEvent.click(screen.getByRole('radio', { name: 'Van Service A' }));
    expect(props.onSelectedAttachmentTemplateIdsChange).toHaveBeenCalledWith(['van-a']);
    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));
    expect(props.onCreateTask).not.toHaveBeenCalled();
  });

  it('auto-selects the only compatible linked template and drops stale ids', async () => {
    const props = createBaseProps();
    props.assetTab = 'all';
    props.vehicles = [{ id: 'van-1', reg_number: 'VAN1', nickname: null, asset_type: 'van' }];
    props.selectedVehicleId = 'van-1';
    props.selectedCategoryId = 'service';
    props.attachmentTemplates = [
      { id: 'van-template', name: 'Van Checklist', applies_to: ['van'] },
      { id: 'hgv-template', name: 'HGV Checklist', applies_to: ['hgv'] },
    ];
    props.selectedAttachmentTemplateIds = ['van-template', 'hgv-template'];

    render(
      <TabletModeProvider>
        <WorkshopTaskFormDialogs {...props} />
      </TabletModeProvider>
    );

    await waitFor(() => {
      expect(props.onSelectedAttachmentTemplateIdsChange).toHaveBeenCalledWith(['van-template']);
    });
    expect(screen.getByText('Van Checklist')).toBeInTheDocument();
    expect(screen.queryByText('HGV Checklist')).not.toBeInTheDocument();
  });

  it('blocks create when category links fail and ignores a stale response', async () => {
    const props = createBaseProps();
    props.vehicles = [{ id: 'van-1', reg_number: 'VAN1', nickname: null, asset_type: 'van' }];
    props.selectedVehicleId = 'van-1';
    props.selectedCategoryId = 'slow-category';
    props.workshopComments = 'needs repair details';
    props.newMeterReading = '100';
    props.attachmentTemplates = [{ id: 'stale-template', name: 'Stale Checklist', applies_to: ['van'] }];

    let releaseStale: ((response: Response) => void) | null = null;
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (!url.includes('/api/workshop-tasks/category-attachments')) {
        return { ok: true, status: 200, json: async () => ({}) } as Response;
      }
      const categoryId = new URL(url, 'http://localhost').searchParams.get('categoryId');
      if (categoryId === 'slow-category') {
        return new Promise<Response>((resolve) => {
          releaseStale = resolve;
        });
      }
      if (categoryId === 'broken') {
        return { ok: false, status: 500, json: async () => ({ error: 'failed' }) } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ templates: [] }) } as Response;
    }) as unknown as typeof fetch;

    const view = render(
      <TabletModeProvider>
        <WorkshopTaskFormDialogs {...props} />
      </TabletModeProvider>
    );

    expect(screen.getByText("Checking this category's form requirement.")).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Required form/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Task' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));
    expect(props.onCreateTask).not.toHaveBeenCalled();

    view.rerender(
      <TabletModeProvider>
        <WorkshopTaskFormDialogs {...props} selectedCategoryId="repair" />
      </TabletModeProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('This category does not require a form.')).toBeInTheDocument();
    });
    releaseStale?.({
      ok: true,
      status: 200,
      json: async () => ({ templates: [{ templateId: 'stale-template' }] }),
    } as Response);
    await waitFor(() => {
      expect(screen.queryByText('Stale Checklist')).not.toBeInTheDocument();
    });
    expect(screen.queryByRole('heading', { name: /Required form/ })).not.toBeInTheDocument();
    view.unmount();

    props.selectedCategoryId = 'broken';
    render(
      <TabletModeProvider>
        <WorkshopTaskFormDialogs {...props} />
      </TabletModeProvider>
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('heading', { name: /Required form/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Task' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));
    expect(props.onCreateTask).not.toHaveBeenCalled();
  });

  it('blocks a configured category whose linked forms are inactive', async () => {
    const props = createBaseProps();
    props.vehicles = [{ id: 'plant-1', reg_number: 'TEST', plant_id: 'TEST', nickname: null, asset_type: 'plant' }];
    props.selectedVehicleId = 'plant-1';
    props.selectedCategoryId = 'service';
    props.newMeterReading = '100';
    props.workshopComments = 'Scheduled service';
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ templates: [], allTemplates: [{ templateId: 'inactive', isActive: false }] }),
    } as Response)) as unknown as typeof fetch;
    render(<TabletModeProvider><WorkshopTaskFormDialogs {...props} /></TabletModeProvider>);
    await waitFor(() => expect(screen.getByRole('heading', { name: /Required form/ })).toBeInTheDocument());
    expect(screen.getByText(/no active template matches this asset/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Task' })).toBeDisabled();
    expect(screen.queryByText('This category does not require a form.')).not.toBeInTheDocument();
  });
});
