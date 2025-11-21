'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Send, Search } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';

interface Employee {
  id: string;
  full_name: string;
  role: {
    name: string;
    display_name: string;
  } | null;
}

interface AssignRecipientsModalProps {
  open: boolean;
  onClose: () => void;
  onSend: (employeeIds: string[]) => Promise<void>;
  messageSubject: string;
  messageType: 'TOOLBOX_TALK' | 'REMINDER';
}

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admins' },
  { value: 'manager', label: 'Managers' },
  { value: 'employee-civils', label: 'Civils Employees' },
  { value: 'employee-plant', label: 'Plant Employees' },
  { value: 'employee-transport', label: 'Transport Employees' },
  { value: 'employee-office', label: 'Office Employees' },
  { value: 'employee-workshop', label: 'Workshop Employees' },
];

export function AssignRecipientsModal({
  open,
  onClose,
  onSend,
  messageSubject,
  messageType,
}: AssignRecipientsModalProps) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [filteredEmployees, setFilteredEmployees] = useState<Employee[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [selectedRole, setSelectedRole] = useState<string>('');
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
      const { data: allEmployees, error: empError } = await supabase
        .from('profiles')
        .select(`
          id,
          full_name,
          role:roles(
            name,
            display_name
          )
        `)
        .order('full_name');

      if (empError) throw empError;

      setEmployees(allEmployees || []);
      setFilteredEmployees(allEmployees || []);
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
      const allIds = filteredEmployees.map(emp => emp.id);
      setSelectedIds(new Set(allIds));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleSelectRole = (role: string) => {
    const employeesWithRole = employees.filter(emp => emp.role?.name === role);
    const roleEmployeeIds = new Set(employeesWithRole.map(emp => emp.id));
    
    // Check if all employees in this role are already selected
    const allRoleSelected = employeesWithRole.every(emp => selectedIds.has(emp.id));
    
    const newSelected = new Set(selectedIds);
    
    if (allRoleSelected) {
      // Unselect all employees in this role
      employeesWithRole.forEach(emp => {
        newSelected.delete(emp.id);
      });
      setSelectedRole('');
    } else {
      // Select all employees in this role
      employeesWithRole.forEach(emp => {
        newSelected.add(emp.id);
      });
      setSelectedRole(role);
    }
    
    setSelectedIds(newSelected);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (selectedIds.size === 0) {
      toast.error('Please select at least one recipient');
      return;
    }

    setLoading(true);

    try {
      await onSend(Array.from(selectedIds));
      
      // Reset and close
      setSelectedIds(new Set());
      setSearchQuery('');
      setSelectedRole('');
      onClose();
    } catch (error) {
      console.error('Send error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to send message');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (loading) return;
    setSelectedIds(new Set());
    setSearchQuery('');
    setSelectedRole('');
    onClose();
  };

  const allSelected = filteredEmployees.length > 0 && selectedIds.size === filteredEmployees.length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[700px] max-h-[85vh] bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 z-[100]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {messageType === 'TOOLBOX_TALK' ? 'Choose Recipients for Toolbox Talk' : 'Choose Recipients for Reminder'}
            </DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground">{messageSubject}</span>
              <br />
              Select employees to receive this message
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Role Filter Section */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-900 dark:text-white">
                Quick Select by Role:
              </label>
              <div className="grid grid-cols-2 gap-2">
                {ROLE_OPTIONS.map((role) => {
                  const roleEmployees = employees.filter(emp => emp.role?.name === role.value);
                  const roleCount = roleEmployees.length;
                  const allRoleSelected = roleEmployees.length > 0 && roleEmployees.every(emp => selectedIds.has(emp.id));
                  
                  return (
                    <Button
                      key={role.value}
                      type="button"
                      variant={allRoleSelected ? "default" : "outline"}
                      size="sm"
                      onClick={() => handleSelectRole(role.value)}
                      disabled={loading || fetching || roleCount === 0}
                      className={`justify-start text-sm transition-all ${
                        allRoleSelected 
                          ? 'bg-avs-yellow text-slate-900 font-semibold border-2 border-avs-yellow shadow-lg' 
                          : 'hover:bg-slate-800'
                      }`}
                    >
                      {allRoleSelected && '✓ '}{role.label} ({roleCount})
                    </Button>
                  );
                })}
              </div>
            </div>

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
                disabled={loading || fetching || filteredEmployees.length === 0}
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
                        className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-accent/50"
                      >
                        <Checkbox
                          id={employee.id}
                          checked={selectedIds.has(employee.id)}
                          onCheckedChange={() => handleToggleEmployee(employee.id)}
                          disabled={loading}
                        />
                        <label
                          htmlFor={employee.id}
                          className="flex-1 text-sm font-medium cursor-pointer peer-disabled:cursor-not-allowed"
                        >
                          {employee.full_name}
                        </label>
                        <span className="text-xs text-muted-foreground">
                          {employee.role?.display_name || 'No Role'}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
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
              disabled={loading || selectedIds.size === 0}
              className={messageType === 'TOOLBOX_TALK' 
                ? 'bg-red-600 hover:bg-red-700 text-white' 
                : 'bg-blue-600 hover:bg-blue-700 text-white'
              }
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  {messageType === 'TOOLBOX_TALK' ? 'Send Toolbox Talk' : 'Send Reminder'} ({selectedIds.size})
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

