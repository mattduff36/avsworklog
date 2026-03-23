'use client';

import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { fetchUserDirectory } from '@/lib/client/user-directory';
import { Employee } from '@/types/common';

interface EmployeeSelectorProps {
  value: string;
  onChange: (value: string) => void;
  isManager: boolean;
  currentUserId?: string;
  includeAll?: boolean;
  label?: string;
  className?: string;
}

export function EmployeeSelector({
  value,
  onChange,
  isManager,
  currentUserId,
  includeAll = false,
  label = 'Creating for',
  className = '',
}: EmployeeSelectorProps) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchEmployees() {
      try {
        const data = await fetchUserDirectory();

        // Sort: current user first, then alphabetically
        const sorted = (data as Array<{ id: string; full_name: string | null; employee_id: string | null }>).sort((a, b) => {
          if (currentUserId) {
            if (a.id === currentUserId) return -1;
            if (b.id === currentUserId) return 1;
          }
          return (a.full_name || '').localeCompare(b.full_name || '');
        });

        setEmployees(sorted.map((employee) => ({
          ...employee,
          full_name: employee.full_name || 'Unknown User',
        })));
      } catch (error) {
        console.error('Error fetching employees:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchEmployees();
  }, [isManager, currentUserId]);

  if (!isManager) return null;

  return (
    <div className={className}>
      <Label htmlFor="employee-select">{label}</Label>
      <Select value={value} onValueChange={onChange} disabled={loading}>
        <SelectTrigger id="employee-select">
          <SelectValue placeholder={loading ? 'Loading...' : 'Select employee'} />
        </SelectTrigger>
        <SelectContent>
          {includeAll && <SelectItem value="all">All Employees</SelectItem>}
          {employees.map((emp) => (
            <SelectItem key={emp.id} value={emp.id}>
              {emp.full_name}
              {emp.employee_id ? ` (${emp.employee_id})` : ''}
              {emp.id === currentUserId ? ' (You)' : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

