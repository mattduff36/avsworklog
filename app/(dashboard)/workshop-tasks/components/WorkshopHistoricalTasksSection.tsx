import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { PanelLoader } from '@/components/ui/panel-loader';
import {
  Archive,
  ArrowUpDown,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Paperclip,
  Search,
  Undo2,
  Wrench,
} from 'lucide-react';
import { formatDate } from '@/lib/utils/date';
import { useTabletMode } from '@/components/layout/tablet-mode-context';
import { WorkshopTaskLocationButton } from '@/components/workshop-tasks/WorkshopTaskLocationButton';
import { isServiceWorkshopTask } from '@/lib/workshop-tasks/is-service-task';
import type { InspectionPhoto } from '@/types/inspection';
import type { Action } from '../types';

type HistoricalSortField =
  | 'completedAt'
  | 'asset'
  | 'source'
  | 'category'
  | 'summary';

type HistoricalSortDirection = 'asc' | 'desc';

type HistoricalTaskRow = {
  id: string;
  task: Action;
  asset: string;
  source: string;
  category: string;
  subcategory: string;
  summary: string;
  createdAt: string | null;
  completedAt: string | null;
  searchText: string;
};

export type HistoricalTaskVariant = 'completed' | 'archived';

const VARIANT_THEME = {
  completed: {
    title: 'Completed Tasks',
    Icon: CheckCircle2,
    shell: 'border-green-500/30 bg-green-500/5',
    header: 'bg-green-500/10 hover:bg-green-500/20 border-green-500/30',
    icon: 'text-green-400',
    date: 'text-green-400',
    sortActive: 'text-green-400',
    empty: 'No completed tasks match the current filters.',
    emptyMobile: 'No completed tasks yet.',
    searchId: 'completed-search',
    fromId: 'completed-date-from',
    toId: 'completed-date-to',
  },
  archived: {
    title: 'Archived Tasks',
    Icon: Archive,
    shell: 'border-slate-500/30 bg-slate-500/5',
    header: 'bg-slate-500/10 hover:bg-slate-500/20 border-slate-500/30',
    icon: 'text-slate-400',
    date: 'text-slate-400',
    sortActive: 'text-slate-400',
    empty: 'No archived tasks match the current filters.',
    emptyMobile: 'No archived tasks yet.',
    searchId: 'archived-search',
    fromId: 'archived-date-from',
    toId: 'archived-date-to',
  },
} as const;

function normalizeFilterValue(value: string) {
  return value.trim().toLowerCase();
}

function SortableHeader({
  label,
  field,
  currentField,
  direction,
  onSort,
  activeClassName,
  className,
}: {
  label: string;
  field: HistoricalSortField;
  currentField: HistoricalSortField;
  direction: HistoricalSortDirection;
  onSort: (field: HistoricalSortField) => void;
  activeClassName: string;
  className?: string;
}) {
  const isActive = currentField === field;
  const isDesc = isActive && direction === 'desc';

  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      className={`flex items-center gap-1 text-left transition-colors hover:text-foreground ${className ?? ''}`}
    >
      <span>{label}</span>
      <ArrowUpDown
        className={`h-3 w-3 transition-transform ${
          isActive ? activeClassName : 'text-muted-foreground/50'
        } ${isDesc ? 'rotate-180' : ''}`}
      />
    </button>
  );
}

interface WorkshopHistoricalTasksSectionProps {
  variant: HistoricalTaskVariant;
  tasks: Action[];
  displayCount: number;
  show: boolean;
  onShowChange: (show: boolean) => void;
  loading?: boolean;
  viewOnly?: boolean;
  taskAttachmentCounts: Map<string, number>;
  taskInspectionPhotos: Record<string, InspectionPhoto[]>;
  getVehicleReg: (task: Action) => string;
  getSourceLabel: (task: Action) => string;
  onOpenTaskModal: (task: Action) => void;
  onOpenComments: (task: Action) => void;
  onOpenWhereabouts: (task: Action) => void;
  onUndoComplete: (taskId: string) => void;
  canCorrectService?: boolean;
  onCorrectService?: (task: Action) => void;
  onEditTask: (task: Action) => void;
}

export function WorkshopHistoricalTasksSection({
  variant,
  tasks,
  displayCount,
  show,
  onShowChange,
  loading = false,
  viewOnly = false,
  taskAttachmentCounts,
  taskInspectionPhotos,
  getVehicleReg,
  getSourceLabel,
  onOpenTaskModal,
  onOpenComments,
  onOpenWhereabouts,
  onUndoComplete,
  canCorrectService = false,
  onCorrectService,
  onEditTask: _onEditTask,
}: WorkshopHistoricalTasksSectionProps) {
  const theme = VARIANT_THEME[variant];
  const { tabletModeEnabled } = useTabletMode();
  const taskActionButtonClass = tabletModeEnabled ? 'min-h-11 px-4 text-base' : 'h-9 px-3 text-xs';
  const taskActionGroupClass = tabletModeEnabled
    ? 'flex flex-wrap items-center gap-1.5 w-full lg:w-auto'
    : 'flex flex-wrap items-center gap-1.5 w-full md:w-auto';
  const cardIconActionClass = tabletModeEnabled
    ? 'h-11 w-11 p-0 text-muted-foreground hover:text-muted-foreground hover:bg-slate-800'
    : 'h-7 w-7 p-0 text-muted-foreground hover:text-muted-foreground hover:bg-slate-800';

  const [loadState, setLoadState] = useState({ key: '', count: 20 });
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [assetFilter, setAssetFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [summaryFilter, setSummaryFilter] = useState('');
  const [sortField, setSortField] = useState<HistoricalSortField>('completedAt');
  const [sortDirection, setSortDirection] = useState<HistoricalSortDirection>('desc');

  const filterKey = `${assetFilter}|${categoryFilter}|${dateFrom}|${dateTo}|${search}|${sortDirection}|${sortField}|${sourceFilter}|${summaryFilter}`;
  const visibleCount = loadState.key === filterKey ? loadState.count : 20;

  const rows = useMemo<HistoricalTaskRow[]>(
    () =>
      tasks.map((task) => {
        const category =
          task.workshop_task_subcategories?.workshop_task_categories?.name ||
          task.workshop_task_categories?.name ||
          '';
        const subcategory = task.workshop_task_subcategories?.name || '';
        const summary = (task.description || task.workshop_comments || task.title || '').trim();
        const asset = getVehicleReg(task);
        const source = getSourceLabel(task);

        return {
          id: task.id,
          task,
          asset,
          source,
          category,
          subcategory,
          summary,
          createdAt: task.created_at,
          completedAt: task.actioned_at,
          searchText: [asset, source, category, subcategory, task.title, task.description, task.workshop_comments]
            .filter(Boolean)
            .join(' ')
            .toLowerCase(),
        };
      }),
    [getSourceLabel, getVehicleReg, tasks]
  );

  const sourceOptions = useMemo(
    () => Array.from(new Set(rows.map((row) => row.source).filter(Boolean))).sort(),
    [rows]
  );
  const categoryOptions = useMemo(
    () => Array.from(new Set(rows.map((row) => row.category).filter(Boolean))).sort(),
    [rows]
  );

  const filteredRows = useMemo(() => {
    const searchValue = normalizeFilterValue(search);
    const assetFilterValue = normalizeFilterValue(assetFilter);
    const summaryFilterValue = normalizeFilterValue(summaryFilter);
    const fromDate = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
    const toDate = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null;

    return rows.filter((row) => {
      if (searchValue && !row.searchText.includes(searchValue)) {
        return false;
      }
      if (assetFilterValue && !row.asset.toLowerCase().includes(assetFilterValue)) {
        return false;
      }
      if (sourceFilter !== 'all' && row.source !== sourceFilter) {
        return false;
      }
      if (categoryFilter !== 'all' && row.category !== categoryFilter) {
        return false;
      }
      if (summaryFilterValue && !row.summary.toLowerCase().includes(summaryFilterValue)) {
        return false;
      }

      const completedTime = row.completedAt ? new Date(row.completedAt).getTime() : null;
      if (fromDate !== null && (completedTime === null || completedTime < fromDate)) {
        return false;
      }
      if (toDate !== null && (completedTime === null || completedTime > toDate)) {
        return false;
      }

      return true;
    });
  }, [assetFilter, categoryFilter, dateFrom, dateTo, rows, search, sourceFilter, summaryFilter]);

  const sortedRows = useMemo(() => {
    const nextRows = [...filteredRows];
    nextRows.sort((a, b) => {
      const compareMultiplier = sortDirection === 'asc' ? 1 : -1;
      if (sortField === 'completedAt') {
        const aTime = a.completedAt ? new Date(a.completedAt).getTime() : 0;
        const bTime = b.completedAt ? new Date(b.completedAt).getTime() : 0;
        return (aTime - bTime) * compareMultiplier;
      }
      const aValue = (a[sortField] || '').toString().toLowerCase();
      const bValue = (b[sortField] || '').toString().toLowerCase();
      return aValue.localeCompare(bValue) * compareMultiplier;
    });
    return nextRows;
  }, [filteredRows, sortDirection, sortField]);

  const visibleRows = useMemo(
    () => sortedRows.slice(0, visibleCount),
    [sortedRows, visibleCount]
  );
  const mobileVisibleRows = useMemo(
    () => tasks.slice(0, visibleCount),
    [tasks, visibleCount]
  );
  const hasMoreRows = sortedRows.length > visibleRows.length;
  const hasMoreRowsMobile = tasks.length > mobileVisibleRows.length;

  const handleSort = (field: HistoricalSortField) => {
    if (sortField === field) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortField(field);
    setSortDirection(field === 'completedAt' ? 'desc' : 'asc');
  };

  const resetFilters = () => {
    setSearch('');
    setDateFrom('');
    setDateTo('');
    setAssetFilter('');
    setSourceFilter('all');
    setCategoryFilter('all');
    setSummaryFilter('');
    setSortField('completedAt');
    setSortDirection('desc');
  };

  const showMore = () => {
    setLoadState((prev) => ({
      key: filterKey,
      count: (prev.key === filterKey ? prev.count : 20) + 10,
    }));
  };

  const getTaskPhotos = (taskId: string) => taskInspectionPhotos[taskId] ?? [];

  const renderInspectionPhotoBadge = (task: Action) => {
    const count = getTaskPhotos(task.id).length;
    if (task.action_type !== 'inspection_defect' || count === 0) {
      return null;
    }

    return (
      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-300 border-emerald-500/30 text-xs">
        <Camera className="h-3 w-3 mr-1" />
        {count}
      </Badge>
    );
  };

  const getSourceBadgeClass = (task: Action) => {
    if (task.action_type !== 'inspection_defect') {
      return 'bg-transparent text-workshop border-workshop';
    }
    if (task.hgv_id) {
      return 'bg-transparent text-hgv-inspection border-hgv-inspection';
    }
    if (task.plant_id) {
      return 'bg-transparent text-plant-inspection border-plant-inspection';
    }
    return 'bg-transparent text-inspection border-inspection';
  };

  const renderSourceBadge = (task: Action, label = getSourceLabel(task)) => (
    <Badge variant="outline" className={`text-xs font-semibold shadow-sm ${getSourceBadgeClass(task)}`}>
      {label}
    </Badge>
  );

  const renderInspectionDescription = (task: Action) => (
    task.action_type === 'inspection_defect' && task.description ? (
      <p className="mb-2 whitespace-pre-line text-sm text-muted-foreground">{task.description}</p>
    ) : null
  );

  const renderUtilityActions = (task: Action) => (
    <div className="flex items-center gap-1">
      <Button
        onClick={(e) => {
          e.stopPropagation();
          onOpenComments(task);
        }}
        size="sm"
        variant="ghost"
        className={cardIconActionClass}
        title="Comments"
        aria-label="Comments"
      >
        <MessageSquare className="h-3.5 w-3.5" />
      </Button>
      <WorkshopTaskLocationButton
        task={task}
        onOpen={() => onOpenWhereabouts(task)}
        iconOnly
        variant="ghost"
        className={cardIconActionClass}
      />
    </div>
  );

  const renderMutationActions = (task: Action, layout: 'table' | 'card') => {
    if (viewOnly) {
      return null;
    }

    const buttonClass = layout === 'table'
      ? 'h-7 w-7 border-amber-600/50 p-0 text-amber-300 hover:bg-amber-900/30 hover:text-amber-100'
      : `${taskActionButtonClass} border-amber-600/50 text-amber-300 hover:text-amber-100 hover:bg-amber-900/30`;
    const undoClass = layout === 'table'
      ? 'h-7 w-7 border-slate-600 p-0 text-muted-foreground hover:bg-slate-800 hover:text-white'
      : `${taskActionButtonClass} border-slate-600 text-muted-foreground hover:text-white hover:bg-slate-800`;

    return (
      <>
        {canCorrectService && onCorrectService ? (
          <Button
            onClick={(e) => {
              e.stopPropagation();
              onCorrectService(task);
            }}
            size="sm"
            variant="outline"
            className={buttonClass}
            title="Correct Task"
            aria-label="Correct Task"
          >
            <Wrench className="h-3.5 w-3.5" />
            {layout === 'card' ? <span className="ml-1.5">Correct Task</span> : null}
          </Button>
        ) : null}
        {isServiceWorkshopTask(task) ? null : (
          <Button
            onClick={(e) => {
              e.stopPropagation();
              onUndoComplete(task.id);
            }}
            size="sm"
            variant="outline"
            className={undoClass}
            title="Undo"
            aria-label="Undo"
          >
            <Undo2 className="h-3.5 w-3.5" />
            {layout === 'card' ? <span className="ml-1.5">Undo</span> : null}
          </Button>
        )}
      </>
    );
  };

  if (displayCount <= 0) {
    return null;
  }

  const HeaderIcon = theme.Icon;

  return (
    <div className={`border-2 ${theme.shell} rounded-lg overflow-hidden`}>
      <button
        type="button"
        onClick={() => onShowChange(!show)}
        className={`w-full flex items-center justify-between p-4 ${theme.header} transition-colors border-b-2`}
      >
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <HeaderIcon className={`h-5 w-5 ${theme.icon}`} />
          {theme.title} ({displayCount})
        </h2>
        {show ? (
          <ChevronUp className={`h-5 w-5 ${theme.icon}`} />
        ) : (
          <ChevronDown className={`h-5 w-5 ${theme.icon}`} />
        )}
      </button>
      {show && (
        <div className="space-y-4 p-4">
          {loading ? (
            <PanelLoader message={`Loading ${variant} tasks...`} accent="workshop" className="min-h-[200px]" />
          ) : (
            <>
              <div className="hidden md:flex items-end justify-between gap-4 rounded-lg border border-border bg-slate-900/40 p-4">
                <div className="grid flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(260px,1.6fr)_repeat(2,minmax(140px,1fr))]">
                  <div className="space-y-2">
                    <Label htmlFor={theme.searchId}>Search</Label>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id={theme.searchId}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search asset, summary, category..."
                        className="pl-9"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={theme.fromId}>Completed From</Label>
                    <Input
                      id={theme.fromId}
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={theme.toId}>Completed To</Label>
                    <Input
                      id={theme.toId}
                      type="date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <p className="text-sm text-muted-foreground">
                    Showing {visibleRows.length} of {sortedRows.length}
                  </p>
                  <Button type="button" variant="outline" onClick={resetFilters}>
                    Reset
                  </Button>
                </div>
              </div>

              <div className="hidden overflow-x-auto rounded-lg border border-border bg-white dark:bg-slate-900 md:block">
                <TooltipProvider>
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <TableHead className="w-[11rem]">
                          <SortableHeader
                            label="Completed"
                            field="completedAt"
                            currentField={sortField}
                            direction={sortDirection}
                            onSort={handleSort}
                            activeClassName={theme.sortActive}
                          />
                        </TableHead>
                        <TableHead className="w-[14rem]">
                          <SortableHeader
                            label="Asset"
                            field="asset"
                            currentField={sortField}
                            direction={sortDirection}
                            onSort={handleSort}
                            activeClassName={theme.sortActive}
                          />
                        </TableHead>
                        <TableHead className="w-[10rem]">
                          <SortableHeader
                            label="Source"
                            field="source"
                            currentField={sortField}
                            direction={sortDirection}
                            onSort={handleSort}
                            activeClassName={theme.sortActive}
                          />
                        </TableHead>
                        <TableHead className="w-[10rem]">
                          <SortableHeader
                            label="Category"
                            field="category"
                            currentField={sortField}
                            direction={sortDirection}
                            onSort={handleSort}
                            activeClassName={theme.sortActive}
                          />
                        </TableHead>
                        <TableHead>
                          <SortableHeader
                            label="Summary"
                            field="summary"
                            currentField={sortField}
                            direction={sortDirection}
                            onSort={handleSort}
                            activeClassName={theme.sortActive}
                          />
                        </TableHead>
                        <TableHead className="w-[7rem] pr-3 text-right">Actions</TableHead>
                      </TableRow>
                      <TableRow className="bg-slate-50/60 dark:bg-slate-900/60 hover:bg-slate-50/60 dark:hover:bg-slate-900/60">
                        <TableHead className="w-[7rem]" />
                        <TableHead>
                          <Input
                            value={assetFilter}
                            onChange={(e) => setAssetFilter(e.target.value)}
                            placeholder="Filter asset"
                            className="h-8"
                          />
                        </TableHead>
                        <TableHead>
                          <Select value={sourceFilter} onValueChange={setSourceFilter}>
                            <SelectTrigger className="h-8">
                              <SelectValue placeholder="All sources" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All</SelectItem>
                              {sourceOptions.map((option) => (
                                <SelectItem key={option} value={option}>
                                  {option}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableHead>
                        <TableHead>
                          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                            <SelectTrigger className="h-8">
                              <SelectValue placeholder="All categories" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All</SelectItem>
                              {categoryOptions.map((option) => (
                                <SelectItem key={option} value={option}>
                                  {option}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableHead>
                        <TableHead>
                          <Input
                            value={summaryFilter}
                            onChange={(e) => setSummaryFilter(e.target.value)}
                            placeholder="Filter summary"
                            className="h-8"
                          />
                        </TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleRows.length > 0 ? (
                        visibleRows.map((row) => (
                          <TableRow
                            key={row.id}
                            className="cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/30"
                            onClick={() => onOpenTaskModal(row.task)}
                          >
                            <TableCell className={`text-sm ${theme.date}`}>
                              {row.completedAt ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="inline-flex cursor-help underline decoration-dotted underline-offset-4">
                                      {formatDate(row.completedAt)}
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>Created: {row.createdAt ? formatDate(row.createdAt) : '-'}</p>
                                  </TooltipContent>
                                </Tooltip>
                              ) : (
                                '-'
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-foreground">{row.asset}</span>
                                {taskAttachmentCounts.get(row.task.id) && taskAttachmentCounts.get(row.task.id)! > 0 && (
                                  <Badge variant="outline" className="bg-blue-500/10 text-blue-300 border-blue-500/30 text-xs">
                                    <Paperclip className="h-3 w-3 mr-1" />
                                    {taskAttachmentCounts.get(row.task.id)}
                                  </Badge>
                                )}
                                {renderInspectionPhotoBadge(row.task)}
                              </div>
                            </TableCell>
                            <TableCell>
                              {renderSourceBadge(row.task, row.source)}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {row.subcategory ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="inline-flex cursor-help underline decoration-dotted underline-offset-4">
                                      {row.category || '-'}
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>Subcategory: {row.subcategory}</p>
                                  </TooltipContent>
                                </Tooltip>
                              ) : (
                                row.category || '-'
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="space-y-1">
                                <p className="text-sm font-medium text-foreground">{row.task.title}</p>
                                {row.summary && (
                                  <p className="line-clamp-2 whitespace-pre-line text-sm text-muted-foreground">{row.summary}</p>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="w-[7rem] px-2 text-right" onClick={(e) => e.stopPropagation()}>
                              <div className="ml-auto flex w-fit justify-end gap-1">
                                <WorkshopTaskLocationButton
                                  task={row.task}
                                  onOpen={() => onOpenWhereabouts(row.task)}
                                  iconOnly
                                  className="h-7 w-7 border-slate-600 p-0 text-muted-foreground hover:bg-slate-800 hover:text-white"
                                />
                                <Button
                                  onClick={() => onOpenComments(row.task)}
                                  size="sm"
                                  variant="outline"
                                  className="h-7 w-7 border-slate-600 p-0 text-muted-foreground hover:bg-slate-800 hover:text-white"
                                  title="Comments"
                                  aria-label="Comments"
                                >
                                  <MessageSquare className="h-3.5 w-3.5" />
                                </Button>
                                {renderMutationActions(row.task, 'table')}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                            {theme.empty}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TooltipProvider>
              </div>

              <div className="space-y-3 md:hidden">
                {mobileVisibleRows.map((task) => {
                  const row = rows.find((candidate) => candidate.id === task.id);
                  const assetLabel = row?.asset || getVehicleReg(task);
                  const sourceLabel = row?.source || getSourceLabel(task);
                  return (
                    <Card
                      key={task.id}
                      className="bg-white dark:bg-slate-900 border-border opacity-70 hover:opacity-90 transition-opacity cursor-pointer"
                      onClick={() => onOpenTaskModal(task)}
                    >
                      <CardContent className="pt-6">
                        <div className="flex flex-col items-start gap-4">
                          <div className="flex-1 space-y-2 w-full">
                            <div className="flex flex-col lg:flex-row items-start justify-between gap-4">
                              <div className="flex-1 w-full">
                                <div className="flex items-center gap-2 mb-2">
                                  <HeaderIcon className={`h-5 w-5 ${theme.icon}`} />
                                  <h3 className="font-semibold text-lg text-foreground">{assetLabel}</h3>
                                  {renderSourceBadge(task, sourceLabel)}
                                  {taskAttachmentCounts.get(task.id) && taskAttachmentCounts.get(task.id)! > 0 && (
                                    <Badge variant="outline" className="bg-blue-500/10 text-blue-300 border-blue-500/30 text-xs">
                                      <Paperclip className="h-3 w-3 mr-1" />
                                      {taskAttachmentCounts.get(task.id)}
                                    </Badge>
                                  )}
                                  {renderInspectionPhotoBadge(task)}
                                </div>
                                <div className="flex flex-wrap gap-2 mb-1">
                                  {task.workshop_task_subcategories?.workshop_task_categories && (
                                    <Badge variant="outline" className="bg-blue-500/10 text-blue-300 border-blue-500/30">
                                      {task.workshop_task_subcategories.workshop_task_categories.name}
                                    </Badge>
                                  )}
                                  {task.workshop_task_subcategories && (
                                    <Badge variant="outline" className="bg-orange-500/10 text-orange-300 border-orange-500/30">
                                      {task.workshop_task_subcategories.name}
                                    </Badge>
                                  )}
                                  {!task.workshop_task_subcategories && task.workshop_task_categories && (
                                    <Badge variant="outline" className="bg-blue-500/10 text-blue-300 border-blue-500/30">
                                      {task.workshop_task_categories.name}
                                    </Badge>
                                  )}
                                </div>
                                {renderInspectionDescription(task)}
                                <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                                  {task.actioned_at && (
                                    <span className={theme.date}>
                                      Completed: {formatDate(task.actioned_at)}
                                    </span>
                                  )}
                                </div>
                              </div>
                              {!viewOnly && (
                                <div className={taskActionGroupClass}>
                                  {renderMutationActions(task, 'card')}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center justify-end w-full">
                              {renderUtilityActions(task)}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
                {mobileVisibleRows.length === 0 && (
                  <div className="rounded-lg border border-border bg-slate-900/40 p-6 text-center text-sm text-muted-foreground">
                    {theme.emptyMobile}
                  </div>
                )}
              </div>

              {hasMoreRows && (
                <div className="hidden items-center justify-center pt-2 md:flex">
                  <Button type="button" variant="outline" onClick={showMore}>
                    Show More
                  </Button>
                </div>
              )}

              {hasMoreRowsMobile && (
                <div className="flex items-center justify-center pt-2 md:hidden">
                  <Button type="button" variant="outline" onClick={showMore}>
                    Show More
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
