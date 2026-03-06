import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FileText } from 'lucide-react';
import { splitVehiclesByRecent } from '@/lib/utils/recentVehicles';
import type { Action, AssetTab, Category, Subcategory, Vehicle } from '../types';

interface AttachmentTemplate {
  id: string;
  name: string;
}

interface WorkshopTaskFormDialogsProps {
  showAddModal: boolean;
  onShowAddModalChange: (open: boolean) => void;
  assetTab: AssetTab;
  selectedVehicleId: string;
  onSelectedVehicleIdChange: (value: string) => void;
  vehicles: Vehicle[];
  getAssetDisplay: (asset?: { reg_number?: string | null; plant_id?: string | null; nickname?: string | null }) => string;
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
  meterReadingType,
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
  return (
    <>
      <Dialog
        open={showAddModal}
        onOpenChange={(open) => {
          onShowAddModalChange(open);
          if (!open) {
            onResetAddForm();
          }
        }}
      >
        <DialogContent className="bg-white dark:bg-slate-900 border-border text-foreground max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-foreground text-xl">Create Workshop Task</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Add a new {assetTab === 'plant' ? 'plant' : assetTab === 'hgv' ? 'HGV' : assetTab === 'all' ? '' : 'van'} repair or maintenance task
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="vehicle" className="text-foreground">
                {assetTab === 'plant' ? 'Plant' : assetTab === 'hgv' ? 'HGV' : assetTab === 'all' ? 'Asset' : 'Van'} <span className="text-red-500">*</span>
              </Label>
              <Select value={selectedVehicleId} onValueChange={(value) => {
                onSelectedVehicleIdChange(value);
                if (value) {
                  onFetchCurrentMeterReading(value);
                }
              }}>
                <SelectTrigger id="vehicle" className="bg-white dark:bg-slate-800 border-border text-foreground">
                  <SelectValue placeholder={`Select ${assetTab === 'plant' ? 'plant' : assetTab === 'hgv' ? 'HGV' : assetTab === 'all' ? 'asset' : 'van'}`} />
                </SelectTrigger>
                <SelectContent>
                  {vehicles
                    .filter(v => assetTab === 'all' ? true : assetTab === 'plant' ? v.asset_type === 'plant' : assetTab === 'hgv' ? v.asset_type === 'hgv' : v.asset_type === 'van')
                    .map((vehicle) => (
                      <SelectItem key={vehicle.id} value={vehicle.id}>
                        {getAssetDisplay(vehicle)}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="category" className="text-foreground">
                Category <span className="text-red-500">*</span>
              </Label>
              <Select value={selectedCategoryId} onValueChange={onSelectedCategoryIdChange}>
                <SelectTrigger id="category" className="bg-white dark:bg-slate-800 border-border text-foreground">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {activeCategories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

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
                  <SelectTrigger id="subcategory" className="bg-white dark:bg-slate-800 border-border text-foreground">
                    <SelectValue placeholder={selectedCategoryId ? 'Select subcategory' : 'Select a category first'} />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredSubcategories.map((subcategory) => (
                      <SelectItem key={subcategory.id} value={subcategory.id}>
                        {subcategory.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="mileage" className="text-foreground">
                {meterReadingType === 'hours' ? 'Current Hours' : 'Current Mileage'} <span className="text-red-500">*</span>
              </Label>
              <Input
                id="mileage"
                type="number"
                value={newMeterReading}
                onChange={(e) => onNewMeterReadingChange(e.target.value)}
                placeholder={`Enter current ${meterReadingType === 'hours' ? 'hours' : 'mileage'}`}
                className="bg-white dark:bg-slate-800 border-border text-foreground"
                min="0"
                step="1"
              />
              {currentMeterReading !== null && (
                <p className="text-xs text-muted-foreground">
                  Last recorded: {currentMeterReading.toLocaleString()} {meterReadingType === 'hours' ? 'hours' : 'miles'}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="comments" className="text-foreground">
                Task Details <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="comments"
                value={workshopComments}
                onChange={(e) => onWorkshopCommentsChange(e.target.value)}
                placeholder="Describe the work needed (minimum 10 characters)"
                className="bg-white dark:bg-slate-800 border-border text-foreground min-h-[100px]"
                maxLength={300}
              />
              <p className="text-xs text-muted-foreground">
                {workshopComments.length}/300 characters (minimum 10)
              </p>
            </div>

            {attachmentTemplates.length > 0 && (
              <div className="space-y-2">
                <Label className="text-foreground flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Attachments (Optional)
                </Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Add service checklists or documentation to complete later
                </p>
                <div className="space-y-2 max-h-32 overflow-y-auto p-2 border border-border rounded-md bg-muted/30">
                  {attachmentTemplates.map((template) => (
                    <div key={template.id} className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id={`template-inline-${template.id}`}
                        checked={selectedAttachmentTemplateIds.includes(template.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            onSelectedAttachmentTemplateIdsChange([...selectedAttachmentTemplateIds, template.id]);
                          } else {
                            onSelectedAttachmentTemplateIdsChange(selectedAttachmentTemplateIds.filter(id => id !== template.id));
                          }
                        }}
                        className="h-4 w-4 rounded border-gray-300 text-workshop focus:ring-workshop"
                      />
                      <label
                        htmlFor={`template-inline-${template.id}`}
                        className="text-sm font-normal cursor-pointer text-foreground"
                      >
                        {template.name}
                      </label>
                    </div>
                  ))}
                </div>
                {selectedAttachmentTemplateIds.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {selectedAttachmentTemplateIds.length} attachment{selectedAttachmentTemplateIds.length > 1 ? 's' : ''} will be added to this task
                  </p>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                onShowAddModalChange(false);
                onResetAddForm();
              }}
              className="border-border text-foreground hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              onClick={onCreateTask}
              disabled={submitting || !selectedVehicleId || !selectedCategoryId || (categoryHasSubcategories && !selectedSubcategoryId) || workshopComments.length < 10 || !newMeterReading.trim()}
              className="bg-workshop hover:bg-workshop-dark text-white"
            >
              {submitting ? 'Creating...' : 'Create Task'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showEditModal} onOpenChange={onShowEditModalChange}>
        <DialogContent className="bg-white dark:bg-slate-900 border-border text-foreground max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-foreground text-xl">Edit Workshop Task</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Update the workshop task details
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-vehicle" className="text-foreground">
                {editingTask?.plant_id ? 'Plant' : editingTask?.hgv_id ? 'HGV' : 'Van'} <span className="text-red-500">*</span>
              </Label>
              <Select value={editVehicleId} onValueChange={onEditVehicleIdChange}>
                <SelectTrigger id="edit-vehicle" className="bg-white dark:bg-slate-800 border-border text-foreground">
                  <SelectValue placeholder={editingTask?.plant_id ? 'Select plant' : editingTask?.hgv_id ? 'Select HGV' : 'Select van'} />
                </SelectTrigger>
                <SelectContent>
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
                              <SelectItem key={vehicle.id} value={vehicle.id}>
                                {getAssetDisplay(vehicle)}
                              </SelectItem>
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
                              <SelectItem key={vehicle.id} value={vehicle.id}>
                                {getAssetDisplay(vehicle)}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        )}
                      </>
                    );
                  })()}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-category" className="text-foreground">
                Category <span className="text-red-500">*</span>
              </Label>
              <Select value={editCategoryId} onValueChange={onEditCategoryIdChange}>
                <SelectTrigger id="edit-category" className="bg-white dark:bg-slate-800 border-border text-foreground">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {(() => {
                    const editCategories = editingTask?.plant_id ? plantCategories : editingTask?.hgv_id ? hgvCategories : categories;
                    return editCategories.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    ));
                  })()}
                </SelectContent>
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
                    <SelectTrigger id="edit-subcategory" className="bg-white dark:bg-slate-800 border-border text-foreground">
                      <SelectValue placeholder="Select subcategory" />
                    </SelectTrigger>
                    <SelectContent>
                      {editFilteredSubcategories.map((sub) => (
                        <SelectItem key={sub.id} value={sub.id}>
                          {sub.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })()}

            <div className="space-y-2">
              <Label htmlFor="edit-mileage" className="text-foreground">
                {editingTask?.plant_id ? 'Current Hours' : 'Current Mileage'} <span className="text-red-500">*</span>
              </Label>
              <Input
                id="edit-mileage"
                type="number"
                value={editMileage}
                onChange={(e) => onEditMileageChange(e.target.value)}
                placeholder={`Enter current ${editingTask?.plant_id ? 'hours' : 'mileage'}`}
                className="bg-white dark:bg-slate-800 border-border text-foreground"
                min="0"
                step="1"
              />
              {editCurrentMileage !== null && (
                <p className="text-xs text-muted-foreground">
                  Last recorded: {editCurrentMileage.toLocaleString()} {editingTask?.plant_id ? 'hours' : 'miles'}
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
                placeholder="Describe the work needed (minimum 10 characters)"
                className="bg-white dark:bg-slate-800 border-border text-foreground min-h-[100px]"
                maxLength={300}
              />
              <p className="text-xs text-muted-foreground">
                {editComments.length}/300 characters (minimum 10)
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={onResetEditForm}
              className="border-border text-foreground hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              onClick={onSaveEdit}
              disabled={isSaveEditDisabled}
              className="bg-workshop hover:bg-workshop-dark text-white"
            >
              {submitting ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
