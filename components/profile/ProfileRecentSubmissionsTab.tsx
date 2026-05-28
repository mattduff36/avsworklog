'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Clipboard, Clock, ExternalLink, FileText, PackageSearch } from 'lucide-react';
import type {
  ProfileAbsenceSummaryItem,
  ProfileAnnualLeaveSummary,
  ProfileInspectionSummaryItem,
  ProfileProjectAssignmentSummaryItem,
  ProfileTimesheetSummaryItem,
} from '@/types/profile';

interface ProfileRecentSubmissionsTabProps {
  timesheets: ProfileTimesheetSummaryItem[];
  inspections: ProfileInspectionSummaryItem[];
  absences: ProfileAbsenceSummaryItem[];
  annualLeaveSummary: ProfileAnnualLeaveSummary;
  projectAssignments: ProfileProjectAssignmentSummaryItem[];
}

const summaryItemClass = 'rounded-md border border-border bg-slate-900/30 p-2.5';
const summaryItemHoverClass = 'transition-colors hover:bg-slate-800/40';
const summaryCtaClass =
  'border-avs-yellow/50 text-avs-yellow hover:bg-avs-yellow hover:text-slate-900 hover:border-avs-yellow';

function formatDate(dateValue: string | null): string {
  if (!dateValue) return 'N/A';
  return new Date(`${dateValue.split('T')[0]}T00:00:00`).toLocaleDateString('en-GB');
}

function formatStatusLabel(status: string): string {
  return status
    .split('_')
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ');
}

function getStatusBadgeClass(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === 'approved' || normalized === 'processed' || normalized === 'signed') {
    return 'border-green-500/40 bg-green-500/15 text-green-300';
  }
  if (normalized === 'submitted' || normalized === 'pending' || normalized === 'read') {
    return 'border-amber-500/40 bg-amber-500/15 text-amber-300';
  }
  if (normalized === 'rejected' || normalized === 'cancelled') {
    return 'border-red-500/40 bg-red-500/15 text-red-300';
  }
  return 'border-slate-500/40 bg-slate-500/15 text-slate-200';
}

function getTimesheetHref(timesheet: ProfileTimesheetSummaryItem): string {
  if (timesheet.status === 'draft' || timesheet.status === 'rejected') {
    return `/timesheets/new?id=${timesheet.id}`;
  }
  return `/timesheets/${timesheet.id}`;
}

function getInspectionStatusIcon(inspection: ProfileInspectionSummaryItem) {
  const moduleColorClass =
    inspection.inspectionType === 'plant' ? 'text-plant-inspection' : 'text-inspection';
  const iconColorClass = inspection.has_inform_workshop_task
    ? moduleColorClass
    : inspection.has_reported_defect
      ? 'text-red-500'
      : 'text-green-500';

  if (inspection.status === 'submitted') {
    return <Clock className={`h-4 w-4 ${iconColorClass}`} />;
  }

  return <Clipboard className={`h-4 w-4 ${iconColorClass}`} />;
}

export function ProfileRecentSubmissionsTab({
  timesheets,
  inspections,
  absences,
  annualLeaveSummary,
  projectAssignments,
}: ProfileRecentSubmissionsTabProps) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Recent Timesheets</CardTitle>
          <CardDescription>Latest 3 submissions</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {timesheets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recent timesheets.</p>
          ) : (
            timesheets.map((timesheet) => (
              <Link
                key={timesheet.id}
                href={getTimesheetHref(timesheet)}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-center justify-between ${summaryItemClass} ${summaryItemHoverClass}`}
              >
                <p className="flex items-center gap-1.5 text-sm text-foreground">
                  <FileText className="h-4 w-4 text-timesheet" />
                  Week ending {formatDate(timesheet.week_ending)}
                </p>
                <Badge variant="outline" className={getStatusBadgeClass(timesheet.status)}>
                  {formatStatusLabel(timesheet.status)}
                </Badge>
              </Link>
            ))
          )}
          <Button type="button" variant="outline" size="sm" className={summaryCtaClass} asChild>
            <Link href="/timesheets">View all timesheets</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Daily Checks</CardTitle>
          <CardDescription>Latest van, plant, and HGV checks</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {inspections.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recent daily checks.</p>
          ) : (
            inspections.map((inspection) => (
              <Link
                key={`${inspection.inspectionType}-${inspection.id}`}
                href={inspection.href}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-center justify-between ${summaryItemClass} ${summaryItemHoverClass}`}
              >
                <div>
                  <p className="flex items-center gap-1.5 text-sm capitalize text-foreground">
                    {getInspectionStatusIcon(inspection)}
                    {inspection.inspectionType} daily check
                  </p>
                  <p className="text-xs text-muted-foreground">{formatDate(inspection.inspection_date)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={getStatusBadgeClass(inspection.status)}>
                    {formatStatusLabel(inspection.status)}
                  </Badge>
                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
              </Link>
            ))
          )}
          <div className="flex flex-wrap gap-3 text-sm">
            <Button type="button" variant="outline" size="sm" className={summaryCtaClass} asChild>
              <Link href="/van-inspections">Vans</Link>
            </Button>
            <Button type="button" variant="outline" size="sm" className={summaryCtaClass} asChild>
              <Link href="/plant-inspections">Plant</Link>
            </Button>
            <Button type="button" variant="outline" size="sm" className={summaryCtaClass} asChild>
              <Link href="/hgv-inspections">HGV</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Leave Requests & Allowances</CardTitle>
          <CardDescription>Current financial year summary</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-md border border-border p-2">
              <p className="text-xs text-muted-foreground">Allowance</p>
              <p className="text-base font-semibold">{annualLeaveSummary.allowance.toFixed(1)}</p>
            </div>
            <div className="rounded-md border border-border p-2">
              <p className="text-xs text-muted-foreground">Pending</p>
              <p className="text-base font-semibold">{annualLeaveSummary.pending_total.toFixed(1)}</p>
            </div>
            <div className="rounded-md border border-border p-2">
              <p className="text-xs text-muted-foreground">Remaining</p>
              <p className="text-base font-semibold">{annualLeaveSummary.remaining.toFixed(1)}</p>
            </div>
          </div>

          {absences.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recent leave requests.</p>
          ) : (
            absences.map((absence) => (
              <div key={absence.id} className="flex items-center justify-between rounded-md border border-border p-2.5">
                <div>
                  <p className="text-sm text-foreground">{absence.reason_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(absence.date)}
                    {absence.end_date ? ` - ${formatDate(absence.end_date)}` : ''}
                  </p>
                </div>
                <Badge variant="outline" className={getStatusBadgeClass(absence.status)}>
                  {formatStatusLabel(absence.status)}
                </Badge>
              </div>
            ))
          )}

          <Button type="button" variant="outline" size="sm" className={summaryCtaClass} asChild>
            <Link href="/absence">View absence calendar</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Assigned Projects</CardTitle>
          <CardDescription>RAMS and project documents assigned to you</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {projectAssignments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No assigned project documents.</p>
          ) : (
            projectAssignments.map((assignment) => (
              <Link
                key={assignment.id}
                href="/projects"
                className={`flex items-center justify-between ${summaryItemClass} ${summaryItemHoverClass}`}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{assignment.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {assignment.document_type_name || 'Project document'} · Assigned {formatDate(assignment.assigned_at)}
                  </p>
                </div>
                <Badge variant="outline" className={getStatusBadgeClass(assignment.status)}>
                  {formatStatusLabel(assignment.status)}
                </Badge>
              </Link>
            ))
          )}
          <Button type="button" variant="outline" size="sm" className={summaryCtaClass} asChild>
            <Link href="/projects">Open projects</Link>
          </Button>
        </CardContent>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle>Inventory</CardTitle>
          <CardDescription>Personal inventory visibility is coming soon.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 rounded-lg border border-dashed border-border bg-slate-900/20 p-4">
            <PackageSearch className="h-5 w-5 text-avs-yellow" />
            <p className="text-sm text-muted-foreground">
              You will be able to see assigned equipment, location history, and outstanding inventory actions here.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

