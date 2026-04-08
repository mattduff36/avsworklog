'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { useAllAbsences, useAllAbsenceReasons } from '@/lib/hooks/useAbsence';
import { createClient } from '@/lib/supabase/client';
import { AppPageShell } from '@/components/layout/AppPageShell';
import { BackButton } from '@/components/ui/back-button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageLoader } from '@/components/ui/page-loader';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/utils/date';
import { ChevronLeft, ChevronRight, Filter } from 'lucide-react';
import { AbsenceAboutHelper } from '@/app/(dashboard)/absence/components/AbsenceAboutHelper';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';

const PAGE_SIZE = 50;

function getFinancialYearStartYear(isoDate: string): number {
  const date = new Date(`${isoDate}T00:00:00`);
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  if (month < 3 || (month === 3 && day < 1)) {
    return year - 1;
  }
  return year;
}

function formatFinancialYearLabel(startYear: number): string {
  return `${startYear}/${(startYear + 1).toString().slice(-2)}`;
}

export default function AbsenceArchiveReportPage() {
  const { isAdmin, isManager, loading: authLoading } = useAuth();
  const { hasPermission: canAccessAbsenceModule, loading: absencePermissionLoading } = usePermissionCheck('absence', false);
  const canManage = isAdmin || isManager;
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const [profileId, setProfileId] = useState('');
  const [reasonId, setReasonId] = useState('');
  const [status, setStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [profiles, setProfiles] = useState<Array<{ id: string; full_name: string; employee_id: string | null }>>([]);

  const { data: reasons } = useAllAbsenceReasons();
  const { data: rows = [], isLoading } = useAllAbsences({
    profileId,
    reasonId,
    status,
    dateFrom,
    dateTo,
    archivedOnly: true,
  });

  useEffect(() => {
    if (authLoading || absencePermissionLoading) return;
    if (!canAccessAbsenceModule || !canManage) {
      router.replace('/dashboard');
    }
  }, [authLoading, absencePermissionLoading, canAccessAbsenceModule, canManage, router]);

  const financialYearStartYear = useMemo(() => {
    const fyParam = searchParams.get('fy');
    return fyParam ? Number.parseInt(fyParam, 10) : null;
  }, [searchParams]);

  useEffect(() => {
    async function fetchProfiles() {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, employee_id')
        .order('full_name');
      if (error) {
        console.error('Error fetching archive report profiles:', error);
        return;
      }
      setProfiles(data || []);
    }
    void fetchProfiles();
  }, [supabase]);

  const financialYears = useMemo(() => {
    const years = new Set<number>();
    rows.forEach((row) => years.add(row.financial_year_start_year || getFinancialYearStartYear(row.date)));
    return Array.from(years).sort((a, b) => b - a);
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (financialYearStartYear !== null) {
        const rowYear = row.financial_year_start_year || getFinancialYearStartYear(row.date);
        if (rowYear !== financialYearStartYear) return false;
      }
      return true;
    });
  }, [rows, financialYearStartYear]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = useMemo(
    () => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filtered, currentPage]
  );

  function updateFyInUrl(nextFy: number | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextFy === null) {
      params.delete('fy');
    } else {
      params.set('fy', String(nextFy));
    }
    const queryString = params.toString();
    router.replace(queryString ? `/absence/archive-report?${queryString}` : '/absence/archive-report', {
      scroll: false,
    });
  }

  if (authLoading || absencePermissionLoading || isLoading) {
    return <PageLoader message="Loading archive report..." />;
  }

  if (!canAccessAbsenceModule || !canManage) return null;

  return (
    <AppPageShell width="wide">
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-border">
        <div className="flex items-start gap-4">
          <BackButton />
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">Absence Archive Report</h1>
            <p className="text-muted-foreground">
              Read-only historical absences moved from closed financial years.
            </p>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Filters
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setProfileId('');
              setReasonId('');
              setStatus('');
              setDateFrom('');
              setDateTo('');
              setCurrentPage(1);
              updateFyInUrl(null);
            }}
          >
            Clear Filters
          </Button>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
            <div>
              <Label>Financial Year</Label>
              <Select
                value={financialYearStartYear === null ? 'all' : String(financialYearStartYear)}
                onValueChange={(value) => {
                  const next = value === 'all' ? null : Number.parseInt(value, 10);
                  setCurrentPage(1);
                  updateFyInUrl(next);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All years" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All years</SelectItem>
                  {financialYears.map((year) => (
                    <SelectItem key={year} value={String(year)}>
                      {formatFinancialYearLabel(year)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Employee</Label>
              <Select
                value={profileId || 'all'}
                onValueChange={(value) => {
                  setCurrentPage(1);
                  setProfileId(value === 'all' ? '' : value);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All employees" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All employees</SelectItem>
                  {profiles.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.full_name} {profile.employee_id ? `(${profile.employee_id})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Reason</Label>
              <Select
                value={reasonId || 'all'}
                onValueChange={(value) => {
                  setCurrentPage(1);
                  setReasonId(value === 'all' ? '' : value);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All reasons" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All reasons</SelectItem>
                  {reasons?.map((reason) => (
                    <SelectItem key={reason.id} value={reason.id}>
                      {reason.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select
                value={status || 'all'}
                onValueChange={(value) => {
                  setCurrentPage(1);
                  setStatus(value === 'all' ? '' : value);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>From Date</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(event) => {
                  setCurrentPage(1);
                  setDateFrom(event.target.value);
                }}
              />
            </div>
            <div>
              <Label>To Date</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(event) => {
                  setCurrentPage(1);
                  setDateTo(event.target.value);
                }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Archived Absence Records</CardTitle>
          <CardDescription>{filtered.length} records found</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto border border-border rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-slate-900 text-muted-foreground">
                <tr>
                  <th className="text-left p-3">Employee</th>
                  <th className="text-left p-3">Reason</th>
                  <th className="text-left p-3">Date</th>
                  <th className="text-left p-3">Requested</th>
                  <th className="text-left p-3">Approved</th>
                  <th className="text-left p-3">Duration</th>
                  <th className="text-left p-3">Status</th>
                  <th className="text-left p-3">FY</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((row) => (
                  <tr key={row.id} className="border-t border-border">
                    <td className="p-3 text-foreground">
                      {row.profiles.full_name}
                      {row.profiles.employee_id ? ` (${row.profiles.employee_id})` : ''}
                    </td>
                    <td className="p-3 text-muted-foreground">{row.absence_reasons.name}</td>
                    <td className="p-3 text-muted-foreground">
                      {row.end_date && row.end_date !== row.date
                        ? `${formatDate(row.date)} - ${formatDate(row.end_date)}`
                        : formatDate(row.date)}
                    </td>
                    <td className="p-3 text-muted-foreground">{formatDate(row.created_at)}</td>
                    <td className="p-3 text-muted-foreground">
                      {row.approved_at ? formatDate(row.approved_at) : '—'}
                    </td>
                    <td className="p-3 text-muted-foreground">{row.duration_days}</td>
                    <td className="p-3 text-muted-foreground">{row.status}</td>
                    <td className="p-3 text-muted-foreground">
                      {formatFinancialYearLabel(
                        row.financial_year_start_year || getFinancialYearStartYear(row.date)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <p className="text-sm text-muted-foreground">
                Showing {(currentPage - 1) * PAGE_SIZE + 1}-
                {Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((prev) => prev - 1)}
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
                  onClick={() => setCurrentPage((prev) => prev + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <AbsenceAboutHelper variant="archive-report" />
    </AppPageShell>
  );
}
