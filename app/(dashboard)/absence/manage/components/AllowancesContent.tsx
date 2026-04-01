'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageLoader } from '@/components/ui/page-loader';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { fetchUserDirectory } from '@/lib/client/user-directory';
import { TeamToggleMenu } from '@/components/ui/team-toggle-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, ArrowUpDown, ChevronLeft, ChevronRight, Loader2, Search, Settings2, Sparkles, Trash2, Users } from 'lucide-react';
import { useUpdateEmployeeAllowance } from '@/lib/hooks/useAbsence';
import { useAbsenceRealtime } from '@/lib/hooks/useRealtime';
import { fetchCarryoverMapForFinancialYear, getEffectiveAllowance } from '@/lib/utils/absence-carryover';
import { getCurrentFinancialYear } from '@/lib/utils/date';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

interface ProfileRow {
  id: string;
  full_name: string;
  employee_id: string | null;
  team_id: string | null;
  team_name: string | null;
  baseAllowance: number;
  carryoverDays: number;
  totalAllowance: number;
  taken: number;
  upcoming: number;
  pending: number;
  remaining: number;
  reason_totals: Record<string, number>;
}

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

interface ReasonColumn {
  id: string;
  name: string;
  color: string;
}

interface GenerationStatus {
  currentFinancialYearStartYear: number;
  latestGeneratedFinancialYearStartYear: number;
  latestGeneratedFinancialYearLabel: string;
  latestGeneratedFinancialYearEndDate: string;
  nextFinancialYearStartYear: number;
  nextFinancialYearLabel: string;
  closedFinancialYearStartYears: number[];
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
  reasonId: string;
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
  batchId: string | null;
}

function formatRequestedDaysSummary(preview: ShutdownPreviewResult): string {
  if (preview.requestedDaysMin === preview.requestedDaysMax) {
    return `${preview.requestedDaysMax} working day${preview.requestedDaysMax === 1 ? '' : 's'}`;
  }

  return `${preview.requestedDaysMin}-${preview.requestedDaysMax} working days depending on work pattern`;
}

interface BulkAbsenceBatchSummary {
  id: string;
  reasonId: string;
  reasonName: string;
  startDate: string;
  endDate: string;
  notes: string | null;
  applyToAll: boolean;
  roleNames: string[];
  explicitProfileIds: string[];
  targetedEmployees: number;
  createdCount: number;
  duplicateCount: number;
  createdAt: string;
  createdByName: string | null;
}

type SortField = 'full_name' | 'allowance' | 'taken' | 'upcoming' | 'remaining';
type SortDirection = 'asc' | 'desc';

type BaseColumnVisibility = {
  allowance: boolean;
  taken: boolean;
  upcoming: boolean;
  remaining: boolean;
};

const COLUMN_VISIBILITY_STORAGE_KEY = 'absence-allowances-column-visibility-v3';
const DEFAULT_BASE_COLUMN_VISIBILITY: BaseColumnVisibility = {
  allowance: true,
  taken: true,
  upcoming: true,
  remaining: true,
};

function FmtDays({ value }: { value: number }) {
  const absValue = Math.abs(value);
  const hasHalf = absValue % 1 !== 0;
  const whole = Math.trunc(absValue);
  const sign = value < 0 ? '-' : '';
  if (!hasHalf) return <>{Math.trunc(value)}</>;
  return (
    <>
      {sign}
      {whole > 0 && `${whole} `}
      <span className="text-[0.75em] opacity-50">.5</span>
    </>
  );
}

function remainingColor(days: number): string {
  if (days <= 4.5) return '#f87171';
  if (days <= 9.5) return '#fbbf24';
  return '#4ade80';
}

function RemainingAllowanceValue({ value }: { value: number }) {
  return (
    <span className="font-medium" style={{ color: remainingColor(value) }}>
      <FmtDays value={value} />
    </span>
  );
}

function remainingTint(value: number): string | undefined {
  if (value >= 0) return undefined;
  return `${remainingColor(value)}1f`;
}

function formatLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDaysForField(value: number): string {
  return Number.isInteger(value) ? String(Math.trunc(value)) : String(value);
}

function buildFinancialYearFromStartYear(startYear: number) {
  const start = new Date(startYear, 3, 1);
  const end = new Date(startYear + 1, 2, 31);
  return {
    start,
    end,
    startIso: formatLocalDate(start),
    endIso: formatLocalDate(end),
    label: `${startYear}/${(startYear + 1).toString().slice(-2)}`,
  };
}

function getOldestOpenFinancialYearStartYear(
  currentFinancialYearStartYear: number,
  latestGeneratedFinancialYearStartYear: number,
  closedFinancialYearStartYears: number[]
): number {
  const closedYears = new Set(closedFinancialYearStartYears);
  for (let year = currentFinancialYearStartYear; year <= latestGeneratedFinancialYearStartYear; year += 1) {
    if (!closedYears.has(year)) {
      return year;
    }
  }
  return latestGeneratedFinancialYearStartYear;
}

interface AllowancesContentProps {
  refreshKey?: number;
  isReadOnly?: boolean;
  scopeTeamOnly?: boolean;
  actorTeamId?: string | null;
}

export function AllowancesContent({
  refreshKey,
  isReadOnly = false,
  scopeTeamOnly = false,
  actorTeamId = null,
}: AllowancesContentProps) {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const currentFinancialYear = getCurrentFinancialYear();

  const [rows, setRows] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTeamId, setSelectedTeamId] = useState<string>('all');
  const [sortField, setSortField] = useState<SortField>('full_name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [baseColumnVisibility, setBaseColumnVisibility] = useState<BaseColumnVisibility>(DEFAULT_BASE_COLUMN_VISIBILITY);
  const baseColumnVisibilityRef = useRef<BaseColumnVisibility>(DEFAULT_BASE_COLUMN_VISIBILITY);
  const [reasonColumns, setReasonColumns] = useState<ReasonColumn[]>([]);
  const [generationStatus, setGenerationStatus] = useState<GenerationStatus | null>(null);
  const [selectedFinancialYearStartYear, setSelectedFinancialYearStartYear] = useState<number | null>(null);
  const [financialYearResolved, setFinancialYearResolved] = useState(false);
  const [generatingAllowances, setGeneratingAllowances] = useState(false);
  const [removingGeneratedYear, setRemovingGeneratedYear] = useState(false);
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const [showRemoveDialog, setShowRemoveDialog] = useState(false);
  const [showShutdownDialog, setShowShutdownDialog] = useState(false);
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
  const [showBulkUndoDialog, setShowBulkUndoDialog] = useState(false);
  const [bulkUndoLoading, setBulkUndoLoading] = useState(false);
  const [bulkBatchUndoId, setBulkBatchUndoId] = useState('');
  const [bulkBatches, setBulkBatches] = useState<BulkAbsenceBatchSummary[]>([]);

  const updateAllowance = useUpdateEmployeeAllowance();

  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 20;

  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingProfile, setEditingProfile] = useState<ProfileRow | null>(null);
  const [newAllowance, setNewAllowance] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const fallbackFinancialYearStartYear = currentFinancialYear.start.getFullYear();

  const selectedFinancialYear = useMemo(
    () => buildFinancialYearFromStartYear(selectedFinancialYearStartYear ?? fallbackFinancialYearStartYear),
    [selectedFinancialYearStartYear, fallbackFinancialYearStartYear]
  );
  const activeTab = searchParams.get('tab') || 'overview';
  const closedFinancialYearStartYears = useMemo(
    () => new Set(generationStatus?.closedFinancialYearStartYears || []),
    [generationStatus?.closedFinancialYearStartYears]
  );
  const isSelectedFinancialYearClosed =
    selectedFinancialYearStartYear !== null && closedFinancialYearStartYears.has(selectedFinancialYearStartYear);
  const isSelectedYearReadOnly = isSelectedFinancialYearClosed || isReadOnly;
  const selectedYearCarryoverTargetLabel = useMemo(
    () => buildFinancialYearFromStartYear((selectedFinancialYearStartYear ?? fallbackFinancialYearStartYear) + 1).label,
    [selectedFinancialYearStartYear, fallbackFinancialYearStartYear]
  );
  const carryoverSourceFinancialYearLabel = useMemo(
    () => buildFinancialYearFromStartYear((selectedFinancialYearStartYear ?? fallbackFinancialYearStartYear) - 1).label,
    [selectedFinancialYearStartYear, fallbackFinancialYearStartYear]
  );
  const totalAllowancePreview = useMemo(() => {
    if (!editingProfile) return 0;
    const parsedBaseAllowance = Number(newAllowance);
    const baseAllowance = Number.isFinite(parsedBaseAllowance) ? parsedBaseAllowance : editingProfile.baseAllowance;
    return baseAllowance + editingProfile.carryoverDays;
  }, [editingProfile, newAllowance]);
  const modalReasonStats = useMemo(() => {
    if (!editingProfile) return [] as Array<{ id: string; name: string; color: string; days: number }>;
    return reasonColumns.map((reason) => ({
      id: reason.id,
      name: reason.name,
      color: reason.color,
      days: editingProfile.reason_totals[reason.id] || 0,
    }));
  }, [editingProfile, reasonColumns]);

  const yearOptions = useMemo(() => {
    const currentStartYear = currentFinancialYear.start.getFullYear();
    const latestStartYear = generationStatus?.latestGeneratedFinancialYearStartYear ?? currentStartYear;
    const years: number[] = [];
    for (let year = currentStartYear; year <= latestStartYear; year += 1) {
      years.push(year);
    }
    return years.reverse();
  }, [currentFinancialYear, generationStatus]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(COLUMN_VISIBILITY_STORAGE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored) as { base?: Partial<BaseColumnVisibility> };
      if (parsed.base) {
        const nextBaseVisibility = { ...DEFAULT_BASE_COLUMN_VISIBILITY, ...parsed.base };
        baseColumnVisibilityRef.current = nextBaseVisibility;
        setBaseColumnVisibility(nextBaseVisibility);
      }
    } catch {
      // Ignore parse errors
    }
  }, []);

  function persistColumnVisibility(nextBase: BaseColumnVisibility) {
    localStorage.setItem(
      COLUMN_VISIBILITY_STORAGE_KEY,
      JSON.stringify({ base: nextBase })
    );
  }

  useEffect(() => {
    baseColumnVisibilityRef.current = baseColumnVisibility;
  }, [baseColumnVisibility]);

  useEffect(() => {
    void loadGenerationStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeTab !== 'allowances') {
      return;
    }
    if (!generationStatus) return;

    const oldestOpenYear = getOldestOpenFinancialYearStartYear(
      generationStatus.currentFinancialYearStartYear,
      generationStatus.latestGeneratedFinancialYearStartYear,
      generationStatus.closedFinancialYearStartYears
    );
    setSelectedFinancialYearStartYear(oldestOpenYear);
    setFinancialYearResolved(true);
  }, [activeTab, generationStatus]);

  useEffect(() => {
    if (activeTab !== 'allowances') return;
    if (!financialYearResolved) return;
    if (selectedFinancialYearStartYear === null) return;
    void loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, financialYearResolved, selectedFinancialYearStartYear]);

  useEffect(() => {
    if (activeTab === 'allowances' && financialYearResolved && selectedFinancialYearStartYear !== null && refreshKey !== undefined && refreshKey > 0) {
      void loadRows();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, activeTab, financialYearResolved, selectedFinancialYearStartYear]);

  async function loadRows() {
    setLoading(true);
    try {
      const fyStart = selectedFinancialYear.startIso;
      const fyEnd = selectedFinancialYear.endIso;

      const [profiles, { data: reasons, error: reasonsError }] = await Promise.all([
        fetchUserDirectory({ includeRole: true, includeAllowance: true }),
        supabase
          .from('absence_reasons')
          .select('id, name, is_active, color')
          .order('name'),
      ]);

      if (reasonsError) throw reasonsError;

      type ReasonRow = { id: string; name: string; is_active: boolean; color: string | null };
      const typedReasons = (reasons || []) as ReasonRow[];

      const annualReason = typedReasons.find((reason) => reason.name.trim().toLowerCase() === 'annual leave');
      if (!annualReason) throw new Error('Annual leave reason not found');
      const visibleReasonColumns = typedReasons
        .filter((reason) => reason.is_active && reason.id !== annualReason.id)
        .map((reason) => ({ id: reason.id, name: reason.name, color: reason.color || '#6366f1' }));
      setReasonColumns(visibleReasonColumns);
      const activeReasons = typedReasons.filter((reason) => reason.is_active).map((reason) => ({ id: reason.id, name: reason.name }));
      setBulkReasonOptions(activeReasons);
      if (!shutdownReasonId) {
        setShutdownReasonId(annualReason.id || activeReasons[0]?.id || '');
      }

      const { data: absences, error: absencesError } = await supabase
        .from('absences')
        .select('profile_id, reason_id, status, duration_days, date')
        .gte('date', fyStart)
        .lte('date', fyEnd);

      if (absencesError) throw absencesError;

      const todayStr = formatLocalDate(new Date());

      const summaryByProfile = new Map<
        string,
        {
          annualTaken: number;
          annualUpcoming: number;
          annualPending: number;
          byReason: Record<string, number>;
        }
      >();

      for (const absence of absences || []) {
        if (!summaryByProfile.has(absence.profile_id)) {
          summaryByProfile.set(absence.profile_id, {
            annualTaken: 0,
            annualUpcoming: 0,
            annualPending: 0,
            byReason: {},
          });
        }
        const summary = summaryByProfile.get(absence.profile_id)!;
        const duration = absence.duration_days || 0;
        if (absence.status === 'approved' || absence.status === 'processed') {
          summary.byReason[absence.reason_id] = (summary.byReason[absence.reason_id] || 0) + duration;
          if (absence.reason_id === annualReason.id) {
            if (absence.date <= todayStr) {
              summary.annualTaken += duration;
            } else {
              summary.annualUpcoming += duration;
            }
          }
        } else if (absence.status === 'pending' && absence.reason_id === annualReason.id) {
          summary.annualPending += duration;
        }
      }

      type ProfileData = {
        id: string;
        full_name: string;
        employee_id: string | null;
        annual_holiday_allowance_days: number | null;
        team?: { id?: string | null; name?: string | null } | null;
        role?: { id?: string | null; name?: string | null; display_name?: string | null } | null;
      };
      const typedProfiles = (profiles || []).map((profile) => ({
        id: profile.id,
        full_name: profile.full_name || 'Unknown User',
        employee_id: profile.employee_id,
        annual_holiday_allowance_days: profile.annual_holiday_allowance_days ?? null,
        team: profile.team || null,
        role: profile.role || null,
      })) as ProfileData[];
      if (selectedFinancialYearStartYear === null) return;
      const carryoverByProfile = await fetchCarryoverMapForFinancialYear(supabase, selectedFinancialYearStartYear);
      const computedRows: ProfileRow[] = typedProfiles.map((profile) => {
        const totals = summaryByProfile.get(profile.id) || {
          annualTaken: 0,
          annualUpcoming: 0,
          annualPending: 0,
          byReason: {},
        };
        const baseAllowance = profile.annual_holiday_allowance_days ?? 28;
        const carryoverDays = carryoverByProfile.get(profile.id) || 0;
        const totalAllowance = getEffectiveAllowance(
          profile.annual_holiday_allowance_days,
          carryoverDays
        );
        const totalApproved = totals.annualTaken + totals.annualUpcoming;
        return {
          id: profile.id,
          full_name: profile.full_name,
          employee_id: profile.employee_id,
          team_id: profile.team?.id || null,
          team_name: profile.team?.name || null,
          baseAllowance,
          carryoverDays,
          totalAllowance,
          taken: totals.annualTaken,
          upcoming: totals.annualUpcoming,
          pending: totals.annualPending,
          remaining: totalAllowance - totalApproved - totals.annualPending,
          reason_totals: totals.byReason,
        };
      });

      const employeeOptions: BulkEmployeeOption[] = typedProfiles.map((profile) => ({
        id: profile.id,
        full_name: profile.full_name,
        employee_id: profile.employee_id,
        team_id: profile.team?.id || null,
        team_name: profile.team?.name || null,
        role_id: profile.role?.id || null,
        role_name: profile.role?.name || null,
        role_display_name: profile.role?.display_name || null,
      }));
      setBulkEmployeeOptions(employeeOptions);

      const roleMap = new Map<string, string>();
      employeeOptions.forEach((employee) => {
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

      setRows(computedRows);
    } catch (error) {
      console.error('Error fetching allowance rows:', error);
      toast.error('Failed to load employee allowances');
    } finally {
      setLoading(false);
    }
  }

  const bulkTeamOptions = useMemo(() => {
    const teamMap = new Map<string, { id: string; name: string }>();

    bulkEmployeeOptions.forEach((employee) => {
      if (!employee.team_id) return;

      if (!teamMap.has(employee.team_id)) {
        teamMap.set(employee.team_id, {
          id: employee.team_id,
          name: employee.team_name || employee.team_id,
        });
      }
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

  const teamOptions = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach((row) => {
      if (!row.team_id) return;
      if (!map.has(row.team_id)) {
        map.set(row.team_id, row.team_name || row.team_id);
      }
    });
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [rows]);
  const actorTeamName =
    teamOptions.find((team) => team.id === actorTeamId)?.name || (actorTeamId ? 'My Team' : 'No team assigned');
  const effectiveTeamFilter = scopeTeamOnly ? (actorTeamId || '__no_team_scope__') : selectedTeamId;
  const isTeamFilterLocked = scopeTeamOnly;

  useEffect(() => {
    if (!scopeTeamOnly) {
      setSelectedTeamId((current) => (current === '__no_team_scope__' ? 'all' : current));
      return;
    }
    setSelectedTeamId(actorTeamId || '__no_team_scope__');
  }, [scopeTeamOnly, actorTeamId]);

  const filteredRows = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const base = rows.filter((row) => {
      if (scopeTeamOnly) {
        if (!actorTeamId) return false;
        if (row.team_id !== actorTeamId) return false;
      } else if (effectiveTeamFilter !== 'all') {
        if (effectiveTeamFilter === 'unassigned') {
          if (row.team_id) return false;
        } else if (row.team_id !== effectiveTeamFilter) {
          return false;
        }
      }
      if (!term) return true;
      return row.full_name.toLowerCase().includes(term) || row.employee_id?.toLowerCase().includes(term);
    });

    const direction = sortDirection === 'asc' ? 1 : -1;
    return [...base].sort((a, b) => {
      if (sortField === 'full_name') return direction * a.full_name.localeCompare(b.full_name);
      if (sortField === 'allowance') return direction * (a.totalAllowance - b.totalAllowance);
      if (sortField === 'taken') return direction * (a.taken - b.taken);
      if (sortField === 'upcoming') return direction * ((a.upcoming + a.pending) - (b.upcoming + b.pending));
      return direction * (a.remaining - b.remaining);
    });
  }, [rows, searchTerm, sortDirection, sortField, scopeTeamOnly, actorTeamId, effectiveTeamFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const paginatedRows = useMemo(
    () => filteredRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filteredRows, currentPage]
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, sortField, sortDirection, selectedTeamId, scopeTeamOnly, actorTeamId]);

  function toggleBaseColumn(column: keyof BaseColumnVisibility) {
    setBaseColumnVisibility((prev) => {
      const next = { ...prev, [column]: !prev[column] };
      baseColumnVisibilityRef.current = next;
      persistColumnVisibility(next);
      return next;
    });
  }

  function handleSort(field: SortField) {
    if (field === sortField) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortField(field);
    setSortDirection('asc');
  }

  async function loadGenerationStatus() {
    const currentStartYear = currentFinancialYear.start.getFullYear();
    try {
      const response = await fetch('/api/absence/generation/status', { method: 'GET' });
      const payload = (await response.json()) as Partial<GenerationStatus> & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load generation status');
      }
      const latestStartYear = payload.latestGeneratedFinancialYearStartYear ?? currentStartYear;
      setGenerationStatus({
        currentFinancialYearStartYear: payload.currentFinancialYearStartYear ?? currentStartYear,
        latestGeneratedFinancialYearStartYear: latestStartYear,
        latestGeneratedFinancialYearLabel:
          payload.latestGeneratedFinancialYearLabel || buildFinancialYearFromStartYear(latestStartYear).label,
        latestGeneratedFinancialYearEndDate:
          payload.latestGeneratedFinancialYearEndDate ||
          buildFinancialYearFromStartYear(latestStartYear).endIso,
        nextFinancialYearStartYear: payload.nextFinancialYearStartYear ?? latestStartYear + 1,
        nextFinancialYearLabel:
          payload.nextFinancialYearLabel || buildFinancialYearFromStartYear(latestStartYear + 1).label,
        closedFinancialYearStartYears: payload.closedFinancialYearStartYears || [],
      });
    } catch (error) {
      console.error('Error loading generation status:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to load generation status');
      setGenerationStatus({
        currentFinancialYearStartYear: currentStartYear,
        latestGeneratedFinancialYearStartYear: currentStartYear,
        latestGeneratedFinancialYearLabel: buildFinancialYearFromStartYear(currentStartYear).label,
        latestGeneratedFinancialYearEndDate: buildFinancialYearFromStartYear(currentStartYear).endIso,
        nextFinancialYearStartYear: currentStartYear + 1,
        nextFinancialYearLabel: buildFinancialYearFromStartYear(currentStartYear + 1).label,
        closedFinancialYearStartYears: [],
      });
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
        carryoverGenerated?: number;
        financialYearLabel?: string;
        error?: string;
      };
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Failed to generate allowances');
      }
      toast.success(
        `Allowances generated for ${payload.financialYearLabel}: ${payload.created ?? 0} bank holidays created, ${payload.skippedExisting ?? 0} already existed`
      );
      setShowGenerateDialog(false);
      await Promise.all([loadRows(), loadGenerationStatus()]);
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
      });
      const payload = (await response.json()) as {
        success?: boolean;
        removedFinancialYearLabel?: string;
        removedGeneratedAbsences?: number;
        removedCarryovers?: number;
        error?: string;
      };
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Failed to remove generated year');
      }
      toast.success(
        `Removed generated year ${payload.removedFinancialYearLabel}. ${payload.removedGeneratedAbsences ?? 0} auto-generated bank holidays and ${payload.removedCarryovers ?? 0} carryovers were deleted.`
      );
      setShowRemoveDialog(false);
      await Promise.all([loadRows(), loadGenerationStatus()]);
    } catch (error) {
      console.error('Error removing generated financial year:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to remove generated year');
    } finally {
      setRemovingGeneratedYear(false);
    }
  }

  function toggleShutdownRole(roleId: string) {
    setShutdownRoleFilters((prev) =>
      prev.includes(roleId) ? prev.filter((role) => role !== roleId) : [...prev, roleId]
    );
    setShutdownPreview(null);
  }

  function toggleShutdownEmployee(profileId: string) {
    setShutdownEmployeeFilters((prev) =>
      prev.includes(profileId) ? prev.filter((id) => id !== profileId) : [...prev, profileId]
    );
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

  useAbsenceRealtime((payload) => {
    if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE' || payload.eventType === 'DELETE') {
      void loadRows();
      if (showBulkUndoDialog) {
        void loadBulkAbsenceBatches();
      }
    }
  });

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
      await Promise.all([loadRows(), loadBulkAbsenceBatches()]);
    } catch (error) {
      console.error('Error undoing bulk absence batch:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to undo bulk absence batch');
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
    if (shutdownApplyMode === 'selection' && shutdownRoleFilters.length === 0 && shutdownEmployeeFilters.length === 0) {
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
        await Promise.all([loadRows(), loadBulkAbsenceBatches()]);
        return;
      }

      if (payload.warningCount > 0) {
        toast.warning(
          `${payload.warningCount} employee(s) would exceed allowance. Review list and consider Unpaid Leave where needed.`
        );
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

  function openEdit(profile: ProfileRow) {
    if (isSelectedYearReadOnly) return;
    setEditingProfile(profile);
    setNewAllowance(String(profile.baseAllowance));
    setShowEditDialog(true);
  }

  async function handleUpdate() {
    if (!editingProfile) return;

    const allowance = parseFloat(newAllowance);
    if (isNaN(allowance) || allowance < 0) {
      toast.error('Please enter a valid allowance');
      return;
    }

    setSubmitting(true);

    try {
      await updateAllowance.mutateAsync({
        profileId: editingProfile.id,
        allowance,
      });

      toast.success('Allowance updated');
      await loadRows();
      setEditingProfile(null);
      setNewAllowance('');
      setShowEditDialog(false);
    } catch (error) {
      console.error('Error updating allowance:', error);
      toast.error('Failed to update allowance');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <PageLoader message="Loading allowances..." />;
  }

  return (
    <div className="space-y-6">
      <Card className="border-border">
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle className="text-foreground">Employee Allowances</CardTitle>
            <CardDescription className="text-muted-foreground">
              Manage annual leave allowances for all employees ({selectedFinancialYear.label})
            </CardDescription>
            {isSelectedFinancialYearClosed ? (
              <p className="mt-2 text-xs text-amber-300">
                This financial year is now closed. The remaining values shown below are the final carryover record moved
                into {selectedYearCarryoverTargetLabel}. Negative remaining values reduced that following year&apos;s allowance.
              </p>
            ) : null}
            {isReadOnly ? (
              <p className="mt-2 text-xs text-sky-300">
                Read-only access: you can view allowances but cannot edit them.
              </p>
            ) : null}
          </div>
        </CardHeader>
      </Card>

      <Card className="border-border">
        <CardContent className="pt-6">
          <div className="flex flex-col gap-3 md:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by name or employee ID..."
                className="pl-11 bg-slate-900/50 border-slate-600 text-white"
              />
            </div>
            <Select value={effectiveTeamFilter} onValueChange={setSelectedTeamId} disabled={isTeamFilterLocked}>
              <SelectTrigger className="w-full md:w-[190px] border-slate-600">
                <SelectValue placeholder="Team" />
              </SelectTrigger>
              <SelectContent className="bg-slate-950 border-border text-foreground">
                {isTeamFilterLocked ? (
                  <SelectItem value={effectiveTeamFilter}>{actorTeamName}</SelectItem>
                ) : (
                  <>
                    <SelectItem value="all">All teams</SelectItem>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {teamOptions.map((team) => (
                      <SelectItem key={team.id} value={team.id}>
                        {team.name}
                      </SelectItem>
                    ))}
                  </>
                )}
              </SelectContent>
            </Select>
            <Select
              value={selectedFinancialYearStartYear === null ? undefined : String(selectedFinancialYearStartYear)}
              onValueChange={(value) => setSelectedFinancialYearStartYear(Number(value))}
            >
              <SelectTrigger className="w-full md:w-[190px] border-slate-600">
                <div className="flex items-center gap-2">
                  <span>{selectedFinancialYear.label}</span>
                  {isSelectedFinancialYearClosed ? (
                    <Badge variant="outline" className="border-amber-500/50 bg-amber-500/10 text-amber-300 text-[10px] uppercase">
                      Closed
                    </Badge>
                  ) : null}
                </div>
              </SelectTrigger>
              <SelectContent className="bg-slate-950 border-border text-foreground">
                {yearOptions.map((startYear) => {
                  const year = buildFinancialYearFromStartYear(startYear);
                  const isClosedYearOption = closedFinancialYearStartYears.has(startYear);
                  return (
                    <SelectItem key={startYear} value={String(startYear)}>
                      <div className="flex items-center gap-2">
                        <span>{year.label}</span>
                        {isClosedYearOption ? (
                          <Badge
                            variant="outline"
                            className="border-amber-500/50 bg-amber-500/10 text-amber-300 text-[10px] uppercase"
                          >
                            Closed
                          </Badge>
                        ) : null}
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="border-slate-600">
                  <Settings2 className="h-4 w-4 mr-2" />
                  Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64 bg-slate-900 border border-border">
                <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem checked={baseColumnVisibility.allowance} onCheckedChange={() => toggleBaseColumn('allowance')}>
                  Total Allowance
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={baseColumnVisibility.taken} onCheckedChange={() => toggleBaseColumn('taken')}>
                  Taken
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={baseColumnVisibility.upcoming} onCheckedChange={() => toggleBaseColumn('upcoming')}>
                  Upcoming
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={baseColumnVisibility.remaining} onCheckedChange={() => toggleBaseColumn('remaining')}>
                  Remaining
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Users className="h-5 w-5" />
            Employees
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {filteredRows.length} employees {searchTerm && `(filtered from ${rows.length})`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {filteredRows.length === 0 ? (
            <div className="text-center py-12">
              <Users className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-white mb-2">No employees found</h3>
              <p className="text-muted-foreground">
                {scopeTeamOnly && !actorTeamId
                  ? 'No team is assigned to your profile, so no allowances are available.'
                  : 'Try adjusting your search or team filter.'}
              </p>
            </div>
          ) : (
            <>
              <div className="relative">
                <div className={isSelectedYearReadOnly ? 'pointer-events-none select-none opacity-55' : undefined}>
                  <div className="hidden md:block border border-slate-700 rounded-lg overflow-hidden">
                    <Table className="min-w-full">
                      <TableHeader>
                        <TableRow className="border-border">
                          <TableHead className="bg-slate-900 text-muted-foreground cursor-pointer hover:bg-slate-800 border-b-2 border-border" onClick={() => handleSort('full_name')}>
                            <div className="flex items-center gap-2">Employee <ArrowUpDown className="h-3 w-3" /></div>
                          </TableHead>
                          {baseColumnVisibility.allowance && (
                            <TableHead className="bg-slate-900 text-muted-foreground cursor-pointer hover:bg-slate-800 border-b-2 border-border" onClick={() => handleSort('allowance')}>
                              <div className="flex items-center gap-2">
                                Total Allowance <ArrowUpDown className="h-3 w-3" />
                              </div>
                            </TableHead>
                          )}
                          {baseColumnVisibility.taken && (
                            <TableHead className="bg-slate-900 text-muted-foreground cursor-pointer hover:bg-slate-800 border-b-2 border-border" onClick={() => handleSort('taken')}>
                              <div className="flex items-center gap-2">
                                Taken <ArrowUpDown className="h-3 w-3" />
                              </div>
                            </TableHead>
                          )}
                          {baseColumnVisibility.upcoming && (
                            <TableHead className="bg-slate-900 text-muted-foreground cursor-pointer hover:bg-slate-800 border-b-2 border-border" onClick={() => handleSort('upcoming')}>
                              <div className="flex items-center gap-2">
                                Upcoming <ArrowUpDown className="h-3 w-3" />
                              </div>
                            </TableHead>
                          )}
                          {baseColumnVisibility.remaining && (
                            <TableHead className="bg-slate-900 text-muted-foreground cursor-pointer hover:bg-slate-800 border-b-2 border-border" onClick={() => handleSort('remaining')}>
                              <div className="flex items-center gap-2">
                                Remaining <ArrowUpDown className="h-3 w-3" />
                              </div>
                            </TableHead>
                          )}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paginatedRows.map((profile) => (
                          <TableRow
                            key={profile.id}
                            className="border-slate-700 hover:bg-slate-800/50 cursor-pointer"
                            onClick={() => openEdit(profile)}
                          >
                            <TableCell className="font-medium text-white">
                              <div className="flex items-center gap-2">
                                {profile.full_name}
                                {profile.employee_id && (
                                  <Badge variant="outline" className="border-slate-600 text-muted-foreground text-xs">
                                    {profile.employee_id}
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            {baseColumnVisibility.allowance && (
                              <TableCell className="text-white tabular-nums">
                                <FmtDays value={profile.totalAllowance} />
                              </TableCell>
                            )}
                            {baseColumnVisibility.taken && (
                              <TableCell className="text-muted-foreground tabular-nums">
                                <FmtDays value={profile.taken} />
                              </TableCell>
                            )}
                            {baseColumnVisibility.upcoming && (
                              <TableCell className="text-muted-foreground tabular-nums">
                                <span className="inline-flex items-center gap-1">
                                  <FmtDays value={profile.upcoming} />
                                  {profile.pending > 0 ? (
                                    <span className="text-amber-300">
                                      + <FmtDays value={profile.pending} />
                                    </span>
                                  ) : null}
                                </span>
                              </TableCell>
                            )}
                            {baseColumnVisibility.remaining && (
                              <TableCell
                                className="tabular-nums"
                                style={{ backgroundColor: remainingTint(profile.remaining) }}
                              >
                                <RemainingAllowanceValue value={profile.remaining} />
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="md:hidden space-y-3">
                    {paginatedRows.map((profile) => (
                      <Card key={profile.id} className="bg-slate-800 border-slate-700 cursor-pointer hover:bg-slate-800/80 transition-colors" onClick={() => openEdit(profile)}>
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <h3 className="font-semibold text-white">{profile.full_name}</h3>
                            {profile.employee_id && (
                              <Badge variant="outline" className="border-slate-600 text-muted-foreground">
                                {profile.employee_id}
                              </Badge>
                            )}
                          </div>
                          <div className="grid grid-cols-2 gap-3 text-sm tabular-nums">
                            <div>
                              <p className="text-muted-foreground text-xs">Total Allowance</p>
                              <p className="text-white font-medium"><FmtDays value={profile.totalAllowance} /></p>
                            </div>
                            <div>
                              <p className="text-muted-foreground text-xs">Taken</p>
                              <p className="text-muted-foreground"><FmtDays value={profile.taken} /></p>
                            </div>
                            <div>
                              <p className="text-muted-foreground text-xs">Upcoming</p>
                              <p className="text-muted-foreground inline-flex items-center gap-1">
                                <FmtDays value={profile.upcoming} />
                                {profile.pending > 0 ? (
                                  <span className="text-amber-300">
                                    + <FmtDays value={profile.pending} />
                                  </span>
                                ) : null}
                              </p>
                            </div>
                            <div
                              className={profile.remaining < 0 ? 'rounded-md px-2 py-1' : undefined}
                              style={{ backgroundColor: remainingTint(profile.remaining) }}
                            >
                              <p className="text-muted-foreground text-xs">Remaining</p>
                              <p className="font-medium">
                                <RemainingAllowanceValue value={profile.remaining} />
                              </p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>

                {isSelectedYearReadOnly ? (
                  <div className="pointer-events-none absolute inset-0 z-10 rounded-lg border border-amber-500/20 bg-slate-950/15" />
                ) : null}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-4">
                  <p className="text-sm text-muted-foreground">
                    Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filteredRows.length)} of {filteredRows.length}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={currentPage <= 1}
                      onClick={() => setCurrentPage((p) => p - 1)}
                      className="border-slate-600"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      Page {currentPage} of {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={currentPage >= totalPages}
                      onClick={() => setCurrentPage((p) => p + 1)}
                      className="border-slate-600"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

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
              Create approved absence bookings in bulk with filters for reason, team, role, and selected employees.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border border-[hsl(var(--absence-primary)/0.25)] bg-[hsl(var(--absence-primary)/0.06)] p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="shutdown-reason" className="text-foreground font-medium">Reason *</Label>
                <Select
                  value={shutdownReasonId}
                  onValueChange={(value) => {
                    setShutdownReasonId(value);
                    setShutdownPreview(null);
                  }}
                >
                  <SelectTrigger id="shutdown-reason" className="bg-slate-950 border-border text-foreground">
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
                <Label htmlFor="shutdown-apply-mode" className="text-foreground font-medium">Apply to *</Label>
                <Select
                  value={shutdownApplyMode}
                  onValueChange={(value: 'all' | 'selection') => {
                    setShutdownApplyMode(value);
                    setShutdownPreview(null);
                  }}
                >
                  <SelectTrigger id="shutdown-apply-mode" className="bg-slate-950 border-border text-foreground">
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
                        {shutdownRoleFilters.length > 0
                          ? `${shutdownRoleFilters.length} role(s) selected`
                          : 'Select job roles'}
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
                        {shutdownEmployeeFilters.length > 0
                          ? `${shutdownEmployeeFilters.length} employee(s) selected`
                          : 'Select employees'}
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
                <Label htmlFor="shutdown-start-date" className="text-foreground font-medium">First day off *</Label>
                <Input
                  id="shutdown-start-date"
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
                <Label htmlFor="shutdown-end-date" className="text-foreground font-medium">Last day off *</Label>
                <Input
                  id="shutdown-end-date"
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
              <Label htmlFor="shutdown-notes" className="text-foreground font-medium">Booking Notes (optional)</Label>
              <Textarea
                id="shutdown-notes"
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
                            {warning.alreadyBooked}, requested {warning.requestedDays}, projected remaining{' '}
                            {warning.projectedRemaining < 0 ? (
                              <span className="inline-flex items-center gap-1 rounded-md border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 font-medium text-red-300">
                                <AlertTriangle className="h-3 w-3" />
                                {warning.projectedRemaining}
                              </span>
                            ) : (
                              warning.projectedRemaining
                            )}
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
              <Label htmlFor="bulk-undo-batch" className="text-foreground font-medium">Batch</Label>
              <Select value={bulkBatchUndoId} onValueChange={setBulkBatchUndoId}>
                <SelectTrigger id="bulk-undo-batch" className="bg-slate-950 border-border text-foreground">
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

      <Dialog open={showGenerateDialog} onOpenChange={setShowGenerateDialog}>
        <DialogContent className="border-border max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-foreground">Prepare Next Financial Year</DialogTitle>
            <DialogDescription className="text-slate-400/90">
              This will create bank holiday leave entries for every employee in{' '}
              <span className="font-medium text-foreground">{generationStatus?.nextFinancialYearLabel || 'the next financial year'}</span>{' '}
              and make that year available for booking. Carryover balances are only generated when the current year is closed.
              Please confirm before proceeding.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowGenerateDialog(false)} className="border-border text-muted-foreground">
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowRemoveDialog(true)}
              className="border-border text-muted-foreground"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Undo Last Year Setup
            </Button>
            <Button
              onClick={handleGenerateAllowances}
              disabled={generatingAllowances}
              className="bg-absence hover:bg-absence-dark text-white"
            >
              {generatingAllowances ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
              {generatingAllowances ? 'Preparing...' : 'Confirm & Prepare'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showRemoveDialog} onOpenChange={setShowRemoveDialog}>
        <DialogContent className="border-border max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-foreground">Undo Last Year Setup</DialogTitle>
            <DialogDescription className="text-slate-400/90">
              This will remove the bank holiday entries that were automatically created for the most recently prepared year.
              It cannot be undone if employees have already booked leave in that year.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRemoveDialog(false)} className="border-border text-muted-foreground">
              Cancel
            </Button>
            <Button
              onClick={handleRemoveGeneratedYear}
              disabled={removingGeneratedYear}
              variant="destructive"
            >
              {removingGeneratedYear ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
              {removingGeneratedYear ? 'Removing...' : 'Undo Setup'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="border-border max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              {editingProfile?.full_name || 'Employee'} Absence & Leave Record
            </DialogTitle>
            <DialogDescription className="text-slate-400/90">
              Financial year {selectedFinancialYear.label}. Annual leave allowance and approved absence totals.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-[hsl(var(--absence-primary)/0.25)] bg-[hsl(var(--absence-primary)/0.06)] p-4 space-y-3">
              <h3 className="text-sm font-semibold text-foreground">Annual Leave Allowance</h3>
              <div className="space-y-1.5">
                <Label htmlFor="allowance" className="text-foreground font-medium">Annual Leave Allowance (days) *</Label>
                <Input
                  id="allowance"
                  type="number"
                  step="0.5"
                  min="0"
                  value={newAllowance}
                  onChange={(e) => setNewAllowance(e.target.value)}
                  placeholder="28"
                  disabled={isReadOnly}
                  className="bg-slate-950 border-border text-foreground"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="carryover-days" className="text-foreground font-medium">
                  Carryover from {carryoverSourceFinancialYearLabel}
                </Label>
                <Input
                  id="carryover-days"
                  type="text"
                  value={editingProfile ? formatDaysForField(editingProfile.carryoverDays) : ''}
                  readOnly
                  disabled
                  className="bg-slate-900 border-border text-muted-foreground"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="total-allowance-days" className="text-foreground font-medium">Total Allowance (days)</Label>
                <Input
                  id="total-allowance-days"
                  type="text"
                  value={editingProfile ? formatDaysForField(totalAllowancePreview) : ''}
                  readOnly
                  disabled
                  className="bg-slate-900 border-border text-muted-foreground"
                />
              </div>
            </div>

            <div className="rounded-lg border border-[hsl(var(--absence-primary)/0.25)] bg-[hsl(var(--absence-primary)/0.06)] p-4 space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Other Absence Totals</h3>
                <p className="text-xs text-muted-foreground">{selectedFinancialYear.label}</p>
              </div>
              {modalReasonStats.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active non-annual leave reasons configured.</p>
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {modalReasonStats.map((reasonStat) => (
                    <div key={reasonStat.id} className="rounded-md border border-border bg-slate-950/60 p-2.5">
                      <p className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: reasonStat.color }} />
                        {reasonStat.name}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-foreground">
                        <FmtDays value={reasonStat.days} />
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowEditDialog(false);
                setEditingProfile(null);
              }}
              className="border-border text-muted-foreground"
            >
              Cancel
            </Button>
            <Button onClick={handleUpdate} disabled={submitting || isReadOnly} className="bg-absence hover:bg-absence-dark text-white">
              {submitting ? 'Updating...' : 'Update'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
