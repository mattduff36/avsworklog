'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, UserCheck, Search, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { Database } from '@/types/database';

interface Employee {
  id: string;
  full_name: string;
  role: 'admin' | 'manager' | 'employee';
  alreadySigned?: boolean;
}

interface AssignEmployeesModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  documentId: string;
  documentTitle: string;
}

export function AssignEmployeesModal({
  open,
  onClose,
  onSuccess,
  documentId,
  documentTitle,
}: AssignEmployeesModalProps) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [filteredEmployees, setFilteredEmployees] = useState<Employee[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    if (open) {
      fetchEmployees();
    }
  }, [open]);

  useEffect(() => {
    if (searchQuery) {
      setFilteredEmployees(
        employees.filter(emp =>
          emp.full_name.toLowerCase().includes(searchQuery.toLowerCase())
        )
      );
    } else {
      setFilteredEmployees(employees);
    }
  }, [searchQuery, employees]);

  const fetchEmployees = async () => {
    setFetching(true);
    try {
      // Fetch all employees
      const { data: allEmployees, error: empError } = await supabase
        .from('profiles')
        .select('id, full_name, role')
        .order('full_name');

      if (empError) throw empError;

      // Fetch existing assignments for this document
      const { data: assignments, error: assignError } = await supabase
        .from('rams_assignments')
        .select('employee_id, status')
        .eq('rams_document_id', documentId);

      if (assignError) throw assignError;

      // Mark employees who have already signed
      const signedEmployeeIds = new Set(
        assignments?.filter(a => a.status === 'signed').map(a => a.employee_id) || []
      );

      const employeesWithStatus = allEmployees?.map(emp => ({
        ...emp,
        alreadySigned: signedEmployeeIds.has(emp.id),
      })) || [];

      setEmployees(employeesWithStatus);
      setFilteredEmployees(employeesWithStatus);
    } catch (error) {
      console.error('Error fetching employees:', error);
      toast.error('Failed to load employees');
    } finally {
      setFetching(false);
    }
  };

  const handleToggleEmployee = (id: string) => {
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
      const allSelectableIds = filteredEmployees
        .filter(emp => !emp.alreadySigned)
        .map(emp => emp.id);
      setSelectedIds(new Set(allSelectableIds));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (selectedIds.size === 0) {
      toast.error('Please select at least one employee');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`/api/rams/${documentId}/assign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          employee_ids: Array.from(selectedIds),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to assign document');
      }

      toast.success(`Document assigned to ${selectedIds.size} employee(s)`);

      // Reset and close
      setSelectedIds(new Set());
      setSearchQuery('');
      onSuccess();
    } catch (error) {
      console.error('Assignment error:', error);
      toast.error(error instanceof Error ? error.message : 'Assignment failed');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (loading) return;
    setSelectedIds(new Set());
    setSearchQuery('');
    onClose();
  };

  const selectableCount = filteredEmployees.filter(emp => !emp.alreadySigned).length;
  const allSelected = selectableCount > 0 && selectedIds.size === selectableCount;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Assign RAMS Document</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground">{documentTitle}</span>
              <br />
              Select employees to assign this document to
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search employees..."
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
                disabled={loading || fetching || selectableCount === 0}
              />
              <label
                htmlFor="select-all"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Select All ({selectedIds.size} selected)
              </label>
            </div>

            {/* Employees List */}
            {fetching ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : (
              <ScrollArea className="h-[300px] pr-4">
                <div className="space-y-2">
                  {filteredEmployees.length === 0 ? (
                    <p className="text-center text-muted-foreground py-4">
                      No employees found
                    </p>
                  ) : (
                    filteredEmployees.map((employee) => (
                      <div
                        key={employee.id}
                        className={`flex items-center space-x-3 p-3 rounded-lg border ${
                          employee.alreadySigned
                            ? 'bg-muted/50 opacity-60'
                            : 'hover:bg-accent/50'
                        }`}
                      >
                        <Checkbox
                          id={employee.id}
                          checked={selectedIds.has(employee.id)}
                          onCheckedChange={() => handleToggleEmployee(employee.id)}
                          disabled={loading || employee.alreadySigned}
                        />
                        <label
                          htmlFor={employee.id}
                          className="flex-1 text-sm font-medium cursor-pointer peer-disabled:cursor-not-allowed"
                        >
                          {employee.full_name}
                          {employee.alreadySigned && (
                            <span className="ml-2 text-xs text-green-600 dark:text-green-400 flex items-center gap-1 inline-flex">
                              <AlertCircle className="h-3 w-3" />
                              Already signed
                            </span>
                          )}
                        </label>
                        <span className="text-xs text-muted-foreground capitalize">
                          {employee.role}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            )}

            {selectedIds.size > 0 && (
              <div className="rounded-md bg-blue-50 dark:bg-blue-950/20 p-3">
                <p className="text-sm text-blue-900 dark:text-blue-100">
                  ℹ️ {selectedIds.size} employee{selectedIds.size !== 1 ? 's' : ''} will be notified
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading || selectedIds.size === 0}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Assigning...
                </>
              ) : (
                <>
                  <UserCheck className="h-4 w-4 mr-2" />
                  Assign to {selectedIds.size} Employee{selectedIds.size !== 1 ? 's' : ''}
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

