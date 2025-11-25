'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Loader2, UserCheck, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';

interface Manager {
  id: string;
  full_name: string;
  email: string;
  role: {
    name: string;
    display_name: string;
  } | null;
}

interface TimesheetAdjustmentModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (selectedManagerIds: string[], comments: string) => Promise<void>;
  timesheetId: string;
  employeeName: string;
  weekEnding: string;
}

export function TimesheetAdjustmentModal({
  open,
  onClose,
  onConfirm,
  timesheetId,
  employeeName,
  weekEnding,
}: TimesheetAdjustmentModalProps) {
  const [managers, setManagers] = useState<Manager[]>([]);
  const [filteredManagers, setFilteredManagers] = useState<Manager[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [comments, setComments] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    if (open) {
      fetchManagers();
      setComments(''); // Reset comments when opening
      setSelectedIds(new Set()); // Reset selections
    }
  }, [open]);

  useEffect(() => {
    if (searchQuery) {
      setFilteredManagers(
        managers.filter((mgr) =>
          mgr.full_name.toLowerCase().includes(searchQuery.toLowerCase())
        )
      );
    } else {
      setFilteredManagers(managers);
    }
  }, [searchQuery, managers]);

  const fetchManagers = async () => {
    setFetching(true);
    try {
      // Fetch all managers and admins with their emails
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select(`
          id,
          full_name,
          email,
          roles!inner(
            id,
            name,
            display_name,
            is_manager_admin
          )
        `)
        .eq('roles.is_manager_admin', true)
        .order('full_name');

      if (profilesError) {
        console.error('Error fetching managers:', profilesError);
        throw profilesError;
      }

      const managersWithEmail = profiles || [];

      // Sort managers: Put Suzanne Squires at the top
      const sortedManagers = managersWithEmail.sort((a, b) => {
        const suzanneEmail = 'suzanne@avsquires.co.uk';
        if (a.email === suzanneEmail) return -1;
        if (b.email === suzanneEmail) return 1;
        return a.full_name.localeCompare(b.full_name);
      });

      const transformedManagers = sortedManagers.map((mgr: unknown) => {
        const m = mgr as {
          id: string;
          full_name: string;
          email: string;
          roles: { name: string; display_name: string };
        };
        return {
          id: m.id,
          full_name: m.full_name,
          email: m.email,
          role: m.roles ? {
            name: m.roles.name,
            display_name: m.roles.display_name,
          } : null,
        };
      });

      setManagers(transformedManagers);
      setFilteredManagers(transformedManagers);
    } catch (error) {
      console.error('Error fetching managers:', error);
      toast.error('Failed to load managers');
    } finally {
      setFetching(false);
    }
  };

  const handleToggleManager = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const allIds = filteredManagers.map((mgr) => mgr.id);
      setSelectedIds(new Set(allIds));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (comments.trim().length === 0) {
      toast.error('Please add a comment explaining the adjustment');
      return;
    }

    if (selectedIds.size === 0) {
      toast.error('Please select at least one manager to notify');
      return;
    }

    setLoading(true);

    try {
      await onConfirm(Array.from(selectedIds), comments.trim());
      
      // Reset state
      setComments('');
      setSelectedIds(new Set());
      setSearchQuery('');
    } catch (error) {
      console.error('Adjustment error:', error);
      // Error handling is done in the parent component
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (loading) return;
    setComments('');
    setSelectedIds(new Set());
    setSearchQuery('');
    onClose();
  };

  const allSelected =
    filteredManagers.length > 0 && selectedIds.size === filteredManagers.length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Mark Timesheet as Adjusted</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground">{employeeName}</span>
              <br />
              Week Ending: {weekEnding}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Comments Field - Mandatory */}
            <div className="space-y-2">
              <Label htmlFor="comments" className="text-sm font-medium">
                Adjustment Comments <span className="text-red-600">*</span>
              </Label>
              <Textarea
                id="comments"
                placeholder="Explain what was adjusted and why..."
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                disabled={loading || fetching}
                rows={4}
                className="resize-none"
                required
              />
              <p className="text-xs text-muted-foreground">
                This will be included in the notification email
              </p>
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search managers..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                disabled={loading || fetching}
                className="pl-10"
              />
            </div>

            {/* Select All */}
            <div className="flex items-center space-x-2 border-b pb-2">
              <Checkbox
                id="select-all"
                checked={allSelected}
                onCheckedChange={handleSelectAll}
                disabled={loading || fetching || filteredManagers.length === 0}
              />
              <label
                htmlFor="select-all"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Select All ({selectedIds.size} selected)
              </label>
            </div>

            {/* Managers List */}
            {fetching ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : (
              <ScrollArea className="h-[250px] pr-4">
                <div className="space-y-2">
                  {filteredManagers.length === 0 ? (
                    <p className="text-center text-muted-foreground py-4">
                      No managers found
                    </p>
                  ) : (
                    filteredManagers.map((manager, index) => (
                      <div
                        key={manager.id}
                        className={`flex items-center space-x-3 p-3 rounded-lg border hover:bg-accent/50 ${
                          index === 0 && manager.email === 'suzanne@avsquires.co.uk'
                            ? 'border-blue-300 bg-blue-50/50 dark:bg-blue-950/20'
                            : ''
                        }`}
                      >
                        <Checkbox
                          id={manager.id}
                          checked={selectedIds.has(manager.id)}
                          onCheckedChange={() => handleToggleManager(manager.id)}
                          disabled={loading}
                        />
                        <label
                          htmlFor={manager.id}
                          className="flex-1 text-sm font-medium cursor-pointer"
                        >
                          {manager.full_name}
                          {index === 0 && manager.email === 'suzanne@avsquires.co.uk' && (
                            <span className="ml-2 text-xs text-blue-600 dark:text-blue-400">
                              (Recommended)
                            </span>
                          )}
                        </label>
                        <span className="text-xs text-muted-foreground">
                          {manager.role?.display_name || 'Manager'}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            )}

            {selectedIds.size > 0 && (
              <div className="rounded-md bg-amber-50 dark:bg-amber-950/20 p-3">
                <p className="text-sm text-amber-900 dark:text-amber-100">
                  ⚠️ The employee and {selectedIds.size} manager
                  {selectedIds.size !== 1 ? 's' : ''} will be notified via email and
                  in-app notification
                </p>
              </div>
            )}
          </div>

          <DialogFooter className="gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading || comments.trim().length === 0 || selectedIds.size === 0}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Marking as Adjusted...
                </>
              ) : (
                <>
                  <UserCheck className="h-4 w-4 mr-2" />
                  Mark as Adjusted
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

