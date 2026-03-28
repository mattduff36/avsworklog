'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { TeamToggleMenu } from '@/components/ui/team-toggle-menu';
import { fetchUserDirectory } from '@/lib/client/user-directory';
import { useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import { getErrorMessage, shouldLogAbsenceManageError } from '@/lib/utils/absence-error-handling';
import { getCurrentFinancialYear } from '@/lib/utils/date';
import { Loader2, Lock, RotateCcw, ShieldCheck, Sparkles, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { AbsencePermissionExceptionsDialog } from '@/app/(dashboard)/absence/manage/components/AbsencePermissionExceptionsDialog';

interface BulkEmployeeOption {
  id: string;
  full_name: string;
  employee_id: string | null;
  team_id: string | null;
  team_name: string | null;
  role_id: string | null;
  role_name: string | null;
  role_display_name: string | null;
}

interface GenerationStatus {
  currentFinancialYearStartYear: number;
  currentFinancialYearLabel: string;
  latestGeneratedFinancialYearStartYear: number;
  latestGeneratedFinancialYearLabel: string;
  nextFinancialYearLabel: string;
  closedFinancialYearStartYears: number[];
  latestClosedFinancialYearLabel: string | null;
  latestClosedFinancialYearClosedAt: string | null;
  latestClosedFinancialYearClosedByName: string | null;
  latestUndoableClosedFinancialYearStartYear: number | null;
  latestUndoableClosedFinancialYearLabel: string | null;
  canUndoLatestClosedFinancialYear: boolean;
  undoCloseBlockedReason: string | null;
}

interface ShutdownWarningRow {
  profileId: string;
  fullName: string;
  employeeId: string | null;
  allowance: number;
  alreadyBooked: number;
  requestedDays: number;
  projectedRemaining: number;
}

interface ShutdownConflictRow {
  profileId: string;
  fullName: string;
  employeeId: string | null;
  reasonName: string | null;
  status: string;
  conflictStartDate: string;
  conflictEndDate: string;
}

interface ShutdownPreviewResult {
  startDate: string;
  endDate: string;
  reasonName: string;
  requestedDays: number;
  requestedDaysMin: number;
  requestedDaysMax: number;
  totalEmployees: number;
  targetedEmployees: number;
  wouldCreate: number;
  createdCount: number;
  duplicateCount: number;
  partialConflictEmployeeCount: number;
  conflictingWorkingDaysSkipped: number;
  createdSegmentsCount: number;
  warningCount: number;
  warnings: ShutdownWarningRow[];
  conflicts: ShutdownConflictRow[];
}

function formatRequestedDaysSummary(preview: ShutdownPreviewResult): string {
  if (preview.requestedDaysMin === preview.requestedDaysMax) {
    return `${preview.requestedDaysMax} working day${preview.requestedDaysMax === 1 ? '' : 's'}`;
  }

  return `${preview.requestedDaysMin}-${preview.requestedDaysMax} working days depending on work pattern`;
}

interface BulkAbsenceBatchSummary {
  id: string;
  reasonName: string;
  startDate: string;
  endDate: string;
  targetedEmployees: number;
  createdCount: number;
  duplicateCount: number;
}

function formatFinancialYearLabel(startYear: number): string {
  return `${startYear}/${(startYear + 1).toString().slice(-2)}`;
}

function formatAuditTimestamp(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

function getOldestOpenFinancialYearStartYear(
  currentFinancialYearStartYear: number,
  latestGeneratedFinancialYearStartYear: number,
  closedFinancialYearStartYears: number[]
): number | null {
  const closedYears = new Set(closedFinancialYearStartYears);
  for (let year = currentFinancialYearStartYear; year <= latestGeneratedFinancialYearStartYear; year += 1) {
    if (!closedYears.has(year)) {
      return year;
    }
  }
  return null;
}

export function ManageOverviewAdminActions() {
  const supabase = createClient();
  const router = useRouter();
  const { isAdmin } = useAuth();
  const [generationStatus, setGenerationStatus] = useState<GenerationStatus | null>(null);
  const [generationStatusHydrating, setGenerationStatusHydrating] = useState(true);
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const [showCloseYearDialog, setShowCloseYearDialog] = useState(false);
  const [showUndoCloseYearDialog, setShowUndoCloseYearDialog] = useState(false);
  const [showShutdownDialog, setShowShutdownDialog] = useState(false);
  const [showBulkUndoDialog, setShowBulkUndoDialog] = useState(false);
  const [showPermissionExceptionsDialog, setShowPermissionExceptionsDialog] = useState(false);
  const [generatingAllowances, setGeneratingAllowances] = useState(false);
  const [removingGeneratedYear, setRemovingGeneratedYear] = useState(false);
  const [closingCurrentYear, setClosingCurrentYear] = useState(false);
  const [undoingClosedYear, setUndoingClosedYear] = useState(false);
  const [deleteExistingBookings, setDeleteExistingBookings] = useState(false);

  const [shutdownStartDate, setShutdownStartDate] = useState('');
  const [shutdownEndDate, setShutdownEndDate] = useState('');
  const [shutdownNotes, setShutdownNotes] = useState('');
  const [shutdownReasonId, setShutdownReasonId] = useState('');
  const [shutdownApplyMode, setShutdownApplyMode] = useState<'all' | 'selection'>('all');
  const [shutdownRoleFilters, setShutdownRoleFilters] = useState<string[]>([]);
  const [shutdownEmployeeFilters, setShutdownEmployeeFilters] = useState<string[]>([]);
  const [shutdownLoading, setShutdownLoading] = useState(false);
  const [shutdownPreview, setShutdownPreview] = useState<ShutdownPreviewResult | null>(null);

  const [bulkEmployeeOptions, setBulkEmployeeOptions] = useState<BulkEmployeeOption[]>([]);
  const [bulkReasonOptions, setBulkReasonOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [bulkRoleOptions, setBulkRoleOptions] = useState<Array<{ id: string; label: string }>>([]);
  const [bulkUndoLoading, setBulkUndoLoading] = useState(false);
  const [bulkBatchUndoId, setBulkBatchUndoId] = useState('');
  const [bulkBatches, setBulkBatches] = useState<BulkAbsenceBatchSummary[]>([]);

  const hasSelection = useMemo(
    () => shutdownRoleFilters.length > 0 || shutdownEmployeeFilters.length > 0,
    [shutdownRoleFilters, shutdownEmployeeFilters]
  );

  const loadGenerationStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/absence/generation/status', { method: 'GET' });
      const payload = (await response.json()) as {
        success?: boolean;
        currentFinancialYearStartYear?: number;
        latestGeneratedFinancialYearStartYear?: number;
        latestGeneratedFinancialYearLabel?: string;
        nextFinancialYearLabel?: string;
        closedFinancialYearStartYears?: number[];
        latestClosedFinancialYearLabel?: string | null;
        latestClosedFinancialYearClosedAt?: string | null;
        latestClosedFinancialYearClosedByName?: string | null;
        latestUndoableClosedFinancialYearStartYear?: number | null;
        latestUndoableClosedFinancialYearLabel?: string | null;
        canUndoLatestClosedFinancialYear?: boolean;
        undoCloseBlockedReason?: string | null;
        error?: string;
      };
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Failed to load generation status');
      }
      const currentFinancialYearStartYear =
        payload.currentFinancialYearStartYear ?? getCurrentFinancialYear().start.getFullYear();
      const latestGeneratedFinancialYearStartYear =
        payload.latestGeneratedFinancialYearStartYear ?? currentFinancialYearStartYear;
      setGenerationStatus({
        currentFinancialYearStartYear,
        currentFinancialYearLabel: formatFinancialYearLabel(currentFinancialYearStartYear),
        latestGeneratedFinancialYearStartYear,
        latestGeneratedFinancialYearLabel: payload.latestGeneratedFinancialYearLabel || 'current year',
        nextFinancialYearLabel: payload.nextFinancialYearLabel || 'next year',
        closedFinancialYearStartYears: payload.closedFinancialYearStartYears || [],
        latestClosedFinancialYearLabel: payload.latestClosedFinancialYearLabel || null,
        latestClosedFinancialYearClosedAt: payload.latestClosedFinancialYearClosedAt || null,
        latestClosedFinancialYearClosedByName: payload.latestClosedFinancialYearClosedByName || null,
        latestUndoableClosedFinancialYearStartYear: payload.latestUndoableClosedFinancialYearStartYear ?? null,
        latestUndoableClosedFinancialYearLabel: payload.latestUndoableClosedFinancialYearLabel || null,
        canUndoLatestClosedFinancialYear: payload.canUndoLatestClosedFinancialYear === true,
        undoCloseBlockedReason: payload.undoCloseBlockedReason || null,
      });
    } catch (error) {
      console.error('Error loading generation status:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to load generation status');
    } finally {
      setGenerationStatusHydrating(false);
    }
  }, []);

  const loadBulkOptions = useCallback(async () => {
    try {
      const [profiles, { data: reasons, error: reasonsError }] = await Promise.all([
        fetchUserDirectory({ includeRole: true }),
        supabase
          .from('absence_reasons')
          .select('id, name, is_active')
          .eq('is_active', true)
          .order('name'),
      ]);

      if (reasonsError) throw reasonsError;

      type ProfileData = {
        id: string;
        full_name: string;
        employee_id: string | null;
        team?: { id?: string | null; name?: string | null } | null;
        role?: { id?: string | null; name?: string | null; display_name?: string | null } | null;
      };
      const nextEmployees = ((profiles || []) as ProfileData[]).map((profile) => ({
        id: profile.id,
        full_name: profile.full_name || 'Unknown User',
        employee_id: profile.employee_id,
        team_id: profile.team?.id || null,
        team_name: profile.team?.name || null,
        role_id: profile.role?.id || null,
        role_name: profile.role?.name || null,
        role_display_name: profile.role?.display_name || null,
      }));
      setBulkEmployeeOptions(nextEmployees);

      const roleMap = new Map<string, string>();
      nextEmployees.forEach((employee) => {
        if (!employee.role_id) return;
        const label = employee.role_display_name?.trim() || employee.role_name?.trim();
        if (!label) return;
        if (!roleMap.has(employee.role_id)) {
          roleMap.set(employee.role_id, label);
        }
      });
      const roleOptions = Array.from(roleMap.entries())
        .map(([id, label]) => ({ id, label }))
        .sort((a, b) => a.label.localeCompare(b.label));
      setBulkRoleOptions(roleOptions);

      const nextReasons = ((reasons || []) as Array<{ id: string; name: string }>).map((reason) => ({
        id: reason.id,
        name: reason.name,
      }));
      setBulkReasonOptions(nextReasons);
      setShutdownReasonId((current) => current || nextReasons[0]?.id || '');
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to load bulk absence options');
      if (shouldLogAbsenceManageError(error)) {
        console.error('Error loading bulk absence options:', error);
      } else {
        console.warn('Bulk absence options load blocked:', message);
      }
      toast.error(message);
    }
  }, [supabase]);

  useEffect(() => {
    void Promise.all([loadGenerationStatus(), loadBulkOptions()]);
  }, [loadGenerationStatus, loadBulkOptions]);

  const bulkTeamOptions = useMemo(() => {
    const teamMap = new Map<string, { id: string; name: string }>();

    bulkEmployeeOptions.forEach((employee) => {
      if (!employee.team_id) return;

      const existing = teamMap.get(employee.team_id);
      if (existing) {
        return;
      }

      teamMap.set(employee.team_id, {
        id: employee.team_id,
        name: employee.team_name || employee.team_id,
      });
    });

    return Array.from(teamMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [bulkEmployeeOptions]);
  const selectedBulkTeamCount = useMemo(
    () =>
      bulkTeamOptions.filter((team) =>
        bulkEmployeeOptions
          .filter((employee) => employee.team_id === team.id)
          .every((employee) => shutdownEmployeeFilters.includes(employee.id))
      ).length,
    [bulkTeamOptions, bulkEmployeeOptions, shutdownEmployeeFilters]
  );
  const selectableBulkTeamEmployeeIds = useMemo(
    () =>
      bulkEmployeeOptions
        .filter((employee) => employee.team_id)
        .map((employee) => employee.id),
    [bulkEmployeeOptions]
  );
  const allBulkTeamsSelected =
    bulkTeamOptions.length > 0 && selectedBulkTeamCount === bulkTeamOptions.length;

  const bulkAbsenceLabel = 'Bulk Absence';
  const undoCloseLabel = 'Undo Close';
  const closeTargetFinancialYearStartYear = useMemo(() => {
    if (!generationStatus) return null;
    return getOldestOpenFinancialYearStartYear(
      generationStatus.currentFinancialYearStartYear,
      generationStatus.latestGeneratedFinancialYearStartYear,
      generationStatus.closedFinancialYearStartYears
    );
  }, [generationStatus]);
  const closeTargetFinancialYearLabel = useMemo(() => {
    if (closeTargetFinancialYearStartYear === null) return null;
    return formatFinancialYearLabel(closeTargetFinancialYearStartYear);
  }, [closeTargetFinancialYearStartYear]);
  const closeYearLabel = `Close ${closeTargetFinancialYearLabel || 'No Open Year'}`;
  const setupYearLabel = `Set up ${generationStatus?.nextFinancialYearLabel || 'next year'}`;
  // Keep tile width stable so labels don't cause a visible resize.
  const actionTileWidthCh = 22;
  const actionTileClass =
    'h-[54px] justify-center rounded-lg border-4 border-slate-600 bg-slate-800 dark:bg-slate-900 px-3 text-white shadow-md transition-all duration-200 hover:scale-105 hover:border-slate-500 hover:bg-slate-800 active:scale-95 animate-tile-pop disabled:opacity-60';

  function toggleShutdownRole(roleId: string) {
    setShutdownRoleFilters((prev) => (prev.includes(roleId) ? prev.filter((role) => role !== roleId) : [...prev, roleId]));
    setShutdownPreview(null);
  }

  function toggleShutdownEmployee(profileId: string) {
    setShutdownEmployeeFilters((prev) => (prev.includes(profileId) ? prev.filter((id) => id !== profileId) : [...prev, profileId]));
    setShutdownPreview(null);
  }

  function toggleShutdownTeam(teamId: string) {
    const teamEmployeeIds = bulkEmployeeOptions
      .filter((employee) => employee.team_id === teamId)
      .map((employee) => employee.id);

    if (teamEmployeeIds.length === 0) return;

    setShutdownEmployeeFilters((prev) => {
      const allSelected = teamEmployeeIds.every((employeeId) => prev.includes(employeeId));
      return allSelected
        ? prev.filter((id) => !teamEmployeeIds.includes(id))
        : Array.from(new Set([...prev, ...teamEmployeeIds]));
    });
    setShutdownPreview(null);
  }

  function toggleAllShutdownTeams() {
    if (selectableBulkTeamEmployeeIds.length === 0) return;

    setShutdownEmployeeFilters((prev) => {
      const allSelected = selectableBulkTeamEmployeeIds.every((employeeId) => prev.includes(employeeId));
      return allSelected
        ? prev.filter((id) => !selectableBulkTeamEmployeeIds.includes(id))
        : Array.from(new Set([...prev, ...selectableBulkTeamEmployeeIds]));
    });
    setShutdownPreview(null);
  }

  async function loadBulkAbsenceBatches() {
    setBulkUndoLoading(true);
    try {
      const response = await fetch('/api/absence/shutdown', { method: 'GET' });
      const payload = (await response.json()) as {
        success?: boolean;
        batches?: BulkAbsenceBatchSummary[];
        error?: string;
      };
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Failed to load bulk booking history');
      }
      const nextBatches = payload.batches || [];
      setBulkBatches(nextBatches);
      setBulkBatchUndoId((current) => {
        if (current && nextBatches.some((batch) => batch.id === current)) {
          return current;
        }
        return nextBatches[0]?.id || '';
      });
    } catch (error) {
      console.error('Error loading bulk absence batches:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to load bulk booking history');
    } finally {
      setBulkUndoLoading(false);
    }
  }

  async function requestShutdownPreview(confirm: boolean) {
    if (!shutdownStartDate) {
      toast.error('Please select the first day off');
      return;
    }
    if (!shutdownReasonId) {
      toast.error('Please select an absence reason');
      return;
    }
    if (shutdownApplyMode === 'selection' && !hasSelection) {
      toast.error('Choose at least one role or employee');
      return;
    }

    setShutdownLoading(true);
    try {
      const response = await fetch('/api/absence/shutdown', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reasonId: shutdownReasonId,
          startDate: shutdownStartDate,
          endDate: shutdownEndDate || shutdownStartDate,
          notes: shutdownNotes,
          applyToAll: shutdownApplyMode === 'all',
          roleIds: shutdownRoleFilters,
          employeeIds: shutdownEmployeeFilters,
          confirm,
        }),
      });
      const payload = (await response.json()) as ShutdownPreviewResult & { success?: boolean; error?: string };
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Failed to process bulk absence booking');
      }

      setShutdownPreview(payload);
      if (confirm) {
        toast.success(
          `Created ${payload.createdCount} ${payload.reasonName} booking(s). ${payload.duplicateCount} fully skipped, ${payload.partialConflictEmployeeCount} partially applied.`
        );
        setShowShutdownDialog(false);
        setShutdownStartDate('');
        setShutdownEndDate('');
        setShutdownNotes('');
        setShutdownRoleFilters([]);
        setShutdownEmployeeFilters([]);
        setShutdownApplyMode('all');
        setShutdownPreview(null);
        await loadBulkAbsenceBatches();
        return;
      }

      if (payload.warningCount > 0) {
        toast.warning(`${payload.warningCount} employee(s) would exceed allowance. Review list and consider Unpaid Leave where needed.`);
      } else {
        toast.success(`Preview ready: ${payload.wouldCreate} booking(s) will be created.`);
      }
    } catch (error) {
      console.error('Error processing bulk absence booking:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to process bulk absence booking');
    } finally {
      setShutdownLoading(false);
    }
  }

  async function handleUndoBulkAbsenceBatch() {
    if (!bulkBatchUndoId) {
      toast.error('Please choose a batch to undo');
      return;
    }
    if (!bulkBatches.some((batch) => batch.id === bulkBatchUndoId)) {
      toast.error('Selected batch is no longer available. Please refresh and choose again.');
      return;
    }

    setBulkUndoLoading(true);
    try {
      const response = await fetch('/api/absence/shutdown', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ batchId: bulkBatchUndoId }),
      });
      const payload = (await response.json()) as {
        success?: boolean;
        removedAbsences?: number;
        error?: string;
      };
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Failed to undo bulk absence batch');
      }
      toast.success(`Undo complete. Removed ${payload.removedAbsences ?? 0} booking(s).`);
      setShowBulkUndoDialog(false);
      await loadBulkAbsenceBatches();
    } catch (error) {
      console.error('Error undoing bulk absence batch:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to undo bulk absence batch');
    } finally {
      setBulkUndoLoading(false);
    }
  }

  async function handleGenerateAllowances() {
    setGeneratingAllowances(true);
    try {
      const response = await fetch('/api/absence/generation/generate-next-year', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      const payload = (await response.json()) as {
        success?: boolean;
        created?: number;
        skippedExisting?: number;
        financialYearLabel?: string;
        error?: string;
      };
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Failed to generate allowances');
      }
      toast.success(
        `Allowances generated for ${payload.financialYearLabel}: ${payload.created ?? 0} created, ${payload.skippedExisting ?? 0} already existed`
      );
      setShowGenerateDialog(false);
      setDeleteExistingBookings(false);
      await loadGenerationStatus();
    } catch (error) {
      console.error('Error generating next financial year allowances:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to generate allowances');
    } finally {
      setGeneratingAllowances(false);
    }
  }

  async function handleRemoveGeneratedYear() {
    setRemovingGeneratedYear(true);
    try {
      const response = await fetch('/api/absence/generation/remove-next-year', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          deleteExistingBookings,
        }),
      });
      const payload = (await response.json()) as {
        success?: boolean;
        removedFinancialYearLabel?: string;
        removedGeneratedAbsences?: number;
        removedExistingAbsences?: number;
        error?: string;
      };
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Failed to remove generated year');
      }
      toast.success(
        `Removed ${payload.removedFinancialYearLabel}: ${payload.removedGeneratedAbsences ?? 0} auto-generated entries and ${payload.removedExistingAbsences ?? 0} existing booking(s) deleted.`
      );
      setShowGenerateDialog(false);
      setDeleteExistingBookings(false);
      await loadGenerationStatus();
    } catch (error) {
      console.error('Error removing generated financial year:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to remove generated year');
    } finally {
      setRemovingGeneratedYear(false);
    }
  }

  async function handleCloseCurrentYearBookings() {
    if (closeTargetFinancialYearStartYear === null) {
      toast.error('No open financial year is available to close.');
      return;
    }

    setClosingCurrentYear(true);
    try {
      const response = await fetch('/api/absence/generation/close-current-year', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          financialYearStartYear: closeTargetFinancialYearStartYear,
        }),
      });
      const payload = (await response.json()) as {
        success?: boolean;
        closedFinancialYearLabel?: string;
        pendingCount?: number;
        carryoversWritten?: number;
        error?: string;
      };
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Failed to close current financial year');
      }
      toast.success(
        `Closed ${payload.closedFinancialYearLabel}: ${payload.carryoversWritten ?? 0} carryover balance(s) written.`
      );
      setShowCloseYearDialog(false);
      await loadGenerationStatus();
      router.push('/absence/manage?tab=allowances');
    } catch (error) {
      console.error('Error closing current financial year bookings:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to close current financial year');
    } finally {
      setClosingCurrentYear(false);
    }
  }

  async function handleUndoCloseCurrentYearBookings() {
    setUndoingClosedYear(true);
    try {
      const response = await fetch('/api/absence/generation/undo-close-current-year', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      const payload = (await response.json()) as {
        success?: boolean;
        undoneFinancialYearLabel?: string;
        restoredCarryovers?: number;
        error?: string;
      };
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Failed to undo closed financial year');
      }
      toast.success(
        `Reopened ${payload.undoneFinancialYearLabel}: restored ${payload.restoredCarryovers ?? 0} carryover balance(s).`
      );
      setShowUndoCloseYearDialog(false);
      await loadGenerationStatus();
    } catch (error) {
      console.error('Error undoing close financial year bookings:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to undo close year');
    } finally {
      setUndoingClosedYear(false);
    }
  }

  return (
    <>
      <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <CardTitle className="text-foreground">Admin Actions</CardTitle>
          <CardDescription className="text-muted-foreground">
            Run bulk absence booking and prepare next-year setup actions.
          </CardDescription>
          <div className="mt-1 min-h-[72px]">
            {generationStatusHydrating ? (
              <p className="text-xs text-muted-foreground">Loading admin status...</p>
            ) : null}
            {generationStatus ? (
              <p className="text-xs text-muted-foreground">
                Current booking horizon: {generationStatus.latestGeneratedFinancialYearLabel}. Next available generation:{' '}
                {generationStatus.nextFinancialYearLabel}.
              </p>
            ) : null}
            {generationStatus?.latestClosedFinancialYearLabel ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Latest closed financial year: {generationStatus.latestClosedFinancialYearLabel}.
              </p>
            ) : null}
            {generationStatus?.latestClosedFinancialYearClosedAt ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Closed by {generationStatus.latestClosedFinancialYearClosedByName || 'Unknown'} on{' '}
                {formatAuditTimestamp(generationStatus.latestClosedFinancialYearClosedAt) || 'Unknown date'}.
              </p>
            ) : null}
            {isAdmin && generationStatus?.latestClosedFinancialYearLabel && !generationStatus.canUndoLatestClosedFinancialYear ? (
              <p className="mt-1 text-xs text-amber-300">
                Undo Close unavailable: {generationStatus.undoCloseBlockedReason || 'This closed year cannot be reopened right now.'}
              </p>
            ) : null}
          </div>
        </div>
        <div className="inline-grid grid-cols-3 gap-2 self-start">
          {generationStatusHydrating ? (
            <div
              className={`${actionTileClass} col-span-3 flex items-center justify-center`}
              style={{ width: `${actionTileWidthCh}ch` }}
            >
              <Loader2 className="h-4 w-4 animate-spin text-absence" />
            </div>
          ) : (
            <>
              <Button
                onClick={() => setShowShutdownDialog(true)}
                variant="outline"
                className={actionTileClass}
                style={{ width: `${actionTileWidthCh}ch` }}
              >
                <span className="flex w-full items-center justify-center gap-2 text-center text-sm font-semibold text-foreground">
                  <Users className="h-4 w-4 text-absence" />
                  {bulkAbsenceLabel}
                </span>
              </Button>
              <Button
                onClick={() => setShowGenerateDialog(true)}
                variant="outline"
                className={actionTileClass}
                style={{ width: `${actionTileWidthCh}ch` }}
              >
                <span className="flex w-full items-center justify-center gap-2 text-center text-sm font-semibold">
                  <Sparkles className="h-4 w-4 text-absence" />
                  {setupYearLabel}
                </span>
              </Button>
              {isAdmin ? (
                <Button
                  onClick={() => setShowUndoCloseYearDialog(true)}
                  variant="outline"
                  disabled={!generationStatus?.latestClosedFinancialYearLabel}
                  className={actionTileClass}
                  style={{ width: `${actionTileWidthCh}ch` }}
                >
                  <span className="flex w-full items-center justify-center gap-2 text-center text-sm font-semibold">
                    <RotateCcw className="h-4 w-4 text-absence" />
                    {undoCloseLabel}
                  </span>
                </Button>
              ) : null}
              {isAdmin ? (
                <Button
                  onClick={() => setShowPermissionExceptionsDialog(true)}
                  variant="outline"
                  className={actionTileClass}
                  style={{ width: `${actionTileWidthCh}ch` }}
                >
                  <span className="flex w-full items-center justify-center gap-2 text-center text-sm font-semibold">
                    <ShieldCheck className="h-4 w-4 text-absence" />
                    Exceptions Matrix
                  </span>
                </Button>
              ) : null}
              <Button
                onClick={() => setShowCloseYearDialog(true)}
                variant="outline"
                className={actionTileClass}
                style={{ width: `${actionTileWidthCh}ch` }}
                disabled={closeTargetFinancialYearStartYear === null}
              >
                <span className="flex w-full items-center justify-center gap-2 text-center text-sm font-semibold">
                  <Lock className="h-4 w-4 text-absence" />
                  {closeYearLabel}
                </span>
              </Button>
            </>
          )}
        </div>
      </CardHeader>

      <Dialog
        open={showShutdownDialog}
        onOpenChange={(open) => {
          setShowShutdownDialog(open);
          if (!open) {
            setShutdownPreview(null);
            setShutdownRoleFilters([]);
            setShutdownEmployeeFilters([]);
            setShutdownApplyMode('all');
          }
        }}
      >
        <DialogContent className="border-border max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-foreground">Book Bulk Absence</DialogTitle>
            <DialogDescription className="text-slate-400/90">
              Create approved absence bookings in bulk with filters for reason, job role, and selected employees.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border border-[hsl(var(--absence-primary)/0.25)] bg-[hsl(var(--absence-primary)/0.06)] p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="overview-shutdown-reason" className="text-foreground font-medium">Reason *</Label>
                <Select
                  value={shutdownReasonId}
                  onValueChange={(value) => {
                    setShutdownReasonId(value);
                    setShutdownPreview(null);
                  }}
                >
                  <SelectTrigger id="overview-shutdown-reason" className="bg-slate-950 border-border text-foreground">
                    <SelectValue placeholder="Select absence reason" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-950 border-border text-foreground">
                    {bulkReasonOptions.map((reason) => (
                      <SelectItem key={reason.id} value={reason.id}>
                        {reason.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="overview-shutdown-apply-mode" className="text-foreground font-medium">Apply to *</Label>
                <Select
                  value={shutdownApplyMode}
                  onValueChange={(value: 'all' | 'selection') => {
                    setShutdownApplyMode(value);
                    setShutdownPreview(null);
                  }}
                >
                  <SelectTrigger id="overview-shutdown-apply-mode" className="bg-slate-950 border-border text-foreground">
                    <SelectValue placeholder="Select targeting mode" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-950 border-border text-foreground">
                    <SelectItem value="all">All employees</SelectItem>
                    <SelectItem value="selection">Selected roles/employees</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {shutdownApplyMode === 'selection' && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-foreground font-medium">Job roles (union filter)</Label>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full justify-start bg-slate-950 border-border text-foreground hover:bg-slate-950"
                      >
                        {shutdownRoleFilters.length > 0 ? `${shutdownRoleFilters.length} role(s) selected` : 'Select job roles'}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="z-[120] w-72 max-h-64 overflow-y-auto bg-slate-950 border-border text-foreground">
                      {bulkRoleOptions.length === 0 ? (
                        <DropdownMenuLabel className="text-muted-foreground">No roles available</DropdownMenuLabel>
                      ) : (
                        bulkRoleOptions.map((roleOption) => (
                          <DropdownMenuCheckboxItem
                            key={roleOption.id}
                            checked={shutdownRoleFilters.includes(roleOption.id)}
                            onCheckedChange={() => toggleShutdownRole(roleOption.id)}
                            className="text-foreground focus:bg-slate-800/70 focus:text-foreground"
                          >
                            {roleOption.label}
                          </DropdownMenuCheckboxItem>
                        ))
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-foreground font-medium">Teams (bulk toggle)</Label>
                  <TeamToggleMenu
                    teams={bulkTeamOptions.map((team) => ({
                      ...team,
                      hasAccess: true,
                      selected: (() => {
                        const teamEmployees = bulkEmployeeOptions.filter(
                          (employee) => employee.team_id === team.id
                        );
                        return teamEmployees.length > 0 && teamEmployees.every((employee) => shutdownEmployeeFilters.includes(employee.id));
                      })(),
                    }))}
                    selectedTeamCount={selectedBulkTeamCount}
                    allTeamsSelected={allBulkTeamsSelected}
                    onToggleTeam={toggleShutdownTeam}
                    onToggleAllTeams={toggleAllShutdownTeams}
                    disabled={bulkTeamOptions.length === 0}
                    triggerLabel="Select Teams"
                    triggerClassName="w-full justify-start bg-slate-950 border-absence text-absence hover:bg-absence hover:text-white"
                    activeItemClassName="bg-absence text-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-foreground font-medium">Employees (union filter)</Label>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full justify-start bg-slate-950 border-border text-foreground hover:bg-slate-950"
                      >
                        {shutdownEmployeeFilters.length > 0 ? `${shutdownEmployeeFilters.length} employee(s) selected` : 'Select employees'}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="z-[120] w-80 max-h-72 overflow-y-auto bg-slate-950 border-border text-foreground">
                      {bulkEmployeeOptions.map((employee) => (
                        <DropdownMenuCheckboxItem
                          key={employee.id}
                          checked={shutdownEmployeeFilters.includes(employee.id)}
                          onCheckedChange={() => toggleShutdownEmployee(employee.id)}
                          className="text-foreground focus:bg-slate-800/70 focus:text-foreground"
                        >
                          {employee.full_name}
                          {employee.employee_id ? ` (${employee.employee_id})` : ''}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="overview-shutdown-start-date" className="text-foreground font-medium">First day off *</Label>
                <Input
                  id="overview-shutdown-start-date"
                  type="date"
                  value={shutdownStartDate}
                  onChange={(event) => {
                    setShutdownStartDate(event.target.value);
                    setShutdownPreview(null);
                    if (shutdownEndDate && shutdownEndDate < event.target.value) {
                      setShutdownEndDate(event.target.value);
                    }
                  }}
                  className="bg-slate-950 border-border text-foreground"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="overview-shutdown-end-date" className="text-foreground font-medium">Last day off *</Label>
                <Input
                  id="overview-shutdown-end-date"
                  type="date"
                  value={shutdownEndDate}
                  onChange={(event) => {
                    setShutdownEndDate(event.target.value);
                    setShutdownPreview(null);
                  }}
                  min={shutdownStartDate || undefined}
                  className="bg-slate-950 border-border text-foreground"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="overview-shutdown-notes" className="text-foreground font-medium">Booking Notes (optional)</Label>
              <Textarea
                id="overview-shutdown-notes"
                value={shutdownNotes}
                onChange={(event) => {
                  setShutdownNotes(event.target.value);
                  setShutdownPreview(null);
                }}
                placeholder="Example: Company training day"
                className="bg-slate-950 border-border text-foreground min-h-[88px]"
              />
            </div>

            {shutdownPreview && (
              <div className="rounded-lg border border-border bg-slate-900/40 p-4 space-y-3">
                <p className="text-sm text-muted-foreground">
                  Preview for <span className="text-foreground font-medium">{shutdownPreview.reasonName}</span> from{' '}
                  <span className="text-foreground font-medium">{shutdownPreview.startDate}</span> to{' '}
                  <span className="text-foreground font-medium">{shutdownPreview.endDate}</span> (
                  {formatRequestedDaysSummary(shutdownPreview)})
                </p>
                <div className="grid grid-cols-2 md:grid-cols-7 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground">All employees</p>
                    <p className="text-foreground font-medium">{shutdownPreview.totalEmployees}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Targeted</p>
                    <p className="text-foreground font-medium">{shutdownPreview.targetedEmployees}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Will create</p>
                    <p className="text-foreground font-medium">{shutdownPreview.wouldCreate}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Fully skipped</p>
                    <p className="text-foreground font-medium">{shutdownPreview.duplicateCount}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Partially applied</p>
                    <p className="text-foreground font-medium">{shutdownPreview.partialConflictEmployeeCount}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Conflict days skipped</p>
                    <p className="text-foreground font-medium">{shutdownPreview.conflictingWorkingDaysSkipped}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Over allowance</p>
                    <p className={`font-medium ${shutdownPreview.warningCount > 0 ? 'text-amber-300' : 'text-green-400'}`}>
                      {shutdownPreview.warningCount}
                    </p>
                  </div>
                </div>

                <div className="max-h-56 overflow-y-auto pr-1 space-y-3">
                  {shutdownPreview.conflicts.length > 0 && (
                    <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 space-y-2">
                      <p className="text-sm text-red-200">
                        Conflicts found: {shutdownPreview.duplicateCount} employee
                        {shutdownPreview.duplicateCount === 1 ? '' : 's'} fully skipped, {shutdownPreview.partialConflictEmployeeCount}{' '}
                        partially applied, and {shutdownPreview.conflictingWorkingDaysSkipped} conflicting working day
                        {shutdownPreview.conflictingWorkingDaysSkipped === 1 ? '' : 's'} skipped across {shutdownPreview.conflicts.length}{' '}
                        overlapping existing booking{shutdownPreview.conflicts.length === 1 ? '' : 's'}.
                      </p>
                      <div className="space-y-1">
                        {shutdownPreview.conflicts.map((conflict, index) => (
                          <p key={`${conflict.profileId}-${conflict.conflictStartDate}-${index}`} className="text-xs text-red-100">
                            {conflict.fullName}
                            {conflict.employeeId ? ` (${conflict.employeeId})` : ''} -{' '}
                            {(conflict.reasonName || 'Existing absence')} ({conflict.status}) from {conflict.conflictStartDate} to{' '}
                            {conflict.conflictEndDate}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}

                  {shutdownPreview.warningCount > 0 && (
                    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
                      <p className="text-sm text-amber-200">
                        These employees would go over allowance. You can still continue, but consider creating Unpaid Leave for these people instead.
                      </p>
                      <div className="space-y-1">
                        {shutdownPreview.warnings.map((warning) => (
                          <p key={warning.profileId} className="text-xs text-amber-100">
                            {warning.fullName}
                            {warning.employeeId ? ` (${warning.employeeId})` : ''} - allowance {warning.allowance}, already booked{' '}
                            {warning.alreadyBooked}, requested {warning.requestedDays}, projected remaining {warning.projectedRemaining}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowShutdownDialog(false)} className="border-border text-muted-foreground">
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setShowBulkUndoDialog(true);
                void loadBulkAbsenceBatches();
              }}
              className="border-border text-muted-foreground"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Undo Bulk Absence
            </Button>
            <Button
              variant="outline"
              onClick={() => requestShutdownPreview(false)}
              disabled={shutdownLoading || !shutdownStartDate || !shutdownReasonId}
              className="border-border text-muted-foreground"
            >
              {shutdownLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Preview Impact
            </Button>
            <Button
              onClick={() => requestShutdownPreview(true)}
              disabled={shutdownLoading || !shutdownStartDate || !shutdownReasonId || !shutdownPreview}
              className="bg-absence hover:bg-absence-dark text-white"
            >
              {shutdownLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Confirm & Create Bulk Bookings
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showBulkUndoDialog} onOpenChange={setShowBulkUndoDialog}>
        <DialogContent className="border-border max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-foreground">Undo Bulk Absence</DialogTitle>
            <DialogDescription className="text-slate-400/90">
              Select a previous bulk booking batch to remove all absences created by that run.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border border-[hsl(var(--absence-primary)/0.25)] bg-[hsl(var(--absence-primary)/0.06)] p-4 space-y-4">
            <div>
              <Label htmlFor="overview-bulk-undo-batch" className="text-foreground font-medium">Batch</Label>
              <Select value={bulkBatchUndoId} onValueChange={setBulkBatchUndoId}>
                <SelectTrigger id="overview-bulk-undo-batch" className="bg-slate-950 border-border text-foreground">
                  <SelectValue placeholder={bulkUndoLoading ? 'Loading batches...' : 'Select bulk booking batch'} />
                </SelectTrigger>
                <SelectContent className="bg-slate-950 border-border text-foreground">
                  {bulkBatches.map((batch) => (
                    <SelectItem key={batch.id} value={batch.id}>
                      {batch.reasonName} | {batch.startDate} to {batch.endDate} | {batch.createdCount} created
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {bulkBatchUndoId && (
              <div className="rounded-md border border-border bg-slate-800/30 p-3 text-sm">
                {(() => {
                  const batch = bulkBatches.find((item) => item.id === bulkBatchUndoId);
                  if (!batch) return <p className="text-muted-foreground">Selected batch details unavailable.</p>;
                  return (
                    <div className="space-y-1">
                      <p className="text-foreground font-medium">{batch.reasonName}</p>
                      <p className="text-muted-foreground">
                        {batch.startDate} to {batch.endDate}
                      </p>
                      <p className="text-muted-foreground">
                        Created {batch.createdCount}, skipped {batch.duplicateCount}, targeted {batch.targetedEmployees}
                      </p>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBulkUndoDialog(false)} className="border-border text-muted-foreground">
              Cancel
            </Button>
            <Button
              onClick={handleUndoBulkAbsenceBatch}
              disabled={bulkUndoLoading || !bulkBatchUndoId || !bulkBatches.some((batch) => batch.id === bulkBatchUndoId)}
              className="bg-absence hover:bg-absence-dark text-white"
            >
              {bulkUndoLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
              {bulkUndoLoading ? 'Undoing...' : 'Undo Selected Batch'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showGenerateDialog}
        onOpenChange={(open) => {
          setShowGenerateDialog(open);
          if (!open) {
            setDeleteExistingBookings(false);
          }
        }}
      >
        <DialogContent className="border-border max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-foreground">Prepare Next Financial Year</DialogTitle>
            <DialogDescription className="text-slate-400/90">
              Manage yearly setup for <span className="font-medium text-foreground">{generationStatus?.nextFinancialYearLabel || 'the next financial year'}</span>.
              You can either generate bank holidays for all staff, or remove the latest generated year setup from the same dialog.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-[hsl(var(--absence-primary)/0.25)] bg-[hsl(var(--absence-primary)/0.06)] p-4 space-y-4">
            <div className="rounded-md border border-border bg-slate-950/60 p-3 text-sm text-slate-300 space-y-1">
              <p className="font-medium text-foreground">What Set up does</p>
              <p>Creates auto-generated bank holiday leave records for every employee in the selected next financial year.</p>
              <p>Does not remove or overwrite existing manual bookings.</p>
              <p>Does not move any carryover balance at this stage.</p>
            </div>
            <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200 space-y-2">
              <p className="font-medium">What Undo setup does</p>
              <p>Removes the latest generated year setup and deletes auto-generated bank holiday records for that year.</p>
              <label className="inline-flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={deleteExistingBookings}
                  onChange={(event) => setDeleteExistingBookings(event.target.checked)}
                  className="mt-0.5 rounded border-border"
                />
                <span>
                  Delete any existing user/admin bookings in that year as well. Annual leave balances are automatically restored because those bookings are removed.
                </span>
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowGenerateDialog(false)} className="border-border text-muted-foreground">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRemoveGeneratedYear}
              disabled={generatingAllowances || removingGeneratedYear}
            >
              {removingGeneratedYear ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
              {removingGeneratedYear ? 'Undoing...' : 'Undo Last Year Setup'}
            </Button>
            <Button
              onClick={handleGenerateAllowances}
              disabled={generatingAllowances || removingGeneratedYear}
              className="bg-absence hover:bg-absence-dark text-white"
            >
              {generatingAllowances ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
              {generatingAllowances ? 'Preparing...' : 'Set up Next Year'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showCloseYearDialog}
        onOpenChange={setShowCloseYearDialog}
      >
        <DialogContent className="border-border max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              Close {closeTargetFinancialYearLabel || 'Open Year'} Bookings
            </DialogTitle>
            <DialogDescription className="text-slate-400/90">
              This locks employee self-service bookings for the selected year and generates carryover balances into the
              following year using approved annual leave only.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 space-y-3 text-sm text-amber-100">
            <p>Managers and admins can still create or edit bookings in the closed year.</p>
            <p>If any pending bookings exist in that year, close will be blocked until they are accepted or declined.</p>
            <p>Every close action is logged with the user and timestamp.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCloseYearDialog(false)} className="border-border text-muted-foreground">
              Cancel
            </Button>
            <Button
              onClick={handleCloseCurrentYearBookings}
              disabled={closingCurrentYear || closeTargetFinancialYearStartYear === null}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {closingCurrentYear ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {closingCurrentYear ? 'Closing...' : 'Close Year & Generate Carryover'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showUndoCloseYearDialog}
        onOpenChange={setShowUndoCloseYearDialog}
      >
        <DialogContent className="border-border max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              Undo Close {generationStatus?.latestClosedFinancialYearLabel || 'Latest Closed Year'}
            </DialogTitle>
            <DialogDescription className="text-slate-400/90">
              This reopens the latest closed financial year and restores carryover balances to their exact pre-close snapshot.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-violet-500/30 bg-violet-500/10 p-4 space-y-3 text-sm text-violet-100">
            <p>Only admins can run this action.</p>
            <p>Undo is only available for the latest closed year and before that financial year has ended.</p>
            {generationStatus?.canUndoLatestClosedFinancialYear ? (
              <p>
                Ready to undo close for {generationStatus.latestUndoableClosedFinancialYearLabel || generationStatus.latestClosedFinancialYearLabel}.
              </p>
            ) : (
              <p className="text-amber-200">
                Cannot undo close: {generationStatus?.undoCloseBlockedReason || 'This close cannot be undone right now.'}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUndoCloseYearDialog(false)} className="border-border text-muted-foreground">
              Cancel
            </Button>
            <Button
              onClick={handleUndoCloseCurrentYearBookings}
              disabled={undoingClosedYear || !generationStatus?.canUndoLatestClosedFinancialYear}
              className="bg-violet-600 hover:bg-violet-700 text-white"
            >
              {undoingClosedYear ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {undoingClosedYear ? 'Undoing...' : 'Undo Close & Reopen Year'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AbsencePermissionExceptionsDialog
        open={showPermissionExceptionsDialog}
        onOpenChange={setShowPermissionExceptionsDialog}
      />
    </>
  );
}
