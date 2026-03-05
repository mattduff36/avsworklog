import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { VehicleCategoryDialog } from './VehicleCategoryDialog';
import { HgvCategoryDialog } from './HgvCategoryDialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { Category, HgvCategory } from '../types';

interface FleetCategoryDialogsProps {
  addCategoryDialogOpen: boolean;
  editCategoryDialogOpen: boolean;
  deleteCategoryDialogOpen: boolean;
  selectedCategory: Category | null;
  deletingCategory: boolean;
  onAddCategoryDialogOpenChange: (open: boolean) => void;
  onEditCategoryDialogOpenChange: (open: boolean) => void;
  onDeleteCategoryDialogOpenChange: (open: boolean) => void;
  onCategorySuccess: () => void;
  onDeleteCategory: () => void;
  addHgvCategoryDialogOpen: boolean;
  editHgvCategoryDialogOpen: boolean;
  deleteHgvCategoryDialogOpen: boolean;
  selectedHgvCategory: HgvCategory | null;
  deletingHgvCategory: boolean;
  onAddHgvCategoryDialogOpenChange: (open: boolean) => void;
  onEditHgvCategoryDialogOpenChange: (open: boolean) => void;
  onDeleteHgvCategoryDialogOpenChange: (open: boolean) => void;
  onHgvCategorySuccess: () => void;
  onDeleteHgvCategory: () => void;
}

export function FleetCategoryDialogs({
  addCategoryDialogOpen,
  editCategoryDialogOpen,
  deleteCategoryDialogOpen,
  selectedCategory,
  deletingCategory,
  onAddCategoryDialogOpenChange,
  onEditCategoryDialogOpenChange,
  onDeleteCategoryDialogOpenChange,
  onCategorySuccess,
  onDeleteCategory,
  addHgvCategoryDialogOpen,
  editHgvCategoryDialogOpen,
  deleteHgvCategoryDialogOpen,
  selectedHgvCategory,
  deletingHgvCategory,
  onAddHgvCategoryDialogOpenChange,
  onEditHgvCategoryDialogOpenChange,
  onDeleteHgvCategoryDialogOpenChange,
  onHgvCategorySuccess,
  onDeleteHgvCategory,
}: FleetCategoryDialogsProps) {
  return (
    <>
      <VehicleCategoryDialog
        open={addCategoryDialogOpen}
        onOpenChange={onAddCategoryDialogOpenChange}
        mode="create"
        onSuccess={onCategorySuccess}
      />

      <VehicleCategoryDialog
        open={editCategoryDialogOpen}
        onOpenChange={onEditCategoryDialogOpenChange}
        mode="edit"
        category={selectedCategory}
        onSuccess={onCategorySuccess}
      />

      <HgvCategoryDialog
        open={addHgvCategoryDialogOpen}
        onOpenChange={onAddHgvCategoryDialogOpenChange}
        mode="create"
        onSuccess={onHgvCategorySuccess}
      />

      <HgvCategoryDialog
        open={editHgvCategoryDialogOpen}
        onOpenChange={onEditHgvCategoryDialogOpenChange}
        mode="edit"
        category={selectedHgvCategory}
        onSuccess={onHgvCategorySuccess}
      />

      <AlertDialog
        open={deleteHgvCategoryDialogOpen}
        onOpenChange={onDeleteHgvCategoryDialogOpenChange}
      >
        <AlertDialogContent className="border-border text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Delete HGV Category
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Are you sure you want to delete this HGV category? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {selectedHgvCategory && (
            <div className="bg-slate-800 rounded p-4 space-y-2">
              <p className="text-sm">
                <span className="text-muted-foreground">Name:</span>{' '}
                <span className="text-white font-medium">{selectedHgvCategory.name}</span>
              </p>
              {selectedHgvCategory.description && (
                <p className="text-sm">
                  <span className="text-muted-foreground">Description:</span>{' '}
                  <span className="text-white">{selectedHgvCategory.description}</span>
                </p>
              )}
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel
              className="border-slate-600 text-white hover:bg-slate-800"
              disabled={deletingHgvCategory}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={onDeleteHgvCategory}
              className="bg-red-600 hover:bg-red-700"
              disabled={deletingHgvCategory}
            >
              {deletingHgvCategory && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Category
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteCategoryDialogOpen}
        onOpenChange={onDeleteCategoryDialogOpenChange}
      >
        <AlertDialogContent className="border-border text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Delete Category
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Are you sure you want to delete this category? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {selectedCategory && (
            <div className="bg-slate-800 rounded p-4 space-y-2">
              <p className="text-sm">
                <span className="text-muted-foreground">Name:</span>{' '}
                <span className="text-white font-medium">{selectedCategory.name}</span>
              </p>
              {selectedCategory.description && (
                <p className="text-sm">
                  <span className="text-muted-foreground">Description:</span>{' '}
                  <span className="text-white">{selectedCategory.description}</span>
                </p>
              )}
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel
              className="border-slate-600 text-white hover:bg-slate-800"
              disabled={deletingCategory}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={onDeleteCategory}
              className="bg-red-600 hover:bg-red-700"
              disabled={deletingCategory}
            >
              {deletingCategory && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Category
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
