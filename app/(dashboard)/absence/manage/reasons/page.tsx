'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Settings, Plus, Edit, Trash2 } from 'lucide-react';
import { BackButton } from '@/components/ui/back-button';
import {
  useAllAbsenceReasons,
  useCreateAbsenceReason,
  useUpdateAbsenceReason,
  useDeleteAbsenceReason,
} from '@/lib/hooks/useAbsence';
import { AbsenceReason } from '@/types/absence';
import { toast } from 'sonner';
import Link from 'next/link';

export default function AbsenceReasonsPage() {
  const { isAdmin, loading: authLoading } = useAuth();
  const router = useRouter();
  
  // Data
  const { data: reasons, isLoading } = useAllAbsenceReasons();
  
  // Mutations
  const createReason = useCreateAbsenceReason();
  const updateReason = useUpdateAbsenceReason();
  const deleteReason = useDeleteAbsenceReason();
  
  // Dialog state
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingReason, setEditingReason] = useState<AbsenceReason | null>(null);
  const [name, setName] = useState('');
  const [isPaid, setIsPaid] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  
  // Check admin access
  useEffect(() => {
    if (!authLoading && !isAdmin) {
      router.push('/dashboard');
    }
  }, [isAdmin, authLoading, router]);
  
  // Handle create
  async function handleCreate() {
    if (!name.trim()) {
      toast.error('Please enter a reason name');
      return;
    }
    
    setSubmitting(true);
    
    try {
      await createReason.mutateAsync({
        name: name.trim(),
        is_paid: isPaid,
      });
      
      toast.success('Absence reason created');
      setName('');
      setIsPaid(true);
      setShowCreateDialog(false);
    } catch (error: unknown) {
      console.error('Error creating reason:', error);
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        toast.error('A reason with this name already exists');
      } else {
        toast.error('Failed to create reason');
      }
    } finally {
      setSubmitting(false);
    }
  }
  
  // Handle edit
  function handleEditClick(reason: AbsenceReason) {
    setEditingReason(reason);
    setName(reason.name);
    setIsPaid(reason.is_paid);
    setShowEditDialog(true);
  }
  
  async function handleUpdate() {
    if (!editingReason || !name.trim()) {
      toast.error('Please enter a reason name');
      return;
    }
    
    setSubmitting(true);
    
    try {
      await updateReason.mutateAsync({
        id: editingReason.id,
        updates: {
          name: name.trim(),
          is_paid: isPaid,
        },
      });
      
      toast.success('Absence reason updated');
      setEditingReason(null);
      setName('');
      setIsPaid(true);
      setShowEditDialog(false);
    } catch (error: unknown) {
      console.error('Error updating reason:', error);
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        toast.error('A reason with this name already exists');
      } else {
        toast.error('Failed to update reason');
      }
    } finally {
      setSubmitting(false);
    }
  }
  
  // Handle toggle active
  async function handleToggleActive(reason: AbsenceReason) {
    try {
      await updateReason.mutateAsync({
        id: reason.id,
        updates: { is_active: !reason.is_active },
      });
      
      toast.success(`Reason ${reason.is_active ? 'disabled' : 'enabled'}`);
    } catch (error) {
      console.error('Error toggling active:', error);
      toast.error('Failed to update reason');
    }
  }
  
  // Handle delete (soft delete by setting is_active = false)
  async function handleDelete(reason: AbsenceReason) {
    const confirmed = await import('@/lib/services/notification.service').then(m => 
      m.notify.confirm({
        title: 'Disable Absence Reason',
        description: `Are you sure you want to disable "${reason.name}"? It will no longer be available for new absence requests.`,
        confirmText: 'Disable',
        destructive: true,
      })
    );
    if (!confirmed) {
      return;
    }
    
    try {
      await deleteReason.mutateAsync(reason.id);
      toast.success('Reason disabled');
    } catch (error) {
      console.error('Error deleting reason:', error);
      toast.error('Failed to delete reason');
    }
  }
  
  if (authLoading || isLoading) {
    return (
      <div className="space-y-6 max-w-6xl">
        <Card className="">
          <CardContent className="flex items-center justify-center py-12">
            <p className="text-muted-foreground">Loading...</p>
          </CardContent>
        </Card>
      </div>
    );
  }
  
  if (!isAdmin) return null;
  
  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-border">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <BackButton />
            <div>
              <h1 className="text-3xl font-bold text-foreground mb-2">
                Absence Reasons
              </h1>
              <p className="text-muted-foreground">
                Manage absence and leave reasons
              </p>
            </div>
          </div>
          <Button
            onClick={() => {
              setName('');
              setIsPaid(true);
              setShowCreateDialog(true);
            }}
            className="bg-purple-500 hover:bg-purple-600 text-white"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Reason
          </Button>
        </div>
      </div>
      
      {/* Reasons List */}
      <Card className="">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Settings className="h-5 w-5" />
            Reasons
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {reasons?.length || 0} reasons configured
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!reasons || reasons.length === 0 ? (
            <div className="text-center py-12">
              <Settings className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-white mb-2">No reasons configured</h3>
              <p className="text-muted-foreground">Add your first absence reason</p>
            </div>
          ) : (
            <div className="space-y-3">
              {reasons.map(reason => (
                <div
                  key={reason.id}
                  className="p-4 rounded-lg bg-slate-800/30 border border-border/50 hover:border-slate-600 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <h3 className="font-semibold text-white text-lg">
                        {reason.name}
                      </h3>
                      <Badge
                        variant="outline"
                        className={
                          reason.is_paid
                            ? 'border-blue-500/30 text-blue-400 bg-blue-500/10'
                            : 'border-slate-600 text-muted-foreground'
                        }
                      >
                        {reason.is_paid ? 'Paid' : 'Unpaid'}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={
                          reason.is_active
                            ? 'border-green-500/30 text-green-400 bg-green-500/10'
                            : 'border-purple-500/30 text-purple-400 bg-purple-500/10'
                        }
                      >
                        {reason.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                    
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleToggleActive(reason)}
                        className="border-border text-muted-foreground"
                      >
                        {reason.is_active ? 'Disable' : 'Enable'}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleEditClick(reason)}
                        className="border-border text-muted-foreground"
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      {reason.is_active && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDelete(reason)}
                          className="border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      
      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="border-border">
          <DialogHeader>
            <DialogTitle className="text-white">Add Absence Reason</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Create a new reason for absence or leave
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div>
              <Label htmlFor="name">Reason Name *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Sick Leave"
                className="border-border dark:text-slate-100 text-slate-900"
              />
            </div>
            
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isPaid"
                checked={isPaid}
                onChange={(e) => setIsPaid(e.target.checked)}
                className="rounded border-border"
              />
              <label htmlFor="isPaid" className="text-sm text-muted-foreground cursor-pointer">
                This is a paid absence
              </label>
            </div>
          </div>
          
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCreateDialog(false)}
              className="border-border text-muted-foreground"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={submitting || !name.trim()}
              className="bg-purple-500 hover:bg-purple-600 text-white"
            >
              {submitting ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="border-border">
          <DialogHeader>
            <DialogTitle className="text-white">Edit Absence Reason</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Update the reason details
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div>
              <Label htmlFor="editName">Reason Name *</Label>
              <Input
                id="editName"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Sick Leave"
                className="border-border dark:text-slate-100 text-slate-900"
              />
            </div>
            
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="editIsPaid"
                checked={isPaid}
                onChange={(e) => setIsPaid(e.target.checked)}
                className="rounded border-border"
              />
              <label htmlFor="editIsPaid" className="text-sm text-muted-foreground cursor-pointer">
                This is a paid absence
              </label>
            </div>
          </div>
          
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowEditDialog(false);
                setEditingReason(null);
              }}
              className="border-border text-muted-foreground"
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpdate}
              disabled={submitting || !name.trim()}
              className="bg-purple-500 hover:bg-purple-600 text-white"
            >
              {submitting ? 'Updating...' : 'Update'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

