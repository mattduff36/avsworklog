import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectGroup, SelectLabel, SelectSeparator, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FileText } from 'lucide-react';
import { splitVehiclesByRecent } from '@/lib/utils/recentVehicles';
import { triggerShakeAnimation } from '@/lib/utils/animations';
import { useTabletMode } from '@/components/layout/tablet-mode-context';
import { useWorkshopDraftPersistence } from '@/lib/hooks/useWorkshopDraftPersistence';
import { WORKSHOP_TASK_COMMENT_MIN_LENGTH } from '@/lib/workshop-tasks/validation';
import {
  TabletAwareButton,
  TabletAwareSelectContent,
  TabletAwareSelectItem,
  TabletAwareSelectTrigger,
} from '@/components/ui/tablet-mode-controls';
import type { Action, AssetTab, Category, Subcategory, Vehicle } from '../types';

interface AttachmentTemplate {
  id: string;
  name: string;
  applies_to?: string[] | null;
}

function normalizeTemplateAppliesTo(rawValues?: string[] | null): string[] {
  const normalizedValues = (rawValues || [])
    .map((value) => value.trim().toLowerCase())
    .map((value) => (value === 'vehicle' ? 'van' : value))
    .filter(Boolean);

  if (normalizedValues.length === 0) return ['van', 'hgv', 'plant'];
  return Array.from(new Set(normalizedValues));
}

type WorkshopAssetType = 'van' | 'plant' | 'hgv';

const CREATE_ASSET_TYPE_OPTIONS: Array<{ value: WorkshopAssetType; label: string }> = [
  { value: 'van', label: 'Van' },
  { value: 'plant', label: 'Plant' },
  { value: 'hgv', label: 'HGV' },
];

function readWorkshopAssetType(value?: string | null): WorkshopAssetType | '' {
  return value === 'van' || value === 'plant' || value === 'hgv' ? value : '';
}

type CategoryLinkState =
  | { status: 'idle' }
  | { status: 'loading'; categoryId: string }
  | { status: 'error'; categoryId: string }
  | { status: 'ready'; categoryId: string; linkedIds: string[] };

interface WorkshopTaskFormDialogsProps {
  userId?: string | null;
  showAddModal: boolean;
  onShowAddModalChange: (open: boolean) => void;
  assetTab: AssetTab;
  selectedVehicleId: string;
  onSelectedVehicleIdChange: (value: string) => void;
  vehicles: Vehicle[];
  getAssetDisplay: (
    asset?: {
      reg_number?: string | null;
      plant_id?: string | null;
      nickname?: string | null;
      category?: string | null;
      asset_type?: string | null;
    },
    options?: { forSelect?: boolean },
  ) => string;
  selectedCategoryId: string;
  onSelectedCategoryIdChange: (value: string) => void;
  activeCategories: Category[];
  categoryHasSubcategories: boolean;
  selectedSubcategoryId: string;
  onSelectedSubcategoryIdChange: (value: string) => void;
  filteredSubcategories: Subcategory[];
  meterReadingType: 'mileage' | 'hours';
  newMeterReading: string;
  onNewMeterReadingChange: (value: string) => void;
  currentMeterReading: number | null;
  workshopComments: string;
  onWorkshopCommentsChange: (value: string) => void;
  attachmentTemplates: AttachmentTemplate[];
  selectedAttachmentTemplateIds: string[];
  onSelectedAttachmentTemplateIdsChange: (ids: string[]) => void;
  submitting: boolean;
  onResetAddForm: () => void;
  onFetchCurrentMeterReading: (vehicleId: string) => void;
  onCreateTask: () => void;
  showEditModal: boolean;
  onShowEditModalChange: (open: boolean) => void;
  editingTask: Action | null;
  editVehicleId: string;
  onEditVehicleIdChange: (value: string) => void;
  recentVehicleIds: string[];
  editCategoryId: string;
  onEditCategoryIdChange: (value: string) => void;
  categories: Category[];
  plantCategories: Category[];
  hgvCategories: Category[];
  editSubcategoryId: string;
  onEditSubcategoryIdChange: (value: string) => void;
  subcategories: Subcategory[];
  plantSubcategories: Subcategory[];
  hgvSubcategories: Subcategory[];
  initialEditCategoryId: string;
  initialEditHadSubcategory: boolean;
  editMileage: string;
  onEditMileageChange: (value: string) => void;
  editCurrentMileage: number | null;
  editComments: string;
  onEditCommentsChange: (value: string) => void;
  isSaveEditDisabled: boolean;
  onSaveEdit: () => void;
  onResetEditForm: () => void;
}

export function WorkshopTaskFormDialogs({
  userId,
  showAddModal,
  onShowAddModalChange,
  assetTab,
  selectedVehicleId,
  onSelectedVehicleIdChange,
  vehicles,
  getAssetDisplay,
  selectedCategoryId,
  onSelectedCategoryIdChange,
  activeCategories,
  categoryHasSubcategories,
  selectedSubcategoryId,
  onSelectedSubcategoryIdChange,
  filteredSubcategories,
  newMeterReading,
  onNewMeterReadingChange,
  currentMeterReading,
  workshopComments,
  onWorkshopCommentsChange,
  attachmentTemplates,
  selectedAttachmentTemplateIds,
  onSelectedAttachmentTemplateIdsChange,
  submitting,
  onResetAddForm,
  onFetchCurrentMeterReading,
  onCreateTask,
  showEditModal,
  onShowEditModalChange,
  editingTask,
  editVehicleId,
  onEditVehicleIdChange,
  recentVehicleIds,
  editCategoryId,
  onEditCategoryIdChange,
  categories,
  plantCategories,
  hgvCategories,
  editSubcategoryId,
  onEditSubcategoryIdChange,
  subcategories,
  plantSubcategories,
  hgvSubcategories,
  initialEditCategoryId,
  initialEditHadSubcategory,
  editMileage,
  onEditMileageChange,
  editCurrentMileage,
  editComments,
  onEditCommentsChange,
  isSaveEditDisabled,
  onSaveEdit,
  onResetEditForm,
}: WorkshopTaskFormDialogsProps) {
  const { tabletModeEnabled } = useTabletMode();
  const addDialogContentRef = useRef<HTMLDivElement>(null);
  const editDialogContentRef = useRef<HTMLDivElement>(null);
  const vehiclesRef = useRef(vehicles);
  useEffect(() => {
    vehiclesRef.current = vehicles;
  }, [vehicles]);
  const [assetTypeChoice, setAssetTypeChoice] = useState<WorkshopAssetType | ''>('');
  const [addModalWasOpen, setAddModalWasOpen] = useState(showAddModal);
  const [categoryLinkResult, setCategoryLinkResult] = useState<{
    categoryId: string;
    status: 'error' | 'ready';
    linkedIds: string[];
  } | null>(null);
  const [categoryLinkRetry, setCategoryLinkRetry] = useState(0);
  const categoryLinkRequestRef = useRef(0);
  if (addModalWasOpen !== showAddModal) {
    setAddModalWasOpen(showAddModal);
    if (!showAddModal) setAssetTypeChoice('');
  }
  const categoryLinkState = useMemo<CategoryLinkState>(() => {
    if (!selectedCategoryId) return { status: 'idle' };
    if (categoryLinkResult?.categoryId !== selectedCategoryId) {
      return { status: 'loading', categoryId: selectedCategoryId };
    }
    if (categoryLinkResult.status === 'ready') {
      return { status: 'ready', categoryId: selectedCategoryId, linkedIds: categoryLinkResult.linkedIds };
    }
    return { status: 'error', categoryId: selectedCategoryId };
  }, [categoryLinkResult, selectedCategoryId]);
  const selectedAddVehicle = vehicles.find((vehicle) => vehicle.id === selectedVehicleId);
  const selectedAddAssetType = assetTypeChoice || readWorkshopAssetType(selectedAddVehicle?.asset_type);
  const isAddFormDirty = Boolean(
    selectedAddAssetType ||
      selectedVehicleId ||
      selectedCategoryId ||
      selectedSubcategoryId ||
      newMeterReading.trim() ||
      workshopComments.trim() ||
      selectedAttachmentTemplateIds.length > 0
  );

  const editTaskVehicleId = editingTask?.van_id ?? editingTask?.hgv_id ?? editingTask?.plant_id ?? '';
  const editTaskComments = editingTask?.workshop_comments ?? '';
  const editTaskSubcategoryId = editingTask?.workshop_subcategory_id ?? '';
  const isEditFormDirty = Boolean(
    editVehicleId !== editTaskVehicleId ||
      editCategoryId !== initialEditCategoryId ||
      editSubcategoryId !== editTaskSubcategoryId ||
      editComments !== editTaskComments ||
      editMileage.trim()
  );
  useEffect(() => {
    if (!selectedCategoryId) return undefined;
    const requestId = categoryLinkRequestRef.current + 1;
    categoryLinkRequestRef.current = requestId;
    const categoryId = selectedCategoryId;

    void (async () => {
      try {
        const response = await fetch(
          `/api/workshop-tasks/category-attachments?categoryId=${encodeURIComponent(categoryId)}`,
        );
        const data = await response.json().catch(() => null);
        if (categoryLinkRequestRef.current !== requestId) return;
        if (!response.ok || !data || !Array.isArray(data.templates)) {
          setCategoryLinkResult({ status: 'error', categoryId, linkedIds: [] });
          return;
        }
        const linkedIds = ((Array.isArray(data.allTemplates) ? data.allTemplates : data.templates) as Array<{ templateId?: string }>)
          .map((template) => template.templateId || '')
          .filter(Boolean);
        setCategoryLinkResult({ status: 'ready', categoryId, linkedIds });
      } catch {
        if (categoryLinkRequestRef.current !== requestId) return;
        setCategoryLinkResult({ status: 'error', categoryId, linkedIds: [] });
      }
    })();

    return () => {
      categoryLinkRequestRef.current += 1;
    };
  }, [categoryLinkRetry, selectedCategoryId]);

  const linkedCategoryTemplateIds =
    categoryLinkState.status === 'ready' && categoryLinkState.categoryId === selectedCategoryId
      ? categoryLinkState.linkedIds
      : [];
  const compatibleLinkedTemplates = useMemo(() => {
    if (!selectedAddAssetType || categoryLinkState.status !== 'ready' || categoryLinkState.categoryId !== selectedCategoryId) {
      return [];
    }
    if (categoryLinkState.linkedIds.length === 0) return [];
    const linkedIds = new Set(categoryLinkState.linkedIds);
    return attachmentTemplates.filter(
      (template) =>
        linkedIds.has(template.id) &&
        normalizeTemplateAppliesTo(template.applies_to).includes(selectedAddAssetType),
    );
  }, [attachmentTemplates, categoryLinkState, selectedAddAssetType, selectedCategoryId]);

  useEffect(() => {
    if (!selectedCategoryId || categoryLinkState.status === 'loading' || categoryLinkState.status === 'idle') {
      return;
    }
    if (categoryLinkState.status === 'error' || categoryLinkState.categoryId !== selectedCategoryId) {
      if (selectedAttachmentTemplateIds.length > 0) onSelectedAttachmentTemplateIdsChange([]);
      return;
    }
    if (!selectedAddAssetType || categoryLinkState.linkedIds.length === 0 || compatibleLinkedTemplates.length === 0) {
      if (selectedAttachmentTemplateIds.length > 0) onSelectedAttachmentTemplateIdsChange([]);
      return;
    }
    if (compatibleLinkedTemplates.length === 1) {
      const onlyId = compatibleLinkedTemplates[0]?.id;
      if (onlyId && (selectedAttachmentTemplateIds.length !== 1 || selectedAttachmentTemplateIds[0] !== onlyId)) {
        onSelectedAttachmentTemplateIdsChange([onlyId]);
      }
      return;
    }
    const allowedIds = new Set(compatibleLinkedTemplates.map((template) => template.id));
    const nextIds = selectedAttachmentTemplateIds.filter((id) => allowedIds.has(id));
    if (nextIds.length > 1) {
      onSelectedAttachmentTemplateIdsChange([]);
      return;
    }
    if (nextIds.length !== selectedAttachmentTemplateIds.length) {
      onSelectedAttachmentTemplateIdsChange(nextIds);
    }
  }, [
    categoryLinkState,
    compatibleLinkedTemplates,
    onSelectedAttachmentTemplateIdsChange,
    selectedAddAssetType,
    selectedAttachmentTemplateIds,
    selectedCategoryId,
  ]);
  const addUsesKm = selectedAddAssetType === 'hgv';
  const addUsesHours = selectedAddAssetType === 'plant';
  const addMeterLabel = addUsesHours ? 'Current Hours' : addUsesKm ? 'Current KM' : 'Current Mileage';
  const addMeterPlaceholder = addUsesHours ? 'hours' : addUsesKm ? 'KM' : 'mileage';
  const addMeterUnit = addUsesHours ? 'hours' : addUsesKm ? 'km' : 'miles';
  const editUsesKm = !editingTask?.plant_id && Boolean(editingTask?.hgv_id);
  const editMeterLabel = editingTask?.plant_id ? 'Current Hours' : editUsesKm ? 'Current KM' : 'Current Mileage';
  const editMeterPlaceholder = editingTask?.plant_id ? 'hours' : editUsesKm ? 'KM' : 'mileage';
  const editMeterUnit = editingTask?.plant_id ? 'hours' : editUsesKm ? 'km' : 'miles';
  const { clearDraft: clearAddDraft } = useWorkshopDraftPersistence({
    enabled: showAddModal,
    // Retain existing draft keys; the tab never determines asset or category choices.
    draftId: `workshop-task-add:${userId || 'anonymous'}:${assetTab}`,
    kind: 'workshop-task-add',
    ownerId: userId,
    value: {
      selectedAddAssetType,
      selectedVehicleId,
      selectedCategoryId,
      selectedSubcategoryId,
      newMeterReading,
      workshopComments,
      selectedAttachmentTemplateIds,
    },
    isDirty: isAddFormDirty,
    onRestore: (draft) => {
      setCategoryLinkResult(null);
      const restoredVehicle = vehiclesRef.current.find((vehicle) => vehicle.id === draft.selectedVehicleId);
      const restoredType =
        readWorkshopAssetType(draft.selectedAddAssetType) ||
        readWorkshopAssetType(restoredVehicle?.asset_type);
      setAssetTypeChoice(restoredType);
      onSelectedVehicleIdChange(draft.selectedVehicleId || '');
      onFetchCurrentMeterReading(draft.selectedVehicleId || '');
      onSelectedCategoryIdChange(draft.selectedCategoryId || '');
      onSelectedSubcategoryIdChange(draft.selectedSubcategoryId || '');
      onNewMeterReadingChange(draft.newMeterReading || '');
      onWorkshopCommentsChange(draft.workshopComments || '');
      onSelectedAttachmentTemplateIdsChange(draft.selectedAttachmentTemplateIds || []);
    },
  });
  const { clearDraft: clearEditDraft } = useWorkshopDraftPersistence({
    enabled: showEditModal && Boolean(editingTask),
    draftId: `workshop-task-edit:${userId || 'anonymous'}:${editingTask?.id || 'none'}`,
    kind: 'workshop-task-edit',
    ownerId: userId,
    value: {
      editVehicleId,
      editCategoryId,
      editSubcategoryId,
      editMileage,
      editComments,
    },
    isDirty: isEditFormDirty,
    onRestore: (draft) => {
      onEditVehicleIdChange(draft.editVehicleId || '');
      onEditCategoryIdChange(draft.editCategoryId || '');
      onEditSubcategoryIdChange(draft.editSubcategoryId || '');
      onEditMileageChange(draft.editMileage || '');
      onEditCommentsChange(draft.editComments || '');
    },
  });

  useEffect(() => {
    if (!showAddModal && !isAddFormDirty) {
      void clearAddDraft();
    }
  }, [clearAddDraft, isAddFormDirty, showAddModal]);

  useEffect(() => {
    if (!showEditModal && !isEditFormDirty) {
      void clearEditDraft();
    }
  }, [clearEditDraft, isEditFormDirty, showEditModal]);

  function handleAddDialogOpenChange(open: boolean) {
    if (!open && isAddFormDirty) {
      triggerShakeAnimation(addDialogContentRef.current);
      return;
    }

    onShowAddModalChange(open);
    if (!open) {
      onResetAddForm();
    }
  }

  function handleEditDialogOpenChange(open: boolean) {
    if (!open && isEditFormDirty) {
      triggerShakeAnimation(editDialogContentRef.current);
      return;
    }

    onShowEditModalChange(open);
  }

  function clearCreateDependents(options: { clearAsset: boolean }) {
    setCategoryLinkResult(null);
    if (options.clearAsset) onSelectedVehicleIdChange('');
    onSelectedCategoryIdChange('');
    onSelectedSubcategoryIdChange('');
    onSelectedAttachmentTemplateIdsChange([]);
    onNewMeterReadingChange('');
    onFetchCurrentMeterReading('');
  }

  function handleAssetTypeChange(nextType: WorkshopAssetType) {
    if (nextType === selectedAddAssetType) return;
    setAssetTypeChoice(nextType);
    clearCreateDependents({ clearAsset: true });
  }

  function handleAssetChange(nextVehicleId: string) {
    if (nextVehicleId === selectedVehicleId) return;
    setCategoryLinkResult(null);
    onSelectedVehicleIdChange(nextVehicleId);
    onSelectedCategoryIdChange('');
    onSelectedSubcategoryIdChange('');
    onSelectedAttachmentTemplateIdsChange([]);
    onNewMeterReadingChange('');
    onFetchCurrentMeterReading(nextVehicleId);
  }

  function handleCategoryChange(nextCategoryId: string) {
    if (nextCategoryId === selectedCategoryId) return;
    setCategoryLinkResult(null);
    onSelectedCategoryIdChange(nextCategoryId);
    onSelectedAttachmentTemplateIdsChange([]);
  }

  const categoryLinksReady = categoryLinkState.status === 'ready' && categoryLinkState.categoryId === selectedCategoryId;
  const categoryRequiresForm = categoryLinksReady && linkedCategoryTemplateIds.length > 0;
  const categoryLinksBlockCreate =
    !selectedAddAssetType ||
    !selectedVehicleId ||
    !selectedCategoryId ||
    !categoryLinksReady ||
    (categoryRequiresForm && (
      compatibleLinkedTemplates.length === 0 ||
      selectedAttachmentTemplateIds.length !== 1 ||
      !compatibleLinkedTemplates.some((template) => template.id === selectedAttachmentTemplateIds[0])
    ));
  const showRequiredFormSection = categoryRequiresForm;
  const assetTypeLabel = selectedAddAssetType === 'plant' ? 'plant' : selectedAddAssetType === 'hgv' ? 'HGV' : selectedAddAssetType === 'van' ? 'van' : 'asset';

  function handleCreateTask() {
    if (submitting || categoryLinksBlockCreate) return;
    if (workshopComments.trim().length < WORKSHOP_TASK_COMMENT_MIN_LENGTH || !newMeterReading.trim()) return;
    onCreateTask();
  }

  return (
    <>
      <Dialog
        open={showAddModal}
        onOpenChange={handleAddDialogOpenChange}
      >
        <DialogContent
          ref={addDialogContentRef}
          data-accent="workshop"
          mobileKeyboardSafe
          className={`border-slate-700 bg-slate-900 text-slate-100 max-w-xl overflow-y-auto max-h-[92dvh] ${
            tabletModeEnabled ? 'max-w-2xl p-5 sm:p-6' : ''
          }`}
          onInteractOutside={(event) => {
            if (isAddFormDirty) {
              event.preventDefault();
              triggerShakeAnimation(addDialogContentRef.current);
            }
          }}
          onEscapeKeyDown={(event) => {
            if (isAddFormDirty) {
              event.preventDefault();
              triggerShakeAnimation(addDialogContentRef.current);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-foreground text-xl">Create Workshop Task</DialogTitle>
            <DialogDescription className="text-slate-300">
              Choose an asset type, then the asset and category.
            </DialogDescription>
          </DialogHeader>

          <div className={tabletModeEnabled ? 'space-y-5' : 'space-y-4'}>
            <section className="space-y-3 border-b border-slate-700 pb-4">
              <h3 className="text-base font-semibold text-slate-100">Asset</h3>
              <div className="space-y-2">
                <Label id="add-asset-type-label" className="text-slate-100">
                  Asset type <span className="text-red-400">*</span>
                </Label>
                <div
                  role="radiogroup"
                  aria-labelledby="add-asset-type-label"
                  className="grid grid-cols-3 gap-1 rounded-md border border-slate-700 bg-slate-950 p-1"
                >
                  {CREATE_ASSET_TYPE_OPTIONS.map((option) => {
                    const checked = selectedAddAssetType === option.value;
                    return (
                      <label
                        key={option.value}
                        className={`flex min-h-11 cursor-pointer items-center justify-center rounded-md px-2 text-sm font-medium focus-within:ring-2 focus-within:ring-workshop md:min-h-9 ${
                          checked ? 'bg-workshop text-white' : 'text-slate-200 hover:bg-slate-800'
                        }`}
                      >
                        <input
                          type="radio"
                          name="workshop-create-asset-type"
                          value={option.value}
                          checked={checked}
                          onChange={() => handleAssetTypeChange(option.value)}
                          className="sr-only"
                        />
                        {option.label}
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="vehicle" className="text-slate-100">
                  Asset <span className="text-red-400">*</span>
                </Label>
                <Select
                  value={selectedVehicleId}
                  onValueChange={handleAssetChange}
                  disabled={!selectedAddAssetType}
                >
                  <TabletAwareSelectTrigger
                    id="vehicle"
                    disabled={!selectedAddAssetType}
                    className="border-slate-700 bg-slate-800 text-slate-100"
                  >
                    <SelectValue placeholder={selectedAddAssetType ? `Select ${assetTypeLabel}` : 'Select an asset type first'} />
                  </TabletAwareSelectTrigger>
                  <TabletAwareSelectContent>
                    {vehicles
                      .filter((vehicle) => vehicle.asset_type === selectedAddAssetType)
                      .map((vehicle) => (
                        <TabletAwareSelectItem key={vehicle.id} value={vehicle.id}>
                          {getAssetDisplay(vehicle, { forSelect: true })}
                        </TabletAwareSelectItem>
                      ))}
                  </TabletAwareSelectContent>
                </Select>
              </div>
            </section>

            <section className="space-y-3 border-b border-slate-700 pb-4">
              <h3 className="text-base font-semibold text-slate-100">Category</h3>
              <p className="rounded-md bg-slate-800 px-3 py-2 text-sm text-slate-200">
                Choose Repair for repair work. Service and inspection categories may require a checklist.
              </p>
              <div className="space-y-2">
                <Label htmlFor="category" className="text-slate-100">
                  Category <span className="text-red-400">*</span>
                </Label>
                <Select
                  value={selectedCategoryId}
                  onValueChange={handleCategoryChange}
                  disabled={!selectedVehicleId}
                >
                  <TabletAwareSelectTrigger
                    id="category"
                    disabled={!selectedVehicleId}
                    className="border-slate-700 bg-slate-800 text-slate-100"
                  >
                    <SelectValue placeholder={selectedVehicleId ? 'Select category' : 'Select an asset first'} />
                  </TabletAwareSelectTrigger>
                  <TabletAwareSelectContent>
                    {activeCategories.map((category) => (
                      <TabletAwareSelectItem key={category.id} value={category.id}>
                        {category.name}
                      </TabletAwareSelectItem>
                    ))}
                  </TabletAwareSelectContent>
                </Select>
              </div>
              {selectedCategoryId && categoryLinkState.status === 'loading' && (
                <p className="text-sm text-slate-200">Checking this category&apos;s form requirement.</p>
              )}
              {categoryLinkState.status === 'error' && (
                <div className="space-y-2" role="alert">
                  <p className="text-sm text-red-300">Unable to check this category&apos;s form requirements. Retry before creating the task.</p>
                  <TabletAwareButton type="button" variant="outline" onClick={() => {
                    setCategoryLinkResult(null);
                    setCategoryLinkRetry((retry) => retry + 1);
                  }}>Retry</TabletAwareButton>
                </div>
              )}
              {categoryLinksReady && linkedCategoryTemplateIds.length === 0 && (
                <p className="text-sm text-slate-200">This category does not require a form.</p>
              )}
              {categoryRequiresForm && compatibleLinkedTemplates.length > 0 && (
                <p className="text-sm text-slate-50">
                  This category requires a form. Select the matching form below. Choose Repair instead if this is ordinary repair work.
                </p>
              )}
            </section>

            {categoryHasSubcategories && (
              <div className="space-y-2">
                <Label htmlFor="subcategory" className="text-foreground">
                  Subcategory <span className="text-red-500">*</span>
                </Label>
                <Select
                  value={selectedSubcategoryId}
                  onValueChange={onSelectedSubcategoryIdChange}
                  disabled={!selectedCategoryId}
                >
                  <TabletAwareSelectTrigger id="subcategory" className="bg-white dark:bg-slate-800 border-border text-foreground">
                    <SelectValue placeholder={selectedCategoryId ? 'Select subcategory' : 'Select a category first'} />
                  </TabletAwareSelectTrigger>
                  <TabletAwareSelectContent>
                    {filteredSubcategories.map((subcategory) => (
                      <TabletAwareSelectItem key={subcategory.id} value={subcategory.id}>
                        {subcategory.name}
                      </TabletAwareSelectItem>
                    ))}
                  </TabletAwareSelectContent>
                </Select>
              </div>
            )}

            <section className="space-y-3">
              <h3 className="text-base font-semibold text-slate-100">Details</h3>
              <div className="space-y-2">
                <Label htmlFor="mileage" className="text-slate-100">
                  {addMeterLabel} <span className="text-red-400">*</span>
                </Label>
                <Input
                  id="mileage"
                  type="number"
                  value={newMeterReading}
                  onChange={(e) => onNewMeterReadingChange(e.target.value)}
                  placeholder={`Enter current ${addMeterPlaceholder}`}
                  className="border-slate-700 bg-slate-800 text-base text-slate-100 md:text-sm"
                  min="0"
                  step="1"
                />
                {currentMeterReading !== null && (
                  <p className="text-xs text-slate-400">
                    Last recorded: {currentMeterReading.toLocaleString()} {addMeterUnit}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="comments" className="text-slate-100">
                  Task Details <span className="text-red-400">*</span>
                </Label>
                <Textarea
                  id="comments"
                  value={workshopComments}
                  onChange={(e) => onWorkshopCommentsChange(e.target.value)}
                  placeholder={`Describe the work needed (minimum ${WORKSHOP_TASK_COMMENT_MIN_LENGTH} characters)`}
                  className="min-h-[100px] border-slate-700 bg-slate-800 text-base text-slate-100 md:text-sm"
                  maxLength={300}
                />
                <p className="text-xs text-slate-400">
                  {workshopComments.length}/300 characters (minimum {WORKSHOP_TASK_COMMENT_MIN_LENGTH})
                </p>
              </div>
            </section>

            {showRequiredFormSection && (
              <section className="space-y-2 rounded-lg border border-workshop/40 bg-slate-950/60 p-3" aria-labelledby="required-form-heading">
                <h3 id="required-form-heading" className="flex items-center gap-2 text-base font-semibold text-slate-100">
                  <FileText className="h-4 w-4" aria-hidden="true" />
                  Required form
                  <span className="text-red-400">*</span>
                </h3>
                {categoryRequiresForm && compatibleLinkedTemplates.length === 0 && (
                  <p className="text-sm text-red-300">
                    This category requires a form, but no active template matches this asset. Choose Repair instead if this is ordinary repair work.
                  </p>
                )}
                {categoryRequiresForm && compatibleLinkedTemplates.length > 0 && (
                  <div className={`max-h-40 space-y-2 overflow-y-auto rounded-md border border-slate-700 bg-slate-900 p-2 ${tabletModeEnabled ? 'p-3' : ''}`}>
                    {compatibleLinkedTemplates.map((template) => (
                      <div key={template.id} className={`flex items-center ${tabletModeEnabled ? 'space-x-3 py-1' : 'space-x-2'}`}>
                        <input
                          type="radio"
                          name="workshop-create-required-form"
                          id={`template-inline-${template.id}`}
                          checked={selectedAttachmentTemplateIds.length === 1 && selectedAttachmentTemplateIds[0] === template.id}
                          onChange={() => onSelectedAttachmentTemplateIdsChange([template.id])}
                          className={`border-slate-500 text-workshop focus:ring-workshop ${tabletModeEnabled ? 'h-5 w-5' : 'h-4 w-4'}`}
                        />
                        <label
                          htmlFor={`template-inline-${template.id}`}
                          className={`cursor-pointer font-normal text-slate-100 ${tabletModeEnabled ? 'text-base' : 'text-sm'}`}
                        >
                          {template.name}
                        </label>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>

          <DialogFooter className={tabletModeEnabled ? 'gap-3 pt-2' : 'gap-3'}>
            <TabletAwareButton
              variant="outline"
              onClick={() => {
                void clearAddDraft();
                onShowAddModalChange(false);
                onResetAddForm();
              }}
              className="border-border text-foreground hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {isAddFormDirty ? 'Discard Changes' : 'Cancel'}
            </TabletAwareButton>
            <TabletAwareButton
              type="button"
              onClick={handleCreateTask}
              disabled={
                submitting ||
                categoryLinksBlockCreate ||
                workshopComments.trim().length < WORKSHOP_TASK_COMMENT_MIN_LENGTH ||
                !newMeterReading.trim()
              }
              className="bg-workshop text-white hover:bg-workshop-dark"
            >
              {submitting ? 'Creating...' : 'Create Task'}
            </TabletAwareButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showEditModal} onOpenChange={handleEditDialogOpenChange}>
        <DialogContent
          ref={editDialogContentRef}
          data-accent="workshop"
          className={`bg-white dark:bg-slate-900 border-border text-foreground max-w-lg overflow-y-auto max-h-[92vh] ${
            tabletModeEnabled ? 'max-w-xl p-5 sm:p-6' : ''
          }`}
          onInteractOutside={(event) => {
            if (isEditFormDirty) {
              event.preventDefault();
              triggerShakeAnimation(editDialogContentRef.current);
            }
          }}
          onEscapeKeyDown={(event) => {
            if (isEditFormDirty) {
              event.preventDefault();
              triggerShakeAnimation(editDialogContentRef.current);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-foreground text-xl">
              Edit Workshop Task
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Update the workshop task details
            </DialogDescription>
          </DialogHeader>

          <div className={tabletModeEnabled ? 'space-y-5' : 'space-y-4'}>
            <div className="space-y-2">
              <Label htmlFor="edit-vehicle" className="text-foreground">
                {editingTask?.plant_id ? 'Plant' : editingTask?.hgv_id ? 'HGV' : 'Van'} <span className="text-red-500">*</span>
              </Label>
              <Select value={editVehicleId} onValueChange={onEditVehicleIdChange}>
                <TabletAwareSelectTrigger id="edit-vehicle" className="bg-white dark:bg-slate-800 border-border text-foreground">
                  <SelectValue placeholder={editingTask?.plant_id ? 'Select plant' : editingTask?.hgv_id ? 'Select HGV' : 'Select van'} />
                </TabletAwareSelectTrigger>
                <TabletAwareSelectContent>
                  {(() => {
                    const isEditingPlant = !!editingTask?.plant_id;
                    const isEditingHgv = !!editingTask?.hgv_id;
                    const filteredVehicles = vehicles.filter(v =>
                      isEditingPlant ? v.asset_type === 'plant' : isEditingHgv ? v.asset_type === 'hgv' : v.asset_type === 'van'
                    );
                    const { recentVehicles, otherVehicles } = splitVehiclesByRecent(filteredVehicles, recentVehicleIds);
                    return (
                      <>
                        {recentVehicles.length > 0 && (
                          <SelectGroup>
                            <SelectLabel className="text-muted-foreground text-xs px-2 py-1.5">Recent</SelectLabel>
                            {recentVehicles.map((vehicle) => (
                              <TabletAwareSelectItem key={vehicle.id} value={vehicle.id}>
                                {getAssetDisplay(vehicle, { forSelect: true })}
                              </TabletAwareSelectItem>
                            ))}
                          </SelectGroup>
                        )}
                        {recentVehicles.length > 0 && otherVehicles.length > 0 && (
                          <SelectSeparator />
                        )}
                        {otherVehicles.length > 0 && (
                          <SelectGroup>
                            {recentVehicles.length > 0 && (
                              <SelectLabel className="text-muted-foreground text-xs px-2 py-1.5">All {isEditingPlant ? 'Plant' : isEditingHgv ? 'HGVs' : 'Vans'}</SelectLabel>
                            )}
                            {otherVehicles.map((vehicle) => (
                              <TabletAwareSelectItem key={vehicle.id} value={vehicle.id}>
                                {getAssetDisplay(vehicle, { forSelect: true })}
                              </TabletAwareSelectItem>
                            ))}
                          </SelectGroup>
                        )}
                      </>
                    );
                  })()}
                </TabletAwareSelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-category" className="text-foreground">
                Category <span className="text-red-500">*</span>
              </Label>
              <Select value={editCategoryId} onValueChange={onEditCategoryIdChange}>
                <TabletAwareSelectTrigger id="edit-category" className="bg-white dark:bg-slate-800 border-border text-foreground">
                  <SelectValue placeholder="Select category" />
                </TabletAwareSelectTrigger>
                <TabletAwareSelectContent>
                  {(() => {
                    const editCategories = editingTask?.plant_id ? plantCategories : editingTask?.hgv_id ? hgvCategories : categories;
                    return editCategories.map((category) => (
                      <TabletAwareSelectItem key={category.id} value={category.id}>
                        {category.name}
                      </TabletAwareSelectItem>
                    ));
                  })()}
                </TabletAwareSelectContent>
              </Select>
            </div>

            {(() => {
              const editSubcategoriesArray = editingTask?.plant_id ? plantSubcategories : editingTask?.hgv_id ? hgvSubcategories : subcategories;
              const editFilteredSubcategories = editSubcategoriesArray.filter(s => s.category_id === editCategoryId);
              if (editFilteredSubcategories.length === 0) return null;

              const categoryChanged = editCategoryId !== initialEditCategoryId;
              const isRequired = initialEditHadSubcategory || categoryChanged;

              return (
                <div className="space-y-2">
                  <Label htmlFor="edit-subcategory" className="text-foreground">
                    Subcategory {isRequired && <span className="text-red-500">*</span>}
                  </Label>
                  <Select value={editSubcategoryId} onValueChange={onEditSubcategoryIdChange}>
                    <TabletAwareSelectTrigger id="edit-subcategory" className="bg-white dark:bg-slate-800 border-border text-foreground">
                      <SelectValue placeholder="Select subcategory" />
                    </TabletAwareSelectTrigger>
                    <TabletAwareSelectContent>
                      {editFilteredSubcategories.map((sub) => (
                        <TabletAwareSelectItem key={sub.id} value={sub.id}>
                          {sub.name}
                        </TabletAwareSelectItem>
                      ))}
                    </TabletAwareSelectContent>
                  </Select>
                </div>
              );
            })()}

            <div className="space-y-2">
              <Label htmlFor="edit-mileage" className="text-foreground">
                {editMeterLabel} <span className="text-red-500">*</span>
              </Label>
              <Input
                id="edit-mileage"
                type="number"
                value={editMileage}
                onChange={(e) => onEditMileageChange(e.target.value)}
                placeholder={`Enter current ${editMeterPlaceholder}`}
                className="bg-white dark:bg-slate-800 border-border text-foreground"
                min="0"
                step="1"
              />
              {editCurrentMileage !== null && (
                <p className="text-xs text-muted-foreground">
                  Last recorded: {editCurrentMileage.toLocaleString()} {editMeterUnit}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-comments" className="text-foreground">
                Task Details <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="edit-comments"
                value={editComments}
                onChange={(e) => onEditCommentsChange(e.target.value)}
                placeholder={`Describe the work needed (minimum ${WORKSHOP_TASK_COMMENT_MIN_LENGTH} characters)`}
                className="bg-white dark:bg-slate-800 border-border text-foreground min-h-[100px]"
                maxLength={300}
              />
              <p className="text-xs text-muted-foreground">
                {editComments.length}/300 characters (minimum {WORKSHOP_TASK_COMMENT_MIN_LENGTH})
              </p>
            </div>

          </div>

          <DialogFooter className={tabletModeEnabled ? 'gap-3 pt-2' : 'gap-3'}>
            <TabletAwareButton
              variant="outline"
              onClick={() => {
                void clearEditDraft();
                onResetEditForm();
              }}
              className="border-border text-foreground hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {isEditFormDirty ? 'Discard Changes' : 'Cancel'}
            </TabletAwareButton>
            <TabletAwareButton
              onClick={onSaveEdit}
              disabled={isSaveEditDisabled}
              className="bg-workshop hover:bg-workshop-dark text-white"
            >
              {submitting ? 'Saving...' : 'Save Changes'}
            </TabletAwareButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
