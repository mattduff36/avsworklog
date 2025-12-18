'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Edit, Trash2, AlertTriangle } from 'lucide-react';
import { useMaintenanceCategories, useDeleteCategory } from '@/lib/hooks/useMaintenance';
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
import { CategoryDialog } from './CategoryDialog';
import type { MaintenanceCategory } from '@/types/maintenance';

interface MaintenanceSettingsProps {
  isAdmin: boolean;
  isManager: boolean;
}

export function MaintenanceSettings({ isAdmin, isManager }: MaintenanceSettingsProps) {
  const { data: categoriesData } = useMaintenanceCategories();
  const deleteMutation = useDeleteCategory();
  
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<MaintenanceCategory | null>(null);
  
  const categories = categoriesData?.categories || [];
  const canModifySettings = isAdmin || isManager;
  
  // Open dialogs
  const openEditDialog = (category: MaintenanceCategory) => {
    setSelectedCategory(category);
    setEditDialogOpen(true);
  };
  
  const openDeleteDialog = (category: MaintenanceCategory) => {
    setSelectedCategory(category);
    setDeleteDialogOpen(true);
  };
  
  const handleDelete = async () => {
    if (!selectedCategory) return;
    await deleteMutation.mutateAsync(selectedCategory.id);
    setDeleteDialogOpen(false);
    setSelectedCategory(null);
  };
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-slate-900 dark:text-white">
                Maintenance Categories
              </CardTitle>
              <CardDescription className="text-slate-600 dark:text-slate-400">
                Configure maintenance types and alert thresholds
              </CardDescription>
            </div>
            <Button
              onClick={() => setAddDialogOpen(true)}
              className="bg-blue-600 hover:bg-blue-700"
              disabled={!canModifySettings}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Category
            </Button>
          </div>
        </CardHeader>
        
        <CardContent>
          {categories.length === 0 ? (
            <div className="text-center py-8 text-slate-600 dark:text-slate-400">
              No categories configured yet.
            </div>
          ) : (
            <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800/50">
                    <TableHead className="text-slate-700 dark:text-slate-300">Name</TableHead>
                    <TableHead className="text-slate-700 dark:text-slate-300">Type</TableHead>
                    <TableHead className="text-slate-700 dark:text-slate-300">Alert Threshold</TableHead>
                    <TableHead className="text-slate-700 dark:text-slate-300">Status</TableHead>
                    <TableHead className="text-slate-700 dark:text-slate-300">Description</TableHead>
                    <TableHead className="text-right text-slate-700 dark:text-slate-300">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categories
                    .sort((a, b) => a.sort_order - b.sort_order)
                    .map((category) => (
                      <TableRow
                        key={category.id}
                        className="border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                      >
                        <TableCell className="font-medium text-slate-900 dark:text-white">
                          {category.name}
                        </TableCell>
                        
                        <TableCell>
                          <Badge variant="outline" className="capitalize">
                            {category.type}
                          </Badge>
                        </TableCell>
                        
                        <TableCell className="text-slate-700 dark:text-slate-300">
                          {category.type === 'date' 
                            ? `${category.alert_threshold_days} days`
                            : `${category.alert_threshold_miles?.toLocaleString()} miles`
                          }
                        </TableCell>
                        
                        <TableCell>
                          <Badge 
                            variant={category.is_active ? 'default' : 'secondary'}
                            className={category.is_active ? 'bg-green-600' : ''}
                          >
                            {category.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </TableCell>
                        
                        <TableCell className="text-slate-700 dark:text-slate-300 text-sm max-w-md truncate">
                          {category.description || '-'}
                        </TableCell>
                        
                        <TableCell className="text-right">
                          <div className="flex gap-1 justify-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEditDialog(category)}
                              disabled={!canModifySettings}
                              className="text-blue-400 hover:text-blue-300 hover:bg-slate-800 disabled:opacity-30"
                              title="Edit Category"
                            >
                              <Edit className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openDeleteDialog(category)}
                              disabled={!canModifySettings}
                              className="text-red-400 hover:text-red-300 hover:bg-slate-800 disabled:opacity-30"
                              title="Delete Category"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      
      {/* Info Card */}
      <Card className="bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-blue-800 dark:text-blue-200">
              <p className="font-semibold mb-1">About Categories & Thresholds</p>
              <p>
                Categories define what types of maintenance to track. Each category has an alert threshold that determines when to show "Due Soon" warnings. 
                Date-based categories (Tax, MOT, First Aid) use days, while mileage-based categories (Service, Cambelt) use miles.
              </p>
              <p className="mt-2">
                <strong>Note:</strong> You cannot change a category's type (date ↔ mileage) after creation. 
                Changes to thresholds apply immediately to all vehicles.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* Add/Edit Category Dialog */}
      <CategoryDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        mode="create"
      />
      
      <CategoryDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        mode="edit"
        category={selectedCategory}
      />
      
      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="bg-slate-900 border-slate-700 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Delete Category
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              Are you sure you want to delete this maintenance category? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          
          {selectedCategory && (
            <div className="bg-slate-800 rounded p-4 space-y-2">
              <p className="text-sm">
                <span className="text-slate-400">Name:</span>{' '}
                <span className="text-white font-medium">{selectedCategory.name}</span>
              </p>
              <p className="text-sm">
                <span className="text-slate-400">Type:</span>{' '}
                <span className="text-white capitalize">{selectedCategory.type}</span>
              </p>
            </div>
          )}
          
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-600 text-white hover:bg-slate-800">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Category
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
