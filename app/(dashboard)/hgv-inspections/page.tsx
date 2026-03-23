'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryState } from 'nuqs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Clipboard, Clock, Download, Filter, Loader2, Plus, Trash2, User } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { fetchUserDirectory } from '@/lib/client/user-directory';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { formatDate } from '@/lib/utils/date';
import type { Employee } from '@/types/common';
import { useTabletMode } from '@/components/layout/tablet-mode-context';

interface HgvInspectionWithRelations {
  id: string;
  user_id: string;
  hgv_id: string | null;
  inspection_date: string;
  inspection_end_date: string | null;
  status: 'submitted';
  submitted_at: string | null;
  hgv: { reg_number: string; nickname: string | null } | null;
  profile: { full_name: string } | null;
}

interface HgvSummary {
  id: string;
  reg_number: string;
  nickname: string | null;
}

function HgvInspectionsContent() {
  const { user, isManager, isAdmin, isSuperAdmin, loading: authLoading } = useAuth();
  const isElevatedUser = isManager || isAdmin || isSuperAdmin;
  const pageSize = isElevatedUser ? 20 : 10;
  usePermissionCheck('hgv-inspections');
  const router = useRouter();
  const { tabletModeEnabled } = useTabletMode();
  const supabase = createClient();

  const [inspections, setInspections] = useState<HgvInspectionWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [hgvs, setHgvs] = useState<HgvSummary[]>([]);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [displayCount, setDisplayCount] = useState(pageSize);

  const [selectedEmployeeId, setSelectedEmployeeId] = useQueryState('employee', {
    defaultValue: 'all',
    shallow: false,
  });
  const [hgvFilter, setHgvFilter] = useQueryState('hgv', {
    defaultValue: 'all',
    shallow: false,
  });

  const fetchFilters = useCallback(async () => {
    const { data: hgvData } = await supabase
      .from('hgvs')
      .select('id, reg_number, nickname')
      .eq('status', 'active')
      .order('reg_number');
    setHgvs(hgvData || []);

    if (isElevatedUser) {
      const profileData = await fetchUserDirectory({ module: 'hgv-inspections' });
      setEmployees(
        profileData.map((employee) => ({
          id: employee.id,
          full_name: employee.full_name || 'Unknown User',
          employee_id: employee.employee_id,
          has_module_access: employee.has_module_access,
        })) as Employee[]
      );
    }
  }, [isElevatedUser, supabase]);

  const fetchInspections = useCallback(async () => {
    if (!user || authLoading) return;
    setLoading(true);

    try {
      let query = supabase
        .from('hgv_inspections')
        .select(`
          *,
          hgv:hgvs!hgv_inspections_hgv_id_fkey(reg_number, nickname),
          profile:profiles!hgv_inspections_user_id_fkey(full_name)
        `)
        .order('inspection_date', { ascending: false });

      if (!isElevatedUser) {
        query = query.eq('user_id', user.id);
      } else if ((selectedEmployeeId || 'all') !== 'all') {
        query = query.eq('user_id', selectedEmployeeId as string);
      }

      if ((hgvFilter || 'all') !== 'all') {
        query = query.eq('hgv_id', hgvFilter as string);
      }

      const { data, error } = await query;
      if (error) throw error;
      setInspections((data || []) as HgvInspectionWithRelations[]);
    } catch (error) {
      console.error('Error fetching HGV inspections:', error);
      toast.error('Failed to load HGV inspections');
    } finally {
      setLoading(false);
    }
  }, [authLoading, hgvFilter, isElevatedUser, selectedEmployeeId, supabase, user]);

  useEffect(() => {
    setDisplayCount(pageSize);
  }, [pageSize, selectedEmployeeId, hgvFilter]);

  useEffect(() => {
    fetchFilters();
  }, [fetchFilters]);

  useEffect(() => {
    fetchInspections();
  }, [fetchInspections]);

  const handleDownloadPDF = async (e: React.MouseEvent, inspectionId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDownloading(inspectionId);
    try {
      const response = await fetch(`/api/hgv-inspections/${inspectionId}/pdf`);
      if (!response.ok) {
        throw new Error('Failed to generate PDF');
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hgv-inspection-${inspectionId}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch {
      toast.error('Failed to download PDF');
    } finally {
      setDownloading(null);
    }
  };

  const handleDelete = async (e: React.MouseEvent, inspectionId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Delete this inspection? This cannot be undone.')) return;

    setDeleting(inspectionId);
    try {
      const response = await fetch(`/api/hgv-inspections/${inspectionId}/delete`, { method: 'DELETE' });
      if (!response.ok) {
        throw new Error('Delete failed');
      }
      toast.success('Daily check deleted');
      fetchInspections();
    } catch {
      toast.error('Failed to delete inspection');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl">
      <div className={`bg-slate-900 rounded-lg border border-border ${tabletModeEnabled ? 'p-5 md:p-6' : 'p-6'}`}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">HGV Daily Checks</h1>
            <p className="text-muted-foreground">Daily 25-point HGV safety checks</p>
          </div>
          <Link href="/hgv-inspections/new">
            <Button className={`bg-inspection hover:bg-inspection/90 text-white ${tabletModeEnabled ? 'min-h-11 text-base px-4 [&_svg]:size-5' : ''}`}>
              <Plus className="h-4 w-4 mr-2" />
              New Daily Check
            </Button>
          </Link>
        </div>

        {isElevatedUser && employees.length > 0 && (
          <div className={`pt-4 border-t border-border flex items-center gap-3 ${tabletModeEnabled ? 'max-w-none flex-wrap' : 'max-w-md'}`}>
            <Label className="text-white text-sm flex items-center gap-2 whitespace-nowrap">
              <User className="h-4 w-4" />
              View daily checks for:
            </Label>
            <Select value={selectedEmployeeId || 'all'} onValueChange={setSelectedEmployeeId}>
              <SelectTrigger className={`${tabletModeEnabled ? 'min-h-11 text-base' : 'h-10'} border-border text-white`}>
                <SelectValue placeholder="All employees" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Employees</SelectItem>
                {employees.map((employee) => (
                    <SelectItem key={employee.id} value={employee.id} disabled={employee.has_module_access === false}>
                    {employee.full_name}
                    {employee.employee_id ? ` (${employee.employee_id})` : ''}
                      {employee.has_module_access === false && ' - No HGV Checks access'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {isElevatedUser && (
        <Card>
          <CardContent className="pt-6">
            <div className={`flex items-center gap-3 ${tabletModeEnabled ? 'flex-wrap' : ''}`}>
              <Filter className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-slate-400">Filter by HGV:</span>
              <Select value={hgvFilter || 'all'} onValueChange={setHgvFilter}>
                <SelectTrigger className={`${tabletModeEnabled ? 'min-h-11 text-base w-full md:w-[360px]' : 'w-[320px] h-9'}`}>
                  <SelectValue placeholder="All HGVs" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All HGVs</SelectItem>
                  {hgvs.map((hgv) => (
                    <SelectItem key={hgv.id} value={hgv.id}>
                      {hgv.reg_number}
                      {hgv.nickname ? ` - ${hgv.nickname}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <Loader2 className="h-10 w-10 animate-spin text-inspection mx-auto mb-3" />
            <p className="text-muted-foreground text-sm">Loading daily checks...</p>
          </div>
        </div>
      ) : inspections.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Clipboard className="h-16 w-16 text-slate-400 mb-4" />
            <h3 className="text-lg font-semibold text-white mb-2">No HGV daily checks yet</h3>
            <p className="text-slate-400 mb-4">Create your first HGV daily check</p>
            <Link href="/hgv-inspections/new">
              <Button className={`bg-inspection hover:bg-inspection/90 text-white ${tabletModeEnabled ? 'min-h-11 text-base px-4 [&_svg]:size-5' : ''}`}>
                <Plus className="h-4 w-4 mr-2" />
                Create Daily Check
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4">
            {inspections.slice(0, displayCount).map((inspection) => (
            <Card
              key={inspection.id}
              className="border-border hover:shadow-lg hover:border-inspection/50 transition-all duration-200 cursor-pointer"
              onClick={() => router.push(`/hgv-inspections/${inspection.id}`)}
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-3">
                    <Clock className="h-5 w-5 text-amber-500" />
                    <div>
                      <CardTitle className="text-lg text-white">
                        {inspection.hgv?.reg_number || 'Unknown HGV'}
                        {inspection.hgv?.nickname ? ` - ${inspection.hgv.nickname}` : ''}
                      </CardTitle>
                      <CardDescription className="text-muted-foreground">
                        {isElevatedUser && inspection.profile?.full_name ? `${inspection.profile.full_name} • ` : ''}
                        {formatDate(inspection.inspection_date)}
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge>Submitted</Badge>
                    {isElevatedUser && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => handleDelete(e, inspection.id)}
                        disabled={deleting === inspection.id}
                        className={`${tabletModeEnabled ? 'h-11 w-11 p-0' : 'h-8 w-8 p-0'} text-red-600 hover:text-red-700`}
                        title="Delete inspection"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between text-sm">
                  <div className="text-muted-foreground">
                    {inspection.submitted_at ? `Submitted ${formatDate(inspection.submitted_at)}` : 'Submitted'}
                  </div>
                  <Button
                    onClick={(e) => handleDownloadPDF(e, inspection.id)}
                    disabled={downloading === inspection.id}
                    variant="outline"
                    size="sm"
                    className={`bg-slate-900 border-inspection text-inspection hover:bg-inspection hover:text-white ${tabletModeEnabled ? 'min-h-11 text-base px-4' : ''}`}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    {downloading === inspection.id ? 'Downloading...' : 'Download PDF'}
                  </Button>
                </div>
              </CardContent>
            </Card>
            ))}
          </div>
          {inspections.length > displayCount && (
            <div className="flex justify-center pt-4">
              <Button
                onClick={() => setDisplayCount((prev) => prev + pageSize)}
                variant="outline"
                className={`w-full max-w-xs border-border text-white hover:bg-slate-800 ${tabletModeEnabled ? 'min-h-11 text-base' : ''}`}
              >
                Show More ({inspections.length - displayCount} remaining)
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function HgvInspectionsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-[400px]"><p className="text-muted-foreground">Loading...</p></div>}>
      <HgvInspectionsContent />
    </Suspense>
  );
}
