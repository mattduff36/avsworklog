'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { useOfflineSync } from '@/lib/hooks/useOfflineSync';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { useInspectionRealtime } from '@/lib/hooks/useRealtime';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { OfflineBanner } from '@/components/ui/offline-banner';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Clipboard, CheckCircle2, XCircle, Clock, AlertCircle, User, Download, Trash2, Filter, FileText } from 'lucide-react';
import { formatDate } from '@/lib/utils/date';
import { toast } from 'sonner';
import { VehicleInspection } from '@/types/inspection';
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

interface InspectionWithVehicle extends VehicleInspection {
  vehicles: {
    reg_number: string;
    vehicle_type: string;
  };
}

export default function InspectionsPage() {
  const { user, isManager } = useAuth();
  const { isOnline } = useOfflineSync();
  const { hasPermission, loading: permissionLoading } = usePermissionCheck('inspections');
  const router = useRouter();
  const [inspections, setInspections] = useState<InspectionWithVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  // Use URL search params to persist filter selection across navigations
  const [selectedEmployeeId, setSelectedEmployeeId] = useQueryState('employee', { 
    defaultValue: 'all',
    shallow: false,
  });
  const [statusFilter, setStatusFilter] = useQueryState<InspectionStatusFilter>('status', {
    defaultValue: 'all',
    shallow: false,
  });
  const [downloading, setDownloading] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [inspectionToDelete, setInspectionToDelete] = useState<{ id: string; vehicleReg: string; date: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const supabase = createClient();

  // Fetch employees if manager
  useEffect(() => {
    if (user && isManager) {
      fetchEmployees();
    }
  }, [user?.id, isManager]);

  useEffect(() => {
    fetchInspections();
  }, [user?.id, isManager, selectedEmployeeId, statusFilter]);

  // Listen for realtime updates to inspections
  useInspectionRealtime((payload) => {
    console.log('Realtime inspection update:', payload);
    
    // Refetch inspections when changes occur
    if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE' || payload.eventType === 'DELETE') {
      fetchInspections();
      
      // Show toast notification for significant changes
      if (payload.eventType === 'UPDATE' && payload.new && 'status' in payload.new) {
        const status = (payload.new as { status?: string }).status;
        if (status === 'approved') {
          toast.success('Inspection approved!', {
            description: 'A vehicle inspection has been approved by your manager.',
          });
        } else if (status === 'rejected') {
          toast.error('Inspection rejected', {
            description: 'A vehicle inspection has been rejected. Please review the comments.',
          });
        }
      }
    }
  });

  const fetchEmployees = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, employee_id')
        .order('full_name');
      
      if (error) throw error;
      setEmployees(data || []);
    } catch (err) {
      console.error('Error fetching employees:', err);
    }
  };

  const fetchInspections = async () => {
    if (!user) return;
    
    try {
      let query = supabase
        .from('vehicle_inspections')
        .select(`
          *,
          vehicles (
            reg_number,
            vehicle_type
          ),
          profile:profiles!vehicle_inspections_user_id_fkey(full_name)
        `)
        .order('inspection_date', { ascending: false });

      // Filter based on user role and selection
      if (!isManager) {
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
      if (currentStatusFilter === 'pending') {
        query = query.eq('status', 'submitted');
      } else if (currentStatusFilter !== 'all') {
        query = query.eq('status', currentStatusFilter);
      }
      // 'all' doesn't filter by status

      const { data, error } = await query;

      if (error) throw error;
      setInspections(data || []);
    } catch (error) {
      console.error('Error fetching inspections:', error);
      // Show friendly message if offline
      if (!isOnline) {
        toast.error('Unable to load inspections', {
          description: 'Please check your internet connection.',
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const getFilterLabel = (filter: InspectionStatusFilter) => {
    switch (filter) {
      case 'all': return 'All';
      case 'draft': return 'Draft';
      case 'pending': return 'Pending';
      case 'approved': return 'Approved';
      case 'rejected': return 'Rejected';
    }
  };

  const getStatusBadge = (status: string) => {
    const variants = {
      draft: { variant: 'secondary' as const, label: 'Draft' },
      submitted: { variant: 'warning' as const, label: 'Pending' },
      approved: { variant: 'success' as const, label: 'Approved' },
      rejected: { variant: 'destructive' as const, label: 'Rejected' },
    };

    const config = variants[status as keyof typeof variants] || variants.draft;

    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'submitted':
        return <Clock className="h-5 w-5 text-amber-600" />;
      case 'approved':
        return <CheckCircle2 className="h-5 w-5 text-green-600" />;
      case 'rejected':
        return <XCircle className="h-5 w-5 text-red-600" />;
      default:
        return <Clipboard className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const handleDownloadPDF = async (e: React.MouseEvent, inspectionId: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    setDownloading(inspectionId);
    try {
      const response = await fetch(`/api/inspections/${inspectionId}/pdf`);
      if (!response.ok) {
        throw new Error('Failed to generate PDF');
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
      console.error('Error downloading PDF:', error);
      alert('Failed to download PDF');
    } finally {
      setDownloading(null);
    }
  };

  const openDeleteDialog = (e: React.MouseEvent, inspection: InspectionWithVehicle) => {
    e.stopPropagation(); // Prevent card click
    setInspectionToDelete({
      id: inspection.id,
      vehicleReg: inspection.vehicles?.reg_number || 'Unknown',
      date: formatDate(inspection.inspection_date),
    });
    setDeleteDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!inspectionToDelete) return;

    setDeleting(true);
    try {
      const response = await fetch(`/api/inspections/${inspectionToDelete.id}/delete`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete inspection');
      }

      toast.success('Inspection deleted successfully');
      setDeleteDialogOpen(false);
      setInspectionToDelete(null);
      fetchInspections(); // Refresh list
    } catch (err: any) {
      console.error('Error deleting inspection:', err);
      toast.error(err.message || 'Failed to delete inspection');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Offline Banner */}
      {!isOnline && <OfflineBanner />}
      
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Vehicle Inspections</h1>
            <p className="text-slate-600 dark:text-slate-400">
              Daily safety check sheets
            </p>
          </div>
          <Link href="/inspections/new">
            <Button className="bg-inspection hover:bg-inspection-dark text-white transition-all duration-200 active:scale-95 shadow-md hover:shadow-lg">
              <Plus className="h-4 w-4 mr-2" />
              New Inspection
            </Button>
          </Link>
        </div>
        
        {/* Manager: Employee Filter */}
        {isManager && employees.length > 0 && (
          <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-3 max-w-md">
              <Label htmlFor="employee-filter" className="text-slate-900 dark:text-white text-sm flex items-center gap-2 whitespace-nowrap">
                <User className="h-4 w-4" />
                View inspections for:
              </Label>
              <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
                <SelectTrigger id="employee-filter" className="h-10 bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white">
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Employees</SelectItem>
                  {employees.map((employee) => (
                    <SelectItem key={employee.id} value={employee.id}>
                      {employee.full_name}
                      {employee.employee_id && ` (${employee.employee_id})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </div>

      {/* Status Filter */}
      <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
        <CardContent className="pt-6">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-slate-400" />
            <span className="text-sm text-slate-400 mr-2">Filter by status:</span>
            <div className="flex gap-2 flex-wrap">
              {(['all', 'draft', 'pending', 'approved', 'rejected'] as InspectionStatusFilter[]).map((filter) => (
                <Button
                  key={filter}
                  variant={statusFilter === filter ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setStatusFilter(filter)}
                  className={statusFilter === filter ? '' : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/50'}
                >
                  {filter === 'pending' && <Clock className="h-3 w-3 mr-1" />}
                  {filter === 'approved' && <CheckCircle2 className="h-3 w-3 mr-1" />}
                  {filter === 'rejected' && <XCircle className="h-3 w-3 mr-1" />}
                  {filter === 'draft' && <FileText className="h-3 w-3 mr-1" />}
                  {getFilterLabel(filter)}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="grid gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-3 flex-1">
                    <Skeleton className="h-5 w-5" />
                    <div className="space-y-2 flex-1">
                      <Skeleton className="h-5 w-48" />
                      <Skeleton className="h-4 w-32" />
                    </div>
                  </div>
                  <Skeleton className="h-6 w-20" />
                </div>
              </CardHeader>
              <CardContent>
                <Skeleton className="h-4 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : inspections.length === 0 ? (
        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Clipboard className="h-16 w-16 text-slate-400 mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">No inspections yet</h3>
            <p className="text-slate-600 dark:text-slate-400 mb-4">
              Create your first vehicle inspection
            </p>
            <Link href="/inspections/new">
              <Button className="bg-inspection hover:bg-inspection-dark text-white transition-all duration-200 active:scale-95">
                <Plus className="h-4 w-4 mr-2" />
                Create Inspection
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {inspections.map((inspection) => (
            <Card 
              key={inspection.id} 
              className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:shadow-lg hover:border-inspection/50 transition-all duration-200 cursor-pointer"
              onClick={() => {
                // Draft inspections open in the new/edit page, others in view page
                if (inspection.status === 'draft') {
                  router.push(`/inspections/new?id=${inspection.id}`);
                } else {
                  router.push(`/inspections/${inspection.id}`);
                }
              }}
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-3">
                    {getStatusIcon(inspection.status)}
                    <div>
                      <CardTitle className="text-lg text-slate-900 dark:text-white">
                        {inspection.vehicles?.reg_number || 'Unknown Vehicle'}
                      </CardTitle>
                      <CardDescription className="text-slate-600 dark:text-slate-400">
                        {isManager && (inspection as any).profile?.full_name && (
                          <span className="font-medium text-slate-900 dark:text-white">
                            {(inspection as any).profile.full_name}
                            {' • '}
                          </span>
                        )}
                        {inspection.vehicles?.vehicle_type && `${inspection.vehicles.vehicle_type} • `}
                        {inspection.inspection_end_date && inspection.inspection_end_date !== inspection.inspection_date
                          ? `${formatDate(inspection.inspection_date)} - ${formatDate(inspection.inspection_end_date)}`
                          : formatDate(inspection.inspection_date)
                        }
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getStatusBadge(inspection.status)}
                    {isManager && (
                      <Button
                        onClick={(e) => openDeleteDialog(e, inspection)}
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
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
                  <div className="text-slate-600 dark:text-slate-400">
                    {inspection.submitted_at
                      ? `Submitted ${formatDate(inspection.submitted_at)}`
                      : 'Not yet submitted'}
                  </div>
                  {inspection.status === 'rejected' && inspection.manager_comments && (
                    <div className="text-red-600 text-xs">
                      See manager comments
                    </div>
                  )}
                  {/* Download PDF Button for Approved/Pending */}
                  {(inspection.status === 'approved' || inspection.status === 'submitted') && (
                    <Button
                      onClick={(e) => handleDownloadPDF(e, inspection.id)}
                      disabled={downloading === inspection.id}
                      variant="outline"
                      size="sm"
                      className="bg-white dark:bg-slate-900 border-inspection text-inspection hover:bg-inspection hover:text-white transition-all duration-200"
                    >
                      <Download className="h-4 w-4 mr-2" />
                      {downloading === inspection.id ? 'Downloading...' : 'Download PDF'}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Inspection</AlertDialogTitle>
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
