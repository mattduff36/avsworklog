'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { 
  AlertTriangle, 
  Loader2, 
  Search,
  CheckCircle2,
  XCircle,
  Eye,
  User,
  Clock
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import type { 
  ErrorReportWithUser, 
  ErrorReportStatus, 
  ErrorReportUpdateWithUser 
} from '@/types/error-reports';
import { 
  ERROR_REPORT_STATUS_LABELS, 
  ERROR_REPORT_STATUS_COLORS 
} from '@/types/error-reports';

export default function ErrorReportsManagePage() {
  const router = useRouter();
  const { isManager, isAdmin, loading: authLoading } = useAuth();
  
  const [reports, setReports] = useState<ErrorReportWithUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [counts, setCounts] = useState<Record<string, number>>({});
  
  // Detail dialog
  const [selectedReport, setSelectedReport] = useState<ErrorReportWithUser | null>(null);
  const [reportUpdates, setReportUpdates] = useState<ErrorReportUpdateWithUser[]>([]);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  
  // Update form
  const [newStatus, setNewStatus] = useState<ErrorReportStatus | ''>('');
  const [adminNote, setAdminNote] = useState('');
  const [updateNote, setUpdateNote] = useState('');
  const [updating, setUpdating] = useState(false);


  // Redirect non-admins
  useEffect(() => {
    if (!authLoading && !isAdmin) {
      router.push('/dashboard');
    }
  }, [authLoading, isAdmin, router]);

  const fetchReports = useCallback(async (filter: string) => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (filter !== 'all') {
        params.set('status', filter);
      }
      
      const response = await fetch(`/api/management/error-reports?${params}`);
      const data = await response.json();
      
      if (data.success) {
        setReports(data.reports);
        setCounts(data.counts);
      } else {
        throw new Error(data.error || 'Failed to fetch error reports');
      }
    } catch (error) {
      console.error('Error fetching error reports:', error);
      toast.error('Failed to load error reports');
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch reports
  useEffect(() => {
    if (isAdmin) {
      fetchReports(statusFilter);
    }
  }, [statusFilter, isAdmin, fetchReports]);

  const openDetailDialog = async (report: ErrorReportWithUser) => {
    setSelectedReport(report);
    setNewStatus(report.status);
    setAdminNote(report.admin_notes || '');
    setUpdateNote('');
    setDetailDialogOpen(true);
    
    // Fetch update history
    try {
      setLoadingDetail(true);
      const response = await fetch(`/api/management/error-reports/${report.id}`);
      const data = await response.json();
      
      if (data.success) {
        setReportUpdates(data.updates || []);
      }
    } catch (error) {
      console.error('Error fetching report details:', error);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleUpdateReport = async () => {
    if (!selectedReport) return;
    
    try {
      setUpdating(true);
      
      const response = await fetch(`/api/management/error-reports/${selectedReport.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: newStatus || undefined,
          admin_notes: adminNote || undefined,
          note: updateNote || undefined,
        }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        toast.success('Error report updated');
        setDetailDialogOpen(false);
        fetchReports(statusFilter);
      } else {
        throw new Error(data.error || 'Failed to update error report');
      }
    } catch (error) {
      console.error('Error updating report:', error);
      toast.error('Failed to update error report');
    } finally {
      setUpdating(false);
    }
  };

  // Filter reports by search
  const filteredReports = reports.filter(r => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      r.title.toLowerCase().includes(query) ||
      r.description.toLowerCase().includes(query) ||
      r.user?.full_name?.toLowerCase().includes(query) ||
      r.error_code?.toLowerCase().includes(query)
    );
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'new': return <AlertTriangle className="h-4 w-4" />;
      case 'investigating': return <Eye className="h-4 w-4" />;
      case 'resolved': return <CheckCircle2 className="h-4 w-4" />;
      default: return <Clock className="h-4 w-4" />;
    }
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-red-500" />
      </div>
    );
  }

  if (!isAdmin) {
    return null;
  }

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-border">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-red-100 dark:bg-red-950 rounded-lg">
            <AlertTriangle className="h-6 w-6 text-red-600" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">
              Manage Error Reports
            </h1>
            <p className="text-muted-foreground">
              Review and resolve user-reported errors
            </p>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { key: 'all', label: 'All', color: 'bg-slate-500' },
          { key: 'new', label: 'New', color: 'bg-red-500' },
          { key: 'investigating', label: 'Investigating', color: 'bg-yellow-500' },
          { key: 'resolved', label: 'Resolved', color: 'bg-green-500' },
        ].map(({ key, label, color }) => (
          <Card 
            key={key}
            className={`cursor-pointer transition-all ${
              statusFilter === key ? 'ring-2 ring-red-500 bg-white/10' : ''
            } bg-white dark:bg-slate-900 border-border`}
            onClick={() => setStatusFilter(key)}
          >
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-2xl font-bold text-foreground">
                    {counts[key] || 0}
                  </p>
                </div>
                <div className={`h-3 w-3 rounded-full ${color}`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search */}
      <Card className="">
        <CardContent className="pt-4">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search error reports..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-slate-50 dark:bg-slate-800 dark:text-slate-100 text-slate-900"
            />
          </div>
        </CardContent>
      </Card>

      {/* Error Reports List */}
      <Card className="">
        <CardHeader>
          <CardTitle className="text-foreground">
            Error Reports
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {filteredReports.length} report{filteredReports.length !== 1 ? 's' : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-red-500" />
            </div>
          ) : filteredReports.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p>No error reports found</p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredReports.map((report) => (
                <div
                  key={report.id}
                  className="p-4 rounded-lg border border-border bg-slate-50 dark:bg-slate-800 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                  onClick={() => openDetailDialog(report)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-medium text-foreground truncate">
                          {report.title}
                        </h3>
                        <Badge className={`${ERROR_REPORT_STATUS_COLORS[report.status]} text-white shrink-0`}>
                          {getStatusIcon(report.status)}
                          <span className="ml-1">{ERROR_REPORT_STATUS_LABELS[report.status]}</span>
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground dark:text-muted-foreground line-clamp-2">
                        {report.description}
                      </p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {report.user?.full_name || 'Unknown'}
                        </span>
                        <span>
                          {formatDistanceToNow(new Date(report.created_at), { addSuffix: true })}
                        </span>
                        {report.error_code && (
                          <code className="text-muted-foreground bg-slate-200 dark:bg-slate-700 px-2 py-0.5 rounded">
                            {report.error_code}
                          </code>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto bg-white dark:bg-slate-900 border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              Error Report Details
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Review and update this error report
            </DialogDescription>
          </DialogHeader>
          
          {selectedReport && (
            <div className="space-y-4">
              {/* Report Info */}
              <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-800 space-y-3">
                <div className="flex items-start justify-between">
                  <h3 className="font-semibold text-foreground">
                    {selectedReport.title}
                  </h3>
                  <Badge className={`${ERROR_REPORT_STATUS_COLORS[selectedReport.status]} text-white`}>
                    {ERROR_REPORT_STATUS_LABELS[selectedReport.status]}
                  </Badge>
                </div>
                <p className="text-sm text-slate-600 dark:text-muted-foreground whitespace-pre-wrap">
                  {selectedReport.description}
                </p>
                <div className="space-y-2 pt-2 border-t border-border">
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>From: {selectedReport.user?.full_name || 'Unknown'}</span>
                    <span>{new Date(selectedReport.created_at).toLocaleString()}</span>
                  </div>
                  {selectedReport.error_code && (
                    <div className="text-xs">
                      <span className="text-muted-foreground">Error Code: </span>
                      <code className="text-foreground bg-slate-200 dark:bg-slate-700 px-2 py-0.5 rounded">
                        {selectedReport.error_code}
                      </code>
                    </div>
                  )}
                  {selectedReport.page_url && (
                    <div className="text-xs">
                      <span className="text-muted-foreground">Page: </span>
                      <a 
                        href={selectedReport.page_url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        {selectedReport.page_url}
                      </a>
                    </div>
                  )}
                  {selectedReport.user_agent && (
                    <div className="text-xs text-muted-foreground">
                      User Agent: {selectedReport.user_agent}
                    </div>
                  )}
                  {selectedReport.additional_context && (
                    <div className="text-xs">
                      <span className="text-muted-foreground">Additional Context:</span>
                      <pre className="mt-1 p-2 bg-slate-200 dark:bg-slate-700 rounded text-xs overflow-x-auto">
                        {JSON.stringify(selectedReport.additional_context, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </div>

              {/* Update Form */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-slate-700 dark:text-muted-foreground">Status</Label>
                  <Select value={newStatus} onValueChange={(v) => setNewStatus(v as ErrorReportStatus)}>
                    <SelectTrigger className="bg-slate-50 dark:bg-slate-800 dark:text-slate-100 text-slate-900">
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">New</SelectItem>
                      <SelectItem value="investigating">Investigating</SelectItem>
                      <SelectItem value="resolved">Resolved</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-700 dark:text-muted-foreground">
                    Internal Notes (not visible to reporter)
                  </Label>
                  <Textarea
                    value={adminNote}
                    onChange={(e) => setAdminNote(e.target.value)}
                    placeholder="Add internal notes about this error..."
                    rows={3}
                    className="bg-slate-50 dark:bg-slate-800 dark:text-slate-100 text-slate-900"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-700 dark:text-muted-foreground">
                    Update Note (for history)
                  </Label>
                  <Input
                    value={updateNote}
                    onChange={(e) => setUpdateNote(e.target.value)}
                    placeholder="Brief note about this update..."
                    className="bg-slate-50 dark:bg-slate-800 dark:text-slate-100 text-slate-900"
                  />
                </div>
              </div>

              {/* Update History */}
              {loadingDetail ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-red-500" />
                </div>
              ) : reportUpdates.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-slate-700 dark:text-muted-foreground">History</Label>
                  <div className="max-h-32 overflow-y-auto space-y-2">
                    {reportUpdates.map((update) => (
                      <div 
                        key={update.id}
                        className="text-xs p-2 rounded bg-slate-100 dark:bg-slate-700"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">
                            {update.old_status && update.new_status ? (
                              <>
                                {ERROR_REPORT_STATUS_LABELS[update.old_status as ErrorReportStatus]} → {ERROR_REPORT_STATUS_LABELS[update.new_status as ErrorReportStatus]}
                              </>
                            ) : (
                              'Note added'
                            )}
                          </span>
                          <span className="text-muted-foreground">
                            {new Date(update.created_at).toLocaleDateString()}
                          </span>
                        </div>
                        {update.note && (
                          <p className="text-slate-600 dark:text-muted-foreground mt-1">
                            {update.note}
                          </p>
                        )}
                        <p className="text-muted-foreground mt-1">
                          by {update.user?.full_name || 'Unknown'}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDetailDialogOpen(false)}
              className="border-border"
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpdateReport}
              disabled={updating}
              className="bg-red-600 hover:bg-red-700"
            >
              {updating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
