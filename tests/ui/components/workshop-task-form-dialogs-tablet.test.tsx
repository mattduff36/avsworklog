import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkshopTaskFormDialogs } from '@/app/(dashboard)/workshop-tasks/components/WorkshopTaskFormDialogs';
import { TabletModeProvider } from '@/components/layout/tablet-mode-context';
import type React from 'react';

let outsidePrevented = false;
let escapePrevented = false;

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: 'workshop-test-user' } },
      })),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
  }),
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

vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectSeparator: () => <hr />,
  SelectValue: () => <span>value</span>,
}));

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

vi.mock('@/components/ui/tablet-mode-controls', () => ({
  TabletAwareButton: ({ children, ...props }: React.ComponentProps<'button'>) => <button {...props}>{children}</button>,
  TabletAwareSelectTrigger: ({ children, ...props }: React.ComponentProps<'button'>) => <button {...props}>{children}</button>,
  TabletAwareSelectContent: ({ children, ...props }: React.ComponentProps<'div'>) => <div {...props}>{children}</div>,
  TabletAwareSelectItem: ({ children, ...props }: React.ComponentProps<'div'>) => <div {...props}>{children}</div>,
}));

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
});
