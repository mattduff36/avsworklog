'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { useInspectionRealtime } from '@/lib/hooks/useRealtime';
import { fetchUserDirectory } from '@/lib/client/user-directory';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel, SelectSeparator } from '@/components/ui/select';
import { PageLoader } from '@/components/ui/page-loader';
import { getRecentVehicleIds, splitVehiclesByRecent } from '@/lib/utils/recentVehicles';
import { Label } from '@/components/ui/label';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Clipboard, Clock, User, Download, Trash2, Filter, FileText, Truck, Loader2 } from 'lucide-react';
import { formatDate } from '@/lib/utils/date';
import { toast } from 'sonner';
import { VanInspection } from '@/types/inspection';
import { Employee, InspectionStatusFilter } from '@/types/common';
import { useQueryState } from 'nuqs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useTabletMode } from '@/components/layout/tablet-mode-context';

interface InspectionWithVehicle extends VanInspection {
  vans: {
    reg_number: string;
    van_categories: { name: string } | null;
  };
  has_reported_defect?: boolean;
  has_inform_workshop_task?: boolean;
}

interface Vehicle {
  id: string;
  reg_number: string;
  van_categories: { name: string } | null;
}

interface InspectionItemSummaryRow {
  inspection_id: string | null;
  status: string | null;
}

interface WorkshopTaskSummaryRow {
  inspection_id: string | null;
}

function InspectionsContent() {
  const { user, isManager, isAdmin, isSuperAdmin, loading: authLoading } = useAuth();
  const isElevatedUser = isManager || isAdmin || isSuperAdmin;
  const pageSize = isElevatedUser ? 20 : 10;
  usePermissionCheck('inspections');
  const router = useRouter();
  const { tabletModeEnabled } = useTabletMode();
  const [inspections, setInspections] = useState<InspectionWithVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [recentVehicleIds, setRecentVehicleIds] = useState<string[]>([]);
  // Use URL search params to persist filter selection across navigations
  const [selectedEmployeeId, setSelectedEmployeeId] = useQueryState('employee', { 
    defaultValue: 'all',
    shallow: false,
  });
  const [statusFilter, setStatusFilter] = useQueryState('status', {
    defaultValue: 'all' as InspectionStatusFilter,
    shallow: false,
  });
  const [vehicleFilter, setVehicleFilter] = useQueryState('van', {
    defaultValue: 'all',
    shallow: false,
  });
  const [downloading, setDownloading] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [inspectionToDelete, setInspectionToDelete] = useState<{ id: string; vehicleReg: string; date: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [displayCount, setDisplayCount] = useState(pageSize);
  const [hasMore, setHasMore] = useState(false);
  const supabase = createClient();

  // Fetch employees and vehicles
  useEffect(() => {
    if (user && isElevatedUser) {
      const fetchEmployees = async () => {
        try {
          const data = await fetchUserDirectory({ module: 'inspections', limit: 200 });
          setEmployees(
            data.map((employee) => ({
              id: employee.id,
              full_name: employee.full_name || 'Unknown User',
              employee_id: employee.employee_id,
              has_module_access: employee.has_module_access,
            }))
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const isNetworkFailure =
            message.includes('Failed to fetch') || message.includes('NetworkError') || message.toLowerCase().includes('network');
          if (isNetworkFailure) {
            console.warn('Unable to load employees (network):', err);
          } else {
            console.error('Error fetching employees:', err);
          }
        }
      };
      fetchEmployees();
    }
    const fetchVehicles = async () => {
      try {
        const { data, error } = await supabase
          .from('vans')
          .select(`
            id, 
            reg_number, 
            van_categories (
              name
            )
          `)
          .order('reg_number');
        
        if (error) throw error;
        setVehicles(data || []);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isNetworkErr = msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.toLowerCase().includes('network');
        if (isNetworkErr) {
          console.warn('Unable to load vans (network):', err);
        } else {
          console.error('Error fetching vehicles:', err);
        }
      }
    };
    fetchVehicles();
    // Load recent vehicle IDs
    if (user?.id) {
      setRecentVehicleIds(getRecentVehicleIds(user.id));
    }
  }, [user, isElevatedUser, supabase]);

  const fetchInspections = useCallback(async () => {
    if (!user || authLoading) return;
    setLoading(true);

    try {
      let query = supabase
        .from('van_inspections')
        .select(`
          *,
          vans (
            reg_number,
            van_categories (
              name
            )
          ),
          profile:profiles!van_inspections_user_id_fkey(full_name)
        `)
        .order('inspection_date', { ascending: false })
        .range(0, displayCount);

      // Filter based on user role and selection
      if (!isElevatedUser) {
        // Regular employees only see their own
        query = query.eq('user_id', user.id);
      } else {
        // Manager: filter by selected employee or show all
        const employeeFilter = selectedEmployeeId || 'all';
        if (employeeFilter !== 'all') {
          query = query.eq('user_id', employeeFilter);
        }
        // If 'all' selected, show all inspections (no filter)
      }

      // Apply status filter
      const currentStatusFilter = statusFilter || 'all';
      if (currentStatusFilter !== 'all') {
        query = query.eq('status', currentStatusFilter);
      }
      // 'all' doesn't filter by status

      // Apply van filter
      const currentVehicleFilter = vehicleFilter || 'all';
      if (currentVehicleFilter !== 'all') {
        query = query.eq('van_id', currentVehicleFilter);
      }

      const { data, error } = await query;

      if (error) throw error;
      const rows = (data || []) as InspectionWithVehicle[];
      const inspectionIds = rows.map((row) => row.id).filter((id): id is string => Boolean(id));
      let defectInspectionIds = new Set<string>();
      let workshopTaskInspectionIds = new Set<string>();

      if (inspectionIds.length > 0) {
        const { data: defectData, error: defectError } = await supabase
          .from('inspection_items')
          .select('inspection_id, status')
          .in('inspection_id', inspectionIds)
          .in('status', ['attention', 'defect']);

        if (defectError) {
          console.warn('Unable to determine defect status for inspection icons:', defectError);
        } else {
          defectInspectionIds = new Set(
            ((defectData || []) as InspectionItemSummaryRow[])
              .map((row) => row.inspection_id)
              .filter((id): id is string => Boolean(id))
          );
        }

        const { data: workshopTaskData, error: workshopTaskError } = await supabase
          .from('actions')
          .select('inspection_id')
          .in('inspection_id', inspectionIds)
          .eq('action_type', 'workshop_vehicle_task');

        if (workshopTaskError) {
          console.warn('Unable to determine workshop-task status for inspection icons:', workshopTaskError);
        } else {
          workshopTaskInspectionIds = new Set(
            ((workshopTaskData || []) as WorkshopTaskSummaryRow[])
              .map((row) => row.inspection_id)
              .filter((id): id is string => Boolean(id))
          );
        }
      }

      const enrichedRows = rows.map((row) => ({
        ...row,
        has_reported_defect: defectInspectionIds.has(row.id),
        has_inform_workshop_task: workshopTaskInspectionIds.has(row.id),
      }));
      setHasMore(rows.length > displayCount);
      setInspections(enrichedRows.slice(0, displayCount));
    } catch (error) {
      const message = (() => {
        if (error instanceof Error) return error.message;
        if (typeof error === 'string') return error;
        try {
          return JSON.stringify(error);
        } catch {
          return String(error);
        }
      })();
      const isNetworkFailure =
        message.includes('Failed to fetch') || message.includes('NetworkError') || message.toLowerCase().includes('network');

      // Avoid escalating common mobile/offline network failures into centralized error logs
      if (isNetworkFailure) {
        console.warn('Unable to load inspections (network):', error);
      } else {
        console.error('Error fetching inspections:', error);
      }

      // Show friendly message if offline or network failure
      if (!navigator.onLine || isNetworkFailure) {
        try {
          toast.error('Unable to load inspections', {
            description: 'Please check your internet connection.',
          });
        } catch {
          console.warn('Unable to load inspections (toast unavailable)');
        }
      }
    } finally {
      setLoading(false);
    }
  }, [user, authLoading, isElevatedUser, selectedEmployeeId, statusFilter, vehicleFilter, supabase, displayCount]);

  useEffect(() => {
    setDisplayCount(pageSize);
  }, [pageSize, selectedEmployeeId, statusFilter, vehicleFilter]);

  useEffect(() => {
    fetchInspections();
  }, [fetchInspections]);

  // Listen for realtime updates to inspections
  useInspectionRealtime((payload) => {
    console.log('Realtime inspection update:', payload);
    
      // Refetch inspections when changes occur
      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE' || payload.eventType === 'DELETE') {
        fetchInspections();
        
        // Show toast notification when inspection is submitted
        if (payload.eventType === 'UPDATE' && payload.new && 'status' in payload.new) {
          const status = (payload.new as { status?: string }).status;
          if (status === 'submitted') {
            toast.success('Daily check submitted', {
              description: 'A van inspection has been submitted.',
            });
          }
        }
      }
  });

  const getFilterLabel = (filter: InspectionStatusFilter) => {
    switch (filter) {
      case 'all': return 'All';
      case 'draft': return 'Draft';
      case 'submitted': return 'Submitted';
      default: return filter; // Fallback for any unexpected values
    }
  };

  const getStatusBadge = (status: string) => {
    const variants = {
      draft: { variant: 'secondary' as const, label: 'Draft' },
      submitted: { variant: 'default' as const, label: 'Submitted' },
    };

    const config = variants[status as keyof typeof variants] || variants.draft;

    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const getStatusIcon = (inspection: InspectionWithVehicle) => {
    const iconColorClass = inspection.has_inform_workshop_task
      ? 'text-inspection'
      : inspection.has_reported_defect
        ? 'text-red-500'
        : 'text-green-500';

    if (inspection.status === 'submitted') {
      return <Clock className={`h-5 w-5 ${iconColorClass}`} />;
    }

    return <Clipboard className={`h-5 w-5 ${iconColorClass}`} />;
  };

  const handleDownloadPDF = async (e: React.MouseEvent, inspectionId: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    setDownloading(inspectionId);
    try {
      const response = await fetch(`/api/van-inspections/${inspectionId}/pdf`);
      if (!response.ok) {
        const raw = await response.text().catch(() => '');
        const serverMessage = (() => {
          if (!raw) return '';
          try {
            const parsed = JSON.parse(raw) as { error?: unknown; message?: unknown };
            const msg = parsed?.error ?? parsed?.message;
            return typeof msg === 'string' ? msg : raw;
          } catch {
            return raw;
          }
        })();

        console.warn('Inspection PDF download failed:', {
          inspectionId,
          status: response.status,
          statusText: response.statusText,
          serverMessage,
        });

        toast.error('Failed to download PDF', {
          description: serverMessage || 'Please try again or contact support if the problem persists.',
        });
        return;
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `inspection-${inspectionId}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const isNetworkFailure =
        msg.includes('Failed to fetch') ||
        msg.includes('NetworkError') ||
        msg.includes('AuthRetryableFetchError') ||
        msg.toLowerCase().includes('network');

      if (isNetworkFailure) {
        console.warn('Inspection PDF download failed (network):', error);
      } else {
        console.error('Inspection PDF download failed:', error);
      }

      toast.error('Failed to download PDF', {
        description: isNetworkFailure
          ? 'Please check your internet connection and try again.'
          : 'Please try again or contact support if the problem persists.',
      });
    } finally {
      setDownloading(null);
    }
  };

  const openDeleteDialog = (e: React.MouseEvent, inspection: InspectionWithVehicle) => {
    e.stopPropagation(); // Prevent card click
    setInspectionToDelete({
      id: inspection.id,
      vehicleReg: inspection.vans?.reg_number || 'Unknown',
      date: formatDate(inspection.inspection_date),
    });
    setDeleteDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!inspectionToDelete) return;

    setDeleting(true);
    try {
      const response = await fetch(`/api/van-inspections/${inspectionToDelete.id}/delete`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete inspection');
      }

      toast.success('Daily check deleted successfully');
      setDeleteDialogOpen(false);
      setInspectionToDelete(null);
      fetchInspections(); // Refresh list
    } catch (err: unknown) {
      console.error('Error deleting inspection:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to delete inspection');
    } finally {
      setDeleting(false);
    }
  };

  const showInitialLoading = loading && inspections.length === 0;

  return (
    <div className="space-y-6 max-w-6xl">
      
      {/* Header */}
      <div className={`bg-slate-900 rounded-lg border border-border ${tabletModeEnabled ? 'p-5 md:p-6' : 'p-6'}`}>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Van Daily Checks</h1>
            <p className="text-muted-foreground">
              Daily safety check sheets
            </p>
          </div>
          <Link href="/van-inspections/new">
            <Button className={`bg-inspection hover:bg-inspection-dark text-white transition-all duration-200 active:scale-95 shadow-md hover:shadow-lg ${tabletModeEnabled ? 'min-h-11 text-base px-4 [&_svg]:size-5' : ''}`}>
              <Plus className="h-4 w-4 mr-2" />
              New Daily Check
            </Button>
          </Link>
        </div>
        
        {/* Manager: Employee Filter */}
        {isElevatedUser && employees.length > 0 && (
          <div className="pt-4 border-t border-border">
            <div className={`flex items-center gap-3 ${tabletModeEnabled ? 'max-w-none flex-wrap' : 'max-w-md'}`}>
              <Label htmlFor="employee-filter" className="text-white text-sm flex items-center gap-2 whitespace-nowrap">
                <User className="h-4 w-4" />
                View daily checks for:
              </Label>
              <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
              <SelectTrigger id="employee-filter" className={`${tabletModeEnabled ? 'min-h-11 text-base' : 'h-10'} border-border text-white bg-slate-900/50`}>
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Employees</SelectItem>
                  {employees.map((employee) => (
                    <SelectItem key={employee.id} value={employee.id} disabled={employee.has_module_access === false}>
                      {employee.full_name}
                      {employee.employee_id && ` (${employee.employee_id})`}
                      {employee.has_module_access === false && ' - No Van Checks access'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </div>

      {/* Filters - Only show for managers */}
      {isElevatedUser && (
        <Card className="border-border">
          <CardContent className="pt-6">
            <div className={`grid grid-cols-1 gap-6 ${tabletModeEnabled ? 'md:grid-cols-1' : 'md:grid-cols-2'}`}>
              {/* Status Filter */}
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-slate-400 mr-2">Filter by status:</span>
                <div className="flex gap-2 flex-wrap">
                  {(['all', 'draft', 'submitted'] as InspectionStatusFilter[]).map((filter) => (
                    <Button
                      key={filter}
                      variant="outline"
                      size="sm"
                      onClick={() => setStatusFilter(filter)}
                      className={`${tabletModeEnabled ? 'min-h-11 text-base px-4 [&_svg]:size-5' : ''} ${statusFilter === filter ? 'bg-white text-slate-900 border-white/80 hover:bg-slate-200' : 'border-slate-600 text-muted-foreground hover:bg-slate-700/50'}`}
                    >
                      {filter === 'submitted' && <Clock className="h-3 w-3 mr-1" />}
                      {filter === 'draft' && <FileText className="h-3 w-3 mr-1" />}
                      {getFilterLabel(filter)}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Van Filter */}
              <div className="flex items-center gap-3">
                <Truck className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-slate-400 mr-2 whitespace-nowrap">Filter by van:</span>
                <Select value={vehicleFilter} onValueChange={setVehicleFilter}>
                <SelectTrigger className={`${tabletModeEnabled ? 'min-h-11 text-base' : 'h-9'} border-border text-white bg-slate-900/50`}>
                    <SelectValue placeholder="All vans" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Vans</SelectItem>
                    {(() => {
                      const { recentVehicles, otherVehicles } = splitVehiclesByRecent(vehicles as Array<Vehicle & Record<string, unknown>>, recentVehicleIds);
                      return (
                        <>
                          {recentVehicles.length > 0 && (
                            <>
                              <SelectSeparator className="bg-slate-700" />
                              <SelectGroup>
                                <SelectLabel className="">Recent</SelectLabel>
                                {recentVehicles.map((vehicle: Vehicle) => (
                                  <SelectItem key={vehicle.id} value={vehicle.id}>
                                    {vehicle.reg_number}
                                    {vehicle.van_categories?.name && ` (${vehicle.van_categories.name})`}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </>
                          )}
                          {otherVehicles.length > 0 && (
                            <>
                              <SelectSeparator className="bg-slate-700" />
                              <SelectGroup>
                                {recentVehicles.length > 0 && (
                                  <SelectLabel className="">All Vans</SelectLabel>
                                )}
                                {otherVehicles.map((vehicle: Vehicle) => (
                                  <SelectItem key={vehicle.id} value={vehicle.id}>
                                    {vehicle.reg_number}
                                    {vehicle.van_categories?.name && ` (${vehicle.van_categories.name})`}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </>
                          )}
                        </>
                      );
                    })()}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {showInitialLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <Loader2 className="h-10 w-10 animate-spin text-inspection mx-auto mb-3" />
            <p className="text-muted-foreground text-sm">Loading daily checks...</p>
          </div>
        </div>
      ) : inspections.length === 0 ? (
        <Card className="border-border">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Clipboard className="h-16 w-16 text-slate-400 mb-4" />
            <h3 className="text-lg font-semibold text-white mb-2">No daily checks yet</h3>
            <p className="text-slate-400 mb-4">
              Create your first van daily check
            </p>
            <Link href="/van-inspections/new">
              <Button className="bg-inspection hover:bg-inspection-dark text-white transition-all duration-200 active:scale-95">
                <Plus className="h-4 w-4 mr-2" />
                Create Daily Check
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          {loading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Refreshing daily checks...
            </div>
          )}
          <div className="grid gap-4">
            {inspections.map((inspection) => {
              const inspectionStatus = inspection.status as string;
              return (
            <Card 
              key={inspection.id} 
              className="border-border hover:shadow-lg hover:border-inspection/50 transition-all duration-200 cursor-pointer"
              onClick={() => {
                // Draft inspections open in the new/edit page, others in view page
                if (inspection.status === 'draft') {
                  router.push(`/van-inspections/new?id=${inspection.id}`);
                } else {
                  router.push(`/van-inspections/${inspection.id}`);
                }
              }}
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-3">
                    {getStatusIcon(inspection)}
                    <div>
                      <CardTitle className="text-lg text-white">
                        {inspection.vans?.reg_number || 'Unknown Van'}
                      </CardTitle>
                      <CardDescription className="text-muted-foreground">
                        {isElevatedUser && (inspection as { profile?: { full_name?: string } | null }).profile?.full_name && (
                          <span className="font-medium text-white">
                            {(inspection as { profile?: { full_name?: string } | null }).profile?.full_name}
                            {' • '}
                          </span>
                        )}
                        {inspection.vans?.van_categories?.name && `${inspection.vans.van_categories.name} • `}
                        {inspection.inspection_end_date && inspection.inspection_end_date !== inspection.inspection_date
                          ? `${formatDate(inspection.inspection_date)} - ${formatDate(inspection.inspection_end_date)}`
                          : formatDate(inspection.inspection_date)
                        }
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getStatusBadge(inspection.status)}
                    {isElevatedUser && (
                      <Button
                        onClick={(e) => openDeleteDialog(e, inspection)}
                        variant="ghost"
                        size="sm"
                        className={`${tabletModeEnabled ? 'h-11 w-11 p-0' : 'h-8 w-8 p-0'} text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950`}
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
                    {inspection.submitted_at
                      ? `Submitted ${formatDate(inspection.submitted_at)}`
                      : 'Not yet submitted'}
                  </div>
                  {inspectionStatus === 'rejected' && inspection.manager_comments && (
                    <div className="text-red-600 text-xs">
                      See manager comments
                    </div>
                  )}
                  {/* Download PDF Button for Approved/Pending */}
                  {(inspectionStatus === 'approved' || inspectionStatus === 'submitted') && (
                    <Button
                      onClick={(e) => handleDownloadPDF(e, inspection.id)}
                      disabled={downloading === inspection.id}
                      variant="outline"
                      size="sm"
                      className={`bg-slate-900 border-inspection text-inspection hover:bg-inspection hover:text-white transition-all duration-200 ${tabletModeEnabled ? 'min-h-11 text-base px-4' : ''}`}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      {downloading === inspection.id ? 'Downloading...' : 'Download PDF'}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
              );
            })}
          </div>

          {/* Show More Button */}
          {hasMore && (
            <div className="flex justify-center pt-4">
              <Button
                onClick={() => setDisplayCount((prev) => prev + pageSize)}
                variant="outline"
                className={`w-full max-w-xs border-border text-white hover:bg-slate-800 ${tabletModeEnabled ? 'min-h-11 text-base' : ''}`}
              >
                Show More
              </Button>
            </div>
          )}
        </>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Daily Check</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the inspection for{' '}
              <span className="font-semibold">{inspectionToDelete?.vehicleReg}</span> on{' '}
              <span className="font-semibold">{inspectionToDelete?.date}</span>?
              <br />
              <br />
              This action cannot be undone. All inspection items will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function InspectionsPage() {
  return (
    <Suspense fallback={<PageLoader message="Loading van inspections..." />}>
      <InspectionsContent />
    </Suspense>
  );
}
