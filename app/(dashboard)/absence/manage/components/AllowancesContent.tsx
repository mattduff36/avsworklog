'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { ArrowUpDown, ChevronLeft, ChevronRight, Loader2, Search, Settings2, Sparkles, Trash2, Users } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useUpdateEmployeeAllowance } from '@/lib/hooks/useAbsence';
import { getCurrentFinancialYear } from '@/lib/utils/date';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

interface ProfileRow {
  id: string;
  full_name: string;
  employee_id: string | null;
  allowance: number;
  taken: number;
  upcoming: number;
  remaining: number;
  reason_totals: Record<string, number>;
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

const DEFAULT_VISIBLE_REASON_NAMES = new Set(['sickness', 'training', 'unpaid leave']);

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

function formatLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function buildFinancialYearFromStartYear(startYear: number) {
  const start = new Date(startYear, 3, 6);
  const end = new Date(startYear + 1, 3, 5);
  return {
    start,
    end,
    startIso: formatLocalDate(start),
    endIso: formatLocalDate(end),
    label: `${startYear}/${(startYear + 1).toString().slice(-2)}`,
  };
}

export function AllowancesContent() {
  const supabase = createClient();
  const currentFinancialYear = getCurrentFinancialYear();

  const [rows, setRows] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState<SortField>('full_name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [baseColumnVisibility, setBaseColumnVisibility] = useState<BaseColumnVisibility>(DEFAULT_BASE_COLUMN_VISIBILITY);
  const [reasonColumnVisibility, setReasonColumnVisibility] = useState<Record<string, boolean>>({});
  const baseColumnVisibilityRef = useRef<BaseColumnVisibility>(DEFAULT_BASE_COLUMN_VISIBILITY);
  const reasonColumnVisibilityRef = useRef<Record<string, boolean>>({});
  const [reasonColumns, setReasonColumns] = useState<ReasonColumn[]>([]);
  const [annualLeaveColor, setAnnualLeaveColor] = useState('#8b5cf6');
  const [generationStatus, setGenerationStatus] = useState<GenerationStatus | null>(null);
  const [selectedFinancialYearStartYear, setSelectedFinancialYearStartYear] = useState<number>(
    currentFinancialYear.start.getFullYear()
  );
  const [generatingAllowances, setGeneratingAllowances] = useState(false);
  const [removingGeneratedYear, setRemovingGeneratedYear] = useState(false);
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const [showRemoveDialog, setShowRemoveDialog] = useState(false);

  const updateAllowance = useUpdateEmployeeAllowance();

  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 20;

  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingProfile, setEditingProfile] = useState<ProfileRow | null>(null);
  const [newAllowance, setNewAllowance] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const selectedFinancialYear = useMemo(
    () => buildFinancialYearFromStartYear(selectedFinancialYearStartYear),
    [selectedFinancialYearStartYear]
  );

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
      const parsed = JSON.parse(stored) as {
        base?: Partial<BaseColumnVisibility>;
        reasons?: Record<string, boolean>;
      };
      if (parsed.base) {
        const nextBaseVisibility = { ...DEFAULT_BASE_COLUMN_VISIBILITY, ...parsed.base };
        baseColumnVisibilityRef.current = nextBaseVisibility;
        setBaseColumnVisibility(nextBaseVisibility);
      }
      if (parsed.reasons) {
        reasonColumnVisibilityRef.current = parsed.reasons;
        setReasonColumnVisibility(parsed.reasons);
      }
    } catch {
      // Ignore parse errors
    }
  }, []);

  function persistColumnVisibility(nextBase: BaseColumnVisibility, nextReasons: Record<string, boolean>) {
    localStorage.setItem(
      COLUMN_VISIBILITY_STORAGE_KEY,
      JSON.stringify({ base: nextBase, reasons: nextReasons })
    );
  }

  useEffect(() => {
    baseColumnVisibilityRef.current = baseColumnVisibility;
  }, [baseColumnVisibility]);

  useEffect(() => {
    reasonColumnVisibilityRef.current = reasonColumnVisibility;
  }, [reasonColumnVisibility]);

  useEffect(() => {
    void loadRows();
    void loadGenerationStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFinancialYearStartYear]);

  async function loadRows() {
    setLoading(true);
    try {
      const fyStart = selectedFinancialYear.startIso;
      const fyEnd = selectedFinancialYear.endIso;

      const [{ data: profiles, error: profilesError }, { data: reasons, error: reasonsError }] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, employee_id, annual_holiday_allowance_days')
          .order('full_name'),
        supabase
          .from('absence_reasons')
          .select('id, name, is_active, color')
          .order('name'),
      ]);

      if (profilesError) throw profilesError;
      if (reasonsError) throw reasonsError;

      type ReasonRow = { id: string; name: string; is_active: boolean; color: string | null };
      const typedReasons = (reasons || []) as ReasonRow[];

      const annualReason = typedReasons.find((reason) => reason.name.trim().toLowerCase() === 'annual leave');
      if (!annualReason) throw new Error('Annual leave reason not found');
      setAnnualLeaveColor(annualReason.color || '#8b5cf6');

      const visibleReasonColumns = typedReasons
        .filter((reason) => reason.is_active && reason.id !== annualReason.id)
        .map((reason) => ({ id: reason.id, name: reason.name, color: reason.color || '#6366f1' }));
      setReasonColumns(visibleReasonColumns);

      const mergedReasonVisibility = { ...reasonColumnVisibilityRef.current };
      for (const reason of visibleReasonColumns) {
        if (mergedReasonVisibility[reason.id] === undefined) {
          mergedReasonVisibility[reason.id] = DEFAULT_VISIBLE_REASON_NAMES.has(reason.name.trim().toLowerCase());
        }
      }
      reasonColumnVisibilityRef.current = mergedReasonVisibility;
      setReasonColumnVisibility(mergedReasonVisibility);
      persistColumnVisibility(baseColumnVisibilityRef.current, mergedReasonVisibility);

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
        if (absence.status === 'approved') {
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

      type ProfileData = { id: string; full_name: string; employee_id: string | null; annual_holiday_allowance_days: number | null };
      const computedRows: ProfileRow[] = ((profiles || []) as ProfileData[]).map((profile) => {
        const totals = summaryByProfile.get(profile.id) || {
          annualTaken: 0,
          annualUpcoming: 0,
          annualPending: 0,
          byReason: {},
        };
        const allowance = profile.annual_holiday_allowance_days ?? 28;
        const totalApproved = totals.annualTaken + totals.annualUpcoming;
        return {
          id: profile.id,
          full_name: profile.full_name,
          employee_id: profile.employee_id,
          allowance,
          taken: totals.annualTaken,
          upcoming: totals.annualUpcoming,
          remaining: allowance - totalApproved - totals.annualPending,
          reason_totals: totals.byReason,
        };
      });

      setRows(computedRows);
    } catch (error) {
      console.error('Error fetching allowance rows:', error);
      toast.error('Failed to load employee allowances');
    } finally {
      setLoading(false);
    }
  }

  const featuredReasonColumns = useMemo(
    () => reasonColumns.filter((r) => DEFAULT_VISIBLE_REASON_NAMES.has(r.name.trim().toLowerCase())),
    [reasonColumns]
  );

  const otherReasonColumns = useMemo(
    () => reasonColumns.filter((r) => !DEFAULT_VISIBLE_REASON_NAMES.has(r.name.trim().toLowerCase())),
    [reasonColumns]
  );

  const filteredRows = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const base = rows.filter((row) => {
      if (!term) return true;
      return row.full_name.toLowerCase().includes(term) || row.employee_id?.toLowerCase().includes(term);
    });

    const direction = sortDirection === 'asc' ? 1 : -1;
    return [...base].sort((a, b) => {
      if (sortField === 'full_name') return direction * a.full_name.localeCompare(b.full_name);
      return direction * (a[sortField] - b[sortField]);
    });
  }, [rows, searchTerm, sortDirection, sortField]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const paginatedRows = useMemo(
    () => filteredRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filteredRows, currentPage]
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, sortField, sortDirection]);

  function toggleBaseColumn(column: keyof BaseColumnVisibility) {
    setBaseColumnVisibility((prev) => {
      const next = { ...prev, [column]: !prev[column] };
      baseColumnVisibilityRef.current = next;
      persistColumnVisibility(next, reasonColumnVisibilityRef.current);
      return next;
    });
  }

  function toggleReasonColumn(reasonId: string) {
    setReasonColumnVisibility((prev) => {
      const next = { ...prev, [reasonId]: !prev[reasonId] };
      reasonColumnVisibilityRef.current = next;
      persistColumnVisibility(baseColumnVisibilityRef.current, next);
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
    try {
      const response = await fetch('/api/absence/generation/status', { method: 'GET' });
      const payload = (await response.json()) as Partial<GenerationStatus> & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load generation status');
      }
      const currentStartYear = currentFinancialYear.start.getFullYear();
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
      });
      setSelectedFinancialYearStartYear((prev) => {
        if (prev < currentStartYear || prev > latestStartYear) {
          return latestStartYear;
        }
        return prev;
      });
    } catch (error) {
      console.error('Error loading generation status:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to load generation status');
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
        error?: string;
      };
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Failed to remove generated year');
      }
      toast.success(
        `Removed generated year ${payload.removedFinancialYearLabel}. ${payload.removedGeneratedAbsences ?? 0} auto-generated bank holiday entries were deleted.`
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

  function openEdit(profile: ProfileRow) {
    setEditingProfile(profile);
    setNewAllowance(String(profile.allowance));
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
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <p className="text-muted-foreground">Loading...</p>
        </CardContent>
      </Card>
    );
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
            {generationStatus && (
              <p className="text-xs text-muted-foreground mt-1">
                Current booking horizon: {generationStatus.latestGeneratedFinancialYearLabel}. Next available generation:{' '}
                {generationStatus.nextFinancialYearLabel}.
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button onClick={() => setShowRemoveDialog(true)} variant="outline" className="border-border text-muted-foreground">
                    <Trash2 className="h-4 w-4 mr-2" />
                    Undo Last Year Setup
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Remove auto-generated bank holidays for the most recently prepared year</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={() => setShowGenerateDialog(true)}
                    className="bg-absence hover:bg-absence-dark text-white transition-all duration-200 active:scale-95 shadow-md hover:shadow-lg"
                  >
                    <Sparkles className="h-4 w-4 mr-2" />
                    Prepare Next Year
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Create bank holiday entries and open the next financial year for booking</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
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
            <Select
              value={String(selectedFinancialYearStartYear)}
              onValueChange={(value) => setSelectedFinancialYearStartYear(Number(value))}
            >
              <SelectTrigger className="w-full md:w-[190px] border-slate-600">
                <SelectValue placeholder="Financial Year" />
              </SelectTrigger>
              <SelectContent>
                {yearOptions.map((startYear) => {
                  const year = buildFinancialYearFromStartYear(startYear);
                  return (
                    <SelectItem key={startYear} value={String(startYear)}>
                      {year.label}
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
                  Allowance
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
                {featuredReasonColumns.map((reason) => (
                  <DropdownMenuCheckboxItem
                    key={reason.id}
                    checked={Boolean(reasonColumnVisibility[reason.id])}
                    onCheckedChange={() => toggleReasonColumn(reason.id)}
                  >
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: reason.color }} />
                      {reason.name}
                    </span>
                  </DropdownMenuCheckboxItem>
                ))}
                {otherReasonColumns.length > 0 && <DropdownMenuSeparator />}
                {otherReasonColumns.map((reason) => (
                  <DropdownMenuCheckboxItem
                    key={reason.id}
                    checked={Boolean(reasonColumnVisibility[reason.id])}
                    onCheckedChange={() => toggleReasonColumn(reason.id)}
                  >
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: reason.color }} />
                      {reason.name}
                    </span>
                  </DropdownMenuCheckboxItem>
                ))}
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
              <p className="text-muted-foreground">Try adjusting your search</p>
            </div>
          ) : (
            <>
              <div className="hidden md:block border border-slate-700 rounded-lg overflow-hidden">
                <Table className="min-w-full">
                  <TableHeader>
                    <TableRow className="border-border">
                      <TableHead className="bg-slate-900 text-muted-foreground cursor-pointer" onClick={() => handleSort('full_name')}>
                        <div className="flex items-center gap-2">Employee <ArrowUpDown className="h-3 w-3" /></div>
                      </TableHead>
                      {baseColumnVisibility.allowance && (
                        <TableHead className="bg-slate-900 text-muted-foreground cursor-pointer" onClick={() => handleSort('allowance')}>
                          <div className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full flex-shrink-0 ring-1 ring-white/10" style={{ backgroundColor: annualLeaveColor }} />
                            Allowance <ArrowUpDown className="h-3 w-3" />
                          </div>
                        </TableHead>
                      )}
                      {baseColumnVisibility.taken && (
                        <TableHead className="bg-slate-900 text-muted-foreground cursor-pointer" onClick={() => handleSort('taken')}>
                          <div className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full flex-shrink-0 ring-1 ring-white/10" style={{ backgroundColor: annualLeaveColor }} />
                            Taken <ArrowUpDown className="h-3 w-3" />
                          </div>
                        </TableHead>
                      )}
                      {baseColumnVisibility.upcoming && (
                        <TableHead className="bg-slate-900 text-muted-foreground cursor-pointer" onClick={() => handleSort('upcoming')}>
                          <div className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full flex-shrink-0 ring-1 ring-white/10" style={{ backgroundColor: annualLeaveColor }} />
                            Upcoming <ArrowUpDown className="h-3 w-3" />
                          </div>
                        </TableHead>
                      )}
                      {baseColumnVisibility.remaining && (
                        <TableHead className="bg-slate-900 text-muted-foreground cursor-pointer" onClick={() => handleSort('remaining')}>
                          <div className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full flex-shrink-0 ring-1 ring-white/10" style={{ backgroundColor: annualLeaveColor }} />
                            Remaining <ArrowUpDown className="h-3 w-3" />
                          </div>
                        </TableHead>
                      )}
                      {reasonColumns
                        .filter((reason) => reasonColumnVisibility[reason.id])
                        .map((reason) => (
                          <TableHead key={reason.id} className="bg-slate-900 text-muted-foreground">
                            <div className="flex items-center gap-2">
                              <span className="h-2.5 w-2.5 rounded-full flex-shrink-0 ring-1 ring-white/10" style={{ backgroundColor: reason.color }} />
                              {reason.name}
                            </div>
                          </TableHead>
                        ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedRows.map((profile) => (
                      <TableRow
                        key={profile.id}
                        className="border-slate-700 hover:bg-slate-800/30 cursor-pointer"
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
                          <TableCell className="text-white" style={{ borderLeft: `3px solid ${annualLeaveColor}22` }}>
                            <FmtDays value={profile.allowance} />
                          </TableCell>
                        )}
                        {baseColumnVisibility.taken && (
                          <TableCell className="text-white" style={{ borderLeft: `3px solid ${annualLeaveColor}22` }}>
                            <FmtDays value={profile.taken} />
                          </TableCell>
                        )}
                        {baseColumnVisibility.upcoming && (
                          <TableCell className="text-white" style={{ borderLeft: `3px solid ${annualLeaveColor}22` }}>
                            <FmtDays value={profile.upcoming} />
                          </TableCell>
                        )}
                        {baseColumnVisibility.remaining && (
                          <TableCell style={{ borderLeft: `3px solid ${annualLeaveColor}22` }}>
                            <span className="font-medium" style={{ color: remainingColor(profile.remaining) }}><FmtDays value={profile.remaining} /></span>
                          </TableCell>
                        )}
                        {reasonColumns
                          .filter((reason) => reasonColumnVisibility[reason.id])
                          .map((reason) => {
                            const days = profile.reason_totals[reason.id] || 0;
                            return (
                              <TableCell key={reason.id} className="text-white" style={{ borderLeft: `3px solid ${reason.color}22` }}>
                                <FmtDays value={days} />
                              </TableCell>
                            );
                          })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="md:hidden space-y-3">
                {paginatedRows.map((profile) => (
                  <Card key={profile.id} className="bg-slate-800 border-slate-700 cursor-pointer" onClick={() => openEdit(profile)}>
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold text-white">{profile.full_name}</h3>
                        {profile.employee_id && (
                          <Badge variant="outline" className="border-slate-600 text-muted-foreground">
                            {profile.employee_id}
                          </Badge>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <p className="text-muted-foreground">Allowance</p>
                          <p className="text-white"><FmtDays value={profile.allowance} /></p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Taken</p>
                          <p className="text-white"><FmtDays value={profile.taken} /></p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Upcoming</p>
                          <p className="text-white"><FmtDays value={profile.upcoming} /></p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Remaining</p>
                          <p className="font-medium" style={{ color: remainingColor(profile.remaining) }}><FmtDays value={profile.remaining} /></p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
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

      <Dialog open={showGenerateDialog} onOpenChange={setShowGenerateDialog}>
        <DialogContent className="border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">Prepare Next Financial Year</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              This will create bank holiday leave entries for every employee in{' '}
              <span className="font-medium text-foreground">{generationStatus?.nextFinancialYearLabel || 'the next financial year'}</span>{' '}
              and make that year available for booking. Please confirm before proceeding.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowGenerateDialog(false)} className="border-border text-muted-foreground">
              Cancel
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
        <DialogContent className="border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">Undo Last Year Setup</DialogTitle>
            <DialogDescription className="text-muted-foreground">
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
        <DialogContent className="border-border">
          <DialogHeader>
            <DialogTitle className="text-white">Edit Allowance</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Update annual leave allowance for {editingProfile?.full_name}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="allowance">Annual Leave Allowance (days) *</Label>
              <Input
                id="allowance"
                type="number"
                step="0.5"
                min="0"
                value={newAllowance}
                onChange={(e) => setNewAllowance(e.target.value)}
                placeholder="28"
                className="border-border bg-background text-foreground"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Standard UK allowance is 28 days (including bank holidays)
              </p>
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
            <Button onClick={handleUpdate} disabled={submitting} className="bg-absence hover:bg-absence-dark text-white">
              {submitting ? 'Updating...' : 'Update'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
