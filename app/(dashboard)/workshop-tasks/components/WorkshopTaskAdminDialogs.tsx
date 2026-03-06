import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Action, Category } from '../types';

interface WorkshopTaskAdminDialogsProps {
  showSettings: boolean;
  showCategoryModal: boolean;
  onShowCategoryModalChange: (open: boolean) => void;
  editingCategory: Category | null;
  categoryName: string;
  onCategoryNameChange: (value: string) => void;
  submittingCategory: boolean;
  onSaveCategory: () => void;
  onResetCategoryForm: () => void;
  showDeleteConfirm: boolean;
  onShowDeleteConfirmChange: (open: boolean) => void;
  taskToDelete: Action | null;
  getVehicleReg: (task: Action) => string;
  deleting: boolean;
  onConfirmDeleteTask: () => void;
  onResetDeleteTask: () => void;
}

export function WorkshopTaskAdminDialogs({
  showSettings,
  showCategoryModal,
  onShowCategoryModalChange,
  editingCategory,
  categoryName,
  onCategoryNameChange,
  submittingCategory,
  onSaveCategory,
  onResetCategoryForm,
  showDeleteConfirm,
  onShowDeleteConfirmChange,
  taskToDelete,
  getVehicleReg,
  deleting,
  onConfirmDeleteTask,
  onResetDeleteTask,
}: WorkshopTaskAdminDialogsProps) {
  return (
    <>
      {showSettings && (
        <Dialog open={showCategoryModal} onOpenChange={onShowCategoryModalChange}>
          <DialogContent className="bg-white dark:bg-slate-900 border-border text-foreground max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-foreground text-xl">
                {editingCategory ? 'Edit Category' : 'Add Category'}
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                {editingCategory ? 'Update the category details' : 'Create a new workshop task category'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="category-name" className="text-foreground">
                  Category Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="category-name"
                  value={categoryName}
                  onChange={(e) => onCategoryNameChange(e.target.value)}
                  placeholder="e.g., Brakes, Engine, Electrical"
                  className="bg-white dark:bg-slate-800 border-border text-foreground"
                  maxLength={50}
                />
                <p className="text-xs text-muted-foreground">
                  Categories are automatically organized alphabetically
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={onResetCategoryForm}
                className="border-border text-foreground hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Cancel
              </Button>
              <Button
                onClick={onSaveCategory}
                disabled={submittingCategory || !categoryName.trim()}
                className="bg-workshop hover:bg-workshop-dark text-white"
              >
                {submittingCategory ? 'Saving...' : (editingCategory ? 'Update' : 'Create')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={showDeleteConfirm} onOpenChange={onShowDeleteConfirmChange}>
        <DialogContent className="bg-white dark:bg-slate-900 border-border text-foreground max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground text-xl">Delete Workshop Task</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Are you sure you want to delete this task? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>

          {taskToDelete && (
            <div className="bg-slate-100 dark:bg-slate-800 p-4 rounded-lg space-y-2">
              <p className="font-semibold text-foreground">
                {getVehicleReg(taskToDelete)}
              </p>
              {taskToDelete.workshop_comments && (
                <p className="text-sm text-muted-foreground">
                  {taskToDelete.workshop_comments}
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={onResetDeleteTask}
              disabled={deleting}
              className="border-border text-foreground hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              onClick={onConfirmDeleteTask}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleting ? 'Deleting...' : 'Delete Task'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
