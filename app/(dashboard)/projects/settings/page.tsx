'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageLoader } from '@/components/ui/page-loader';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { BackButton } from '@/components/ui/back-button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Loader2, Plus, Pencil, Trash2, FileCheck2 } from 'lucide-react';
import { toast } from 'sonner';
import type { ProjectDocumentType } from '@/types/rams';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';

export default function ProjectsSettingsPage() {
  const router = useRouter();
  const { isManager, isAdmin, loading: authLoading } = useAuth();
  const { hasPermission: canAccessProjectsModule, loading: projectsPermissionLoading } = usePermissionCheck('rams', false);
  const [types, setTypes] = useState<ProjectDocumentType[]>([]);
  const [loading, setLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingType, setEditingType] = useState<ProjectDocumentType | null>(null);
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formRequiresSig, setFormRequiresSig] = useState(true);
  const [saving, setSaving] = useState(false);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [typeToDelete, setTypeToDelete] = useState<ProjectDocumentType | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (authLoading || projectsPermissionLoading) return;

    if (!canAccessProjectsModule) {
      router.push('/dashboard');
      return;
    }

    if (!isManager && !isAdmin) {
      router.push('/projects');
    }
  }, [isManager, isAdmin, authLoading, projectsPermissionLoading, canAccessProjectsModule, router]);

  const fetchTypes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/projects/document-types');
      const data = await res.json();
      if (data.success) {
        setTypes(data.types);
      }
    } catch (error) {
      console.error('Error fetching document types:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && !projectsPermissionLoading && canAccessProjectsModule && (isManager || isAdmin)) {
      fetchTypes();
    }
  }, [authLoading, projectsPermissionLoading, canAccessProjectsModule, isManager, isAdmin, fetchTypes]);

  const openCreateDialog = () => {
    setEditingType(null);
    setFormName('');
    setFormDescription('');
    setFormRequiresSig(true);
    setDialogOpen(true);
  };

  const openEditDialog = (type: ProjectDocumentType) => {
    setEditingType(type);
    setFormName(type.name);
    setFormDescription(type.description || '');
    setFormRequiresSig(type.required_signature);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formName.trim()) {
      toast.error('Name is required');
      return;
    }

    setSaving(true);
    try {
      const isEdit = !!editingType;
      const res = await fetch('/api/projects/document-types', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(isEdit ? { id: editingType.id } : {}),
          name: formName.trim(),
          description: formDescription.trim() || null,
          required_signature: formRequiresSig,
        }),
      });

      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to save');
      }

      toast.success(isEdit ? 'Document type updated' : 'Document type created');
      setDialogOpen(false);
      fetchTypes();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save document type');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (type: ProjectDocumentType) => {
    try {
      const res = await fetch('/api/projects/document-types', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: type.id,
          is_active: !type.is_active,
        }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      toast.success(type.is_active ? 'Document type deactivated' : 'Document type activated');
      fetchTypes();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update');
    }
  };

  const handleDelete = async () => {
    if (!typeToDelete) return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/projects/document-types?id=${typeToDelete.id}`, {
        method: 'DELETE',
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      toast.success('Document type deleted');
      setDeleteDialogOpen(false);
      setTypeToDelete(null);
      fetchTypes();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete');
    } finally {
      setDeleting(false);
    }
  };

  if (authLoading || projectsPermissionLoading || (!isManager && !isAdmin)) {
    return <PageLoader message="Loading project settings..." />;
  }

  if (!canAccessProjectsModule) {
    return null;
  }

  if (loading) {
    return <PageLoader message="Loading project settings..." />;
  }

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BackButton />
            <div>
              <h1 className="text-3xl font-bold text-foreground mb-2">Projects Settings</h1>
              <p className="text-muted-foreground">
                Manage document type categories for the Projects module
              </p>
            </div>
          </div>
          <Button
            onClick={openCreateDialog}
            className="bg-rams hover:bg-rams-dark text-white transition-all duration-200 active:scale-95 shadow-md hover:shadow-lg"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Type
          </Button>
        </div>
      </div>

      {/* Document Types List */}
      {types.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileCheck2 className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No document types</h3>
            <p className="text-muted-foreground mb-4">Create your first document type to get started</p>
            <Button onClick={openCreateDialog} className="bg-rams hover:bg-rams-dark text-white">
              <Plus className="h-4 w-4 mr-2" />
              Add Document Type
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {types.map((type) => (
            <Card
              key={type.id}
              className={`bg-white dark:bg-slate-900 border-border transition-all duration-200 ${
                !type.is_active ? 'opacity-60' : ''
              }`}
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <CardTitle className="text-lg">{type.name}</CardTitle>
                      {!type.is_active && (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                      <Badge variant={type.required_signature ? 'default' : 'outline'}>
                        {type.required_signature ? 'Signature Required' : 'Read Only'}
                      </Badge>
                    </div>
                    {type.description && (
                      <CardDescription className="mt-1">{type.description}</CardDescription>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditDialog(type)}
                      className="h-8 w-8 p-0"
                      title="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleToggleActive(type)}
                      className="h-8 w-8 p-0"
                      title={type.is_active ? 'Deactivate' : 'Activate'}
                    >
                      <Switch
                        checked={type.is_active}
                        className="pointer-events-none"
                      />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setTypeToDelete(type);
                        setDeleteDialogOpen(true);
                      }}
                      className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingType ? 'Edit Document Type' : 'New Document Type'}</DialogTitle>
            <DialogDescription>
              {editingType
                ? 'Update the document type settings'
                : 'Create a new document type category for projects'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="type-name">Name</Label>
              <Input
                id="type-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. RAMS, Safety Briefing, Site Plan"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="type-desc">Description (optional)</Label>
              <Input
                id="type-desc"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Brief description of this document type"
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border p-4">
              <div className="space-y-0.5">
                <Label>Require Signature</Label>
                <p className="text-sm text-muted-foreground">
                  {formRequiresSig
                    ? 'Recipients must sign to acknowledge the document'
                    : 'Recipients only need to read/view the document'}
                </p>
              </div>
              <Switch
                checked={formRequiresSig}
                onCheckedChange={setFormRequiresSig}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !formName.trim()}
              className="bg-rams hover:bg-rams-dark text-white"
            >
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingType ? 'Save Changes' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Document Type</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{' '}
              <span className="font-semibold">{typeToDelete?.name}</span>?
              This cannot be undone. If documents are using this type, you will need to deactivate it instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
