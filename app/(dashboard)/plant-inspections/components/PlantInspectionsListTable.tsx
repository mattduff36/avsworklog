'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpDown, Clipboard, Clock, Download, Pencil, Trash2 } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatInspectionMeter } from '@/lib/inspections/meter-correction';
import { formatDate } from '@/lib/utils/date';
import { formatFleetAssetLabel } from '@/lib/utils/fleet-asset-label';

export interface PlantInspectionsColumnVisibility {
  employeeId: boolean;
  category: boolean;
  status: boolean;
}

export const PLANT_INSPECTIONS_COLUMN_VISIBILITY_STORAGE_KEY = 'plant-inspections-table-column-visibility';

export const DEFAULT_PLANT_INSPECTIONS_COLUMN_VISIBILITY: PlantInspectionsColumnVisibility = {
  employeeId: false,
  category: true,
  status: true,
};

interface PlantInspectionRow {
  current_mileage: number | null;
  id: string;
  user_id: string;
  status: 'draft' | 'submitted';
  has_reported_defect?: boolean;
  has_inform_workshop_task?: boolean;
  inspection_date: string;
  inspection_end_date: string | null;
  submitted_at: string | null;
  is_hired_plant: boolean;
  hired_plant_id_serial?: string | null;
  hired_plant_description?: string | null;
  hired_plant_hiring_company?: string | null;
  job_code?: string | null;
  job_site_address?: string | null;
  plant: {
    plant_id: string;
    nickname: string | null;
    serial_number: string | null;
    van_categories: { name: string } | null;
  } | null;
  profile?: {
    full_name?: string;
    employee_id?: string | null;
  } | null;
}

interface PlantInspectionsListTableProps {
  inspections: PlantInspectionRow[];
  columnVisibility: PlantInspectionsColumnVisibility;
  canCorrectReadings: boolean;
  onEditReading: (id: string) => void;
  downloadingId: string | null;
  deleting: boolean;
  getInspectionHref: (inspection: PlantInspectionRow) => string;
  canDeleteInspection: (inspection: PlantInspectionRow) => boolean;
  onDownloadPDF: (event: React.MouseEvent, inspectionId: string) => void;
  onOpenDeleteDialog: (event: React.MouseEvent, inspection: PlantInspectionRow) => void;
}

type SortField = 'employee' | 'plant' | 'date' | 'status';
type SortDirection = 'asc' | 'desc';

function getStatusBadge(status: string) {
  const variants = {
    draft: { variant: 'secondary' as const, label: 'Draft' },
    submitted: { variant: 'default' as const, label: 'Submitted' },
  };
  const config = variants[status as keyof typeof variants] || variants.draft;
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

function getStatusIcon(inspection: PlantInspectionRow) {
  const iconColorClass = inspection.has_inform_workshop_task
    ? 'text-plant-inspection'
    : inspection.has_reported_defect
      ? 'text-red-500'
      : 'text-green-500';

  if (inspection.status === 'submitted') {
    return <Clock className={`h-4 w-4 ${iconColorClass}`} />;
  }

  return <Clipboard className={`h-4 w-4 ${iconColorClass}`} />;
}

function getPlantLabel(inspection: PlantInspectionRow) {
  if (inspection.is_hired_plant) return `Hired - ${inspection.hired_plant_id_serial || 'Unknown'}`;
  return formatFleetAssetLabel({
    identifier: inspection.plant?.plant_id || 'Unknown Plant',
    nickname: inspection.plant?.nickname,
  });
}

function formatInspectionRange(startDate: string, endDate: string | null) {
  if (endDate && endDate !== startDate) {
    return `${formatDate(startDate)} - ${formatDate(endDate)}`;
  }
  return formatDate(startDate);
}

export function PlantInspectionsListTable({
  inspections,
  columnVisibility,
  canCorrectReadings,
  onEditReading,
  downloadingId,
  deleting,
  getInspectionHref,
  canDeleteInspection,
  onDownloadPDF,
  onOpenDeleteDialog,
}: PlantInspectionsListTableProps) {
  const router = useRouter();
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const sortedRows = useMemo(() => {
    return [...inspections].sort((a, b) => {
      const factor = sortDirection === 'asc' ? 1 : -1;
      switch (sortField) {
        case 'employee':
          return factor * ((a.profile?.full_name || '').localeCompare(b.profile?.full_name || ''));
        case 'plant':
          return factor * getPlantLabel(a).localeCompare(getPlantLabel(b));
        case 'date':
          return factor * (new Date(a.inspection_date).getTime() - new Date(b.inspection_date).getTime());
        case 'status':
          return factor * a.status.localeCompare(b.status);
        default:
          return 0;
      }
    });
  }, [inspections, sortField, sortDirection]);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortField(field);
    setSortDirection('asc');
  }

  return (
    <div className="border border-slate-700 rounded-lg overflow-hidden">
      <Table className="min-w-full">
        <TableHeader>
          <TableRow className="border-border">
            <TableHead
              className="bg-slate-900 text-muted-foreground cursor-pointer hover:bg-slate-800 border-b-2 border-border"
              onClick={() => handleSort('employee')}
            >
              <div className="flex items-center gap-2">
                Employee
                <ArrowUpDown className="h-3 w-3" />
              </div>
            </TableHead>
            <TableHead
              className="bg-slate-900 text-muted-foreground cursor-pointer hover:bg-slate-800 border-b-2 border-border"
              onClick={() => handleSort('plant')}
            >
              <div className="flex items-center gap-2">
                Plant
                <ArrowUpDown className="h-3 w-3" />
              </div>
            </TableHead>
            <TableHead className="bg-slate-900 text-muted-foreground border-b-2 border-border">
              Job
            </TableHead>
            <TableHead
              className="bg-slate-900 text-muted-foreground cursor-pointer hover:bg-slate-800 border-b-2 border-border"
              onClick={() => handleSort('date')}
            >
              <div className="flex items-center gap-2">
                Date
                <ArrowUpDown className="h-3 w-3" />
              </div>
            </TableHead>
            <TableHead className="bg-slate-900 text-muted-foreground border-b-2 border-border text-right">Hours</TableHead>
            {columnVisibility.status && (
              <TableHead
                className="bg-slate-900 text-muted-foreground cursor-pointer hover:bg-slate-800 border-b-2 border-border"
                onClick={() => handleSort('status')}
              >
                <div className="flex items-center gap-2">
                  Status
                  <ArrowUpDown className="h-3 w-3" />
                </div>
              </TableHead>
            )}
            <TableHead className="bg-slate-900 text-muted-foreground border-b-2 border-border text-right">
              Actions
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedRows.map((inspection) => (
            <TableRow
              key={inspection.id}
              className="border-slate-700 hover:bg-slate-800/50 cursor-pointer"
              onClick={() => router.push(getInspectionHref(inspection))}
            >
              <TableCell className="font-medium text-white">
                {inspection.profile?.full_name || 'Unknown User'}
                {columnVisibility.employeeId && (
                  <div className="text-xs font-normal text-muted-foreground">
                    {inspection.profile?.employee_id || '-'}
                  </div>
                )}
              </TableCell>
              <TableCell className="text-white">
                {getPlantLabel(inspection)}
                {columnVisibility.category && (
                  <div className="text-xs text-muted-foreground">
                    {inspection.is_hired_plant
                      ? [inspection.hired_plant_hiring_company, inspection.hired_plant_description]
                        .filter(Boolean).join(' - ') || '-'
                      : inspection.plant?.van_categories?.name || '-'}
                  </div>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {inspection.job_code || 'Unclassified'}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatInspectionRange(inspection.inspection_date, inspection.inspection_end_date)}
              </TableCell>
              <TableCell className="text-muted-foreground text-right tabular-nums whitespace-nowrap">
                {formatInspectionMeter(inspection.current_mileage, 'plant')}
              </TableCell>
              {columnVisibility.status && (
                <TableCell>
                  <div className="flex items-center gap-2">
                    {getStatusIcon(inspection)}
                    {getStatusBadge(inspection.status)}
                  </div>
                </TableCell>
              )}
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-2" onClick={(event) => event.stopPropagation()}>
                  {canCorrectReadings && inspection.status === 'submitted' && (
                    <Button variant="outline" size="sm" aria-label={`Edit Daily Check on ${inspection.inspection_date}`}
                      className="gap-1 px-2 [@media(pointer:coarse)]:min-h-11 [[data-tablet-mode=on]_&]:min-h-11 [&_svg]:size-3.5"
                      onClick={() => onEditReading(inspection.id)}>
                      <Pencil aria-hidden="true" />Edit
                    </Button>
                  )}
                  {inspection.status === 'submitted' && (
                    <Button
                      onClick={(event) => onDownloadPDF(event, inspection.id)}
                      disabled={downloadingId === inspection.id}
                      variant="outline"
                      size="sm"
                      className="border-plant-inspection text-plant-inspection hover:bg-plant-inspection hover:text-white"
                    >
                      <Download className="h-4 w-4 mr-1.5" />
                      {downloadingId === inspection.id ? 'Downloading...' : 'PDF'}
                    </Button>
                  )}
                  {canDeleteInspection(inspection) && (
                    <Button
                      onClick={(event) => onOpenDeleteDialog(event, inspection)}
                      disabled={deleting}
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                      title="Delete inspection"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
