'use client';

import { useState, useEffect, useMemo } from 'react';
import { fetchUserDirectory } from '@/lib/client/user-directory';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SelectableCard } from '@/components/ui/selectable-card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, UserCheck, Search, CheckCircle2, Users, ChevronDown, Check } from 'lucide-react';
import { toast } from 'sonner';

interface Employee {
  id: string;
  full_name: string;
  employee_id?: string | null;
  team: {
    id: string;
    name: string;
  } | null;
  role: {
    name: string;
    display_name: string;
  } | null;
  hasModuleAccess?: boolean;
  alreadySigned?: boolean;
  isAssigned?: boolean;
}

interface TeamOption {
  id: string;
  name: string;
  hasModuleAccess: boolean;
  employeeIds: string[];
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
  const [originalAssignedIds, setOriginalAssignedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  useEffect(() => {
    if (open) {
      async function fetchEmployees() {
        setFetching(true);
        try {
          const allEmployees = await fetchUserDirectory({ includeRole: true, module: 'rams' });

          const supabase = (await import('@/lib/supabase/client')).createClient();

          // Fetch existing assignments for this document
          const { data: assignments, error: assignError } = await supabase
            .from('rams_assignments')
            .select('employee_id, status')
            .eq('rams_document_id', documentId);

          if (assignError) throw assignError;

          // Mark employees who have already signed
          const signedEmployeeIds = new Set(
            ((assignments || []) as Array<{ employee_id: string; status: string }>).filter((a) => a.status === 'signed').map((a) => a.employee_id)
          );

          // Mark employees who are currently assigned (regardless of status)
          const assignedEmployeeIds = new Set(
            ((assignments || []) as Array<{ employee_id: string; status: string }>).map((a) => a.employee_id)
          );

          // Set original assigned IDs for comparison
          setOriginalAssignedIds(assignedEmployeeIds);

          // Pre-select all currently assigned employees
          setSelectedIds(assignedEmployeeIds);

          const employeesWithStatus = allEmployees.map((emp) => ({
            id: emp.id,
            full_name: emp.full_name || 'Unknown User',
            employee_id: emp.employee_id || null,
            team: emp.team?.id
              ? {
                  id: emp.team.id,
                  name: emp.team.name || emp.team.id,
                }
              : null,
            role: emp.role ? {
              name: emp.role.name || 'unknown',
              display_name: emp.role.display_name || emp.role.name || 'Unknown',
            } : null,
            hasModuleAccess: emp.has_module_access !== false,
            alreadySigned: signedEmployeeIds.has(emp.id),
            isAssigned: assignedEmployeeIds.has(emp.id),
          })) || [];

          setEmployees(employeesWithStatus);
          setFilteredEmployees(employeesWithStatus);
        } catch (error) {
          console.error('Error fetching employees:', error);
          toast.error('Failed to load employees');
        } finally {
          setFetching(false);
        }
      }
      fetchEmployees();
    }
  }, [open, documentId]);

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

  const teamOptions = useMemo<TeamOption[]>(() => {
    const teamMap = new Map<string, TeamOption>();

    employees.forEach((employee) => {
      if (!employee.team?.id) {
        return;
      }

      const existing = teamMap.get(employee.team.id);
      if (existing) {
        existing.employeeIds.push(employee.id);
        existing.hasModuleAccess = existing.hasModuleAccess || employee.hasModuleAccess !== false;
        return;
      }

      teamMap.set(employee.team.id, {
        id: employee.team.id,
        name: employee.team.name,
        hasModuleAccess: employee.hasModuleAccess !== false,
        employeeIds: [employee.id],
      });
    });

    return Array.from(teamMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [employees]);

  const accessibleTeamOptions = useMemo(
    () => teamOptions.filter((team) => team.hasModuleAccess),
    [teamOptions]
  );

  const handleToggleEmployee = (id: string) => {
    const employee = employees.find(emp => emp.id === id);
    if (!employee || employee.alreadySigned || employee.hasModuleAccess === false) {
      return;
    }
    
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const handleToggleTeam = (team: TeamOption) => {
    if (!team.hasModuleAccess) {
      return;
    }

    const teamEmployeeIds = employees
      .filter(
        (employee) =>
          employee.team?.id === team.id &&
          employee.hasModuleAccess !== false &&
          !employee.alreadySigned
      )
      .map((employee) => employee.id);

    if (teamEmployeeIds.length === 0) {
      return;
    }

    const nextSelectedIds = new Set(selectedIds);
    const allTeamEmployeesSelected = teamEmployeeIds.every((employeeId) => nextSelectedIds.has(employeeId));

    if (allTeamEmployeesSelected) {
      teamEmployeeIds.forEach((employeeId) => nextSelectedIds.delete(employeeId));
    } else {
      teamEmployeeIds.forEach((employeeId) => nextSelectedIds.add(employeeId));
    }

    setSelectedIds(nextSelectedIds);
  };

  const handleToggleAllTeams = () => {
    if (accessibleTeamOptions.length === 0) {
      return;
    }

    const nextSelectedIds = new Set(selectedIds);
    const allTeamsSelected = accessibleTeamOptions.every((team) =>
      employees
        .filter(
          (employee) =>
            employee.team?.id === team.id &&
            employee.hasModuleAccess !== false &&
            !employee.alreadySigned
        )
        .every((employee) => nextSelectedIds.has(employee.id))
    );

    if (allTeamsSelected) {
      employees
        .filter((employee) => !employee.alreadySigned)
        .forEach((employee) => nextSelectedIds.delete(employee.id));
    } else {
      employees
        .filter((employee) => employee.hasModuleAccess !== false)
        .forEach((employee) => nextSelectedIds.add(employee.id));
    }

    setSelectedIds(nextSelectedIds);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setLoading(true);

    try {
      // Calculate which employees to add and which to remove
      const toAdd = Array.from(selectedIds).filter(id => !originalAssignedIds.has(id));
      const toRemove = Array.from(originalAssignedIds).filter(id => !selectedIds.has(id));

      const response = await fetch(`/api/rams/${documentId}/assign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          employee_ids: Array.from(selectedIds),
          unassign_ids: toRemove,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update assignments');
      }

      // Show appropriate success message
      if (toAdd.length > 0 && toRemove.length > 0) {
        toast.success(`Document assigned to ${toAdd.length} employee(s) and unassigned from ${toRemove.length} employee(s)`);
      } else if (toAdd.length > 0) {
        toast.success(`Document assigned to ${toAdd.length} employee(s)`);
      } else if (toRemove.length > 0) {
        toast.success(`Document unassigned from ${toRemove.length} employee(s)`);
      } else {
        toast.success('Assignments updated');
      }

      // Reset and close
      setSelectedIds(new Set());
      setOriginalAssignedIds(new Set());
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
    setOriginalAssignedIds(new Set());
    setSearchQuery('');
    onClose();
  };

  const selectedTeamCount = accessibleTeamOptions.filter((team) =>
    employees
      .filter(
        (employee) =>
          employee.team?.id === team.id &&
          employee.hasModuleAccess !== false &&
          !employee.alreadySigned
      )
      .every((employee) => selectedIds.has(employee.id))
  ).length;
  const allTeamsSelected = accessibleTeamOptions.length > 0 && selectedTeamCount === accessibleTeamOptions.length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh]">
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

            {/* Team Selection */}
            <div className="flex items-center justify-between border-b border-slate-700 pb-3">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={loading || fetching || teamOptions.length === 0}
                    className="border-rams text-rams hover:bg-rams hover:text-white text-xs"
                  >
                    <Users className="mr-2 h-4 w-4" />
                    {selectedTeamCount > 0 ? `${selectedTeamCount} team${selectedTeamCount !== 1 ? 's' : ''} selected` : 'Select Teams'}
                    <ChevronDown className="ml-2 h-4 w-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-72 border-slate-700 bg-slate-900 p-2 text-slate-100">
                  <div className="space-y-1">
                    <button
                      type="button"
                      onClick={handleToggleAllTeams}
                      disabled={accessibleTeamOptions.length === 0}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors ${
                        allTeamsSelected ? 'bg-rams text-white' : 'hover:bg-slate-800'
                      } ${accessibleTeamOptions.length === 0 ? 'cursor-not-allowed opacity-50' : ''}`}
                    >
                      <Users className="h-4 w-4 flex-shrink-0" />
                      <span className="flex-1 text-left">All Teams</span>
                      {allTeamsSelected && <Check className="h-4 w-4 flex-shrink-0" />}
                    </button>
                    <div className="max-h-56 space-y-1 overflow-y-auto border-t border-slate-700 pt-2">
                      {teamOptions.map((team) => {
                        const isSelected = employees
                          .filter(
                            (employee) =>
                              employee.team?.id === team.id &&
                              employee.hasModuleAccess !== false &&
                              !employee.alreadySigned
                          )
                          .every((employee) => selectedIds.has(employee.id));

                        return (
                          <button
                            key={team.id}
                            type="button"
                            onClick={() => handleToggleTeam(team)}
                            disabled={!team.hasModuleAccess}
                            className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors ${
                              isSelected ? 'bg-rams text-white' : 'hover:bg-slate-800'
                            } ${!team.hasModuleAccess ? 'cursor-not-allowed opacity-50' : ''}`}
                          >
                            <Users className="h-4 w-4 flex-shrink-0" />
                            <span className="flex-1 truncate text-left">{team.name}</span>
                            {!team.hasModuleAccess ? (
                              <span className="text-[11px] uppercase tracking-wide text-slate-400">No Access</span>
                            ) : (
                              isSelected && <Check className="h-4 w-4 flex-shrink-0" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
              <span className="text-sm text-muted-foreground">
                {selectedIds.size} selected
              </span>
            </div>

            {/* Employees List */}
            {fetching ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-green-500" />
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
                      <SelectableCard
                        key={employee.id}
                        selected={selectedIds.has(employee.id)}
                        onSelect={() => handleToggleEmployee(employee.id)}
                        disabled={loading || employee.hasModuleAccess === false}
                        locked={employee.alreadySigned || employee.hasModuleAccess === false}
                        lockedMessage={employee.alreadySigned ? 'Signed' : 'No Access'}
                        variant="rams"
                      >
                        <div className="flex items-center justify-between w-full">
                          <div className="flex flex-col">
                            <span className="text-sm font-medium text-slate-100">
                              {employee.full_name}
                              {employee.employee_id ? ` (${employee.employee_id})` : ''}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {employee.hasModuleAccess === false
                                ? `${employee.role?.display_name || 'No Role'} • No RAMS access`
                                : employee.role?.display_name || 'No Role'}
                            </span>
                          </div>
                          {employee.alreadySigned && (
                            <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                          )}
                        </div>
                      </SelectableCard>
                    ))
                  )}
                </div>
              </ScrollArea>
            )}

            {selectedIds.size > 0 && (
              <div className="rounded-md bg-green-950/30 border border-green-800/50 p-3">
                <p className="text-sm text-green-200">
                  {selectedIds.size} employee{selectedIds.size !== 1 ? 's' : ''} will be notified
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
              variant="outline"
              disabled={loading}
              className="border-rams text-rams hover:bg-rams hover:text-white"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Updating...
                </>
              ) : (
                <>
                  <UserCheck className="h-4 w-4 mr-2" />
                  Update Assignments ({selectedIds.size} selected)
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

