'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Calendar, Plus, Filter, Edit, Trash2, Settings, Users } from 'lucide-react';
import { 
  useAllAbsences, 
  useAllAbsenceReasons,
  useCreateAbsence,
  useDeleteAbsence,
  useApproveAbsence 
} from '@/lib/hooks/useAbsence';
import { formatDate, formatDateISO, calculateDurationDays, getCurrentFinancialYear } from '@/lib/utils/date';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import Link from 'next/link';

export default function AdminAbsencePage() {
  const { isAdmin, isManager, loading: authLoading } = useAuth();
  const router = useRouter();
  const supabase = createClient();
  
  // Filters
  const [profileId, setProfileId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [reasonId, setReasonId] = useState('');
  const [status, setStatus] = useState('');
  
  // Data
  const { data: absences, isLoading } = useAllAbsences({ 
    profileId, 
    dateFrom, 
    dateTo, 
    reasonId, 
    status 
  });
  const { data: reasons } = useAllAbsenceReasons();
  const [profiles, setProfiles] = useState<Array<{ id: string; full_name: string; employee_id: string | null }>>([]);
  
  // Mutations
  const createAbsence = useCreateAbsence();
  const deleteAbsence = useDeleteAbsence();
  const approveAbsence = useApproveAbsence();
  
  // Dialog state
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [selectedReasonId, setSelectedReasonId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isHalfDay, setIsHalfDay] = useState(false);
  const [halfDaySession, setHalfDaySession] = useState<'AM' | 'PM'>('AM');
  const [notes, setNotes] = useState('');
  const [autoApprove, setAutoApprove] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  
  // Check admin/manager access
  useEffect(() => {
    if (!authLoading && !isAdmin && !isManager) {
      router.push('/dashboard');
    }
  }, [isAdmin, isManager, authLoading, router]);
  
  // Fetch profiles
  useEffect(() => {
    async function fetchProfiles() {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, employee_id')
        .order('full_name');
      
      if (error) {
        console.error('Error fetching profiles:', error);
        return;
      }
      
      setProfiles(data || []);
    }
    
    fetchProfiles();
  }, [supabase]);
  
  // Calculate duration
  const duration = startDate 
    ? calculateDurationDays(
        new Date(startDate),
        endDate ? new Date(endDate) : null,
        isHalfDay
      )
    : 0;
  
  // Handle create
  async function handleCreate() {
    if (!selectedProfileId || !selectedReasonId || !startDate) {
      toast.error('Please fill in all required fields');
      return;
    }
    
    setSubmitting(true);
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      
      const absence = await createAbsence.mutateAsync({
        profile_id: selectedProfileId,
        date: startDate,
        end_date: endDate || null,
        reason_id: selectedReasonId,
        duration_days: duration,
        is_half_day: isHalfDay,
        half_day_session: isHalfDay ? halfDaySession : null,
        notes: notes || null,
        status: autoApprove ? 'approved' : 'pending',
        created_by: user.id,
        approved_by: autoApprove ? user.id : null,
        approved_at: autoApprove ? new Date().toISOString() : null,
      });
      
      toast.success(`Absence ${autoApprove ? 'created and approved' : 'created'}`);
      
      // Reset form
      setSelectedProfileId('');
      setSelectedReasonId('');
      setStartDate('');
      setEndDate('');
      setIsHalfDay(false);
      setNotes('');
      setAutoApprove(false);
      setShowCreateDialog(false);
    } catch (error) {
      console.error('Error creating absence:', error);
      toast.error('Failed to create absence');
    } finally {
      setSubmitting(false);
    }
  }
  
  // Handle delete
  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this absence?')) return;
    
    try {
      await deleteAbsence.mutateAsync(id);
      toast.success('Absence deleted');
    } catch (error) {
      console.error('Error deleting:', error);
      toast.error('Failed to delete absence');
    }
  }
  
  const financialYear = getCurrentFinancialYear();
  
  if (authLoading || isLoading) {
    return (
      <div className="space-y-6 max-w-7xl">
        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
          <CardContent className="flex items-center justify-center py-12">
            <p className="text-slate-400">Loading...</p>
          </CardContent>
        </Card>
      </div>
    );
  }
  
  if (!isAdmin && !isManager) return null;
  
  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-slate-200 dark:border-slate-700">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
              Absence Management
            </h1>
            <p className="text-slate-600 dark:text-slate-400">
              View and manage all employee absences
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/admin/absence/reasons">
              <Button variant="outline" className="border-slate-600 text-slate-300">
                <Settings className="h-4 w-4 mr-2" />
                Manage Reasons
              </Button>
            </Link>
            <Link href="/admin/absence/allowances">
              <Button variant="outline" className="border-slate-600 text-slate-300">
                <Users className="h-4 w-4 mr-2" />
                Manage Allowances
              </Button>
            </Link>
            <Button
              onClick={() => setShowCreateDialog(true)}
              className="bg-red-500 hover:bg-red-600 text-white"
            >
              <Plus className="h-4 w-4 mr-2" />
              Create Absence
            </Button>
          </div>
        </div>
      </div>
      
      {/* Filters */}
      <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-slate-900 dark:text-white">
            <Filter className="h-5 w-5" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div>
              <Label>Employee</Label>
              <Select value={profileId} onValueChange={setProfileId}>
                <SelectTrigger className="bg-white dark:bg-slate-900 border-slate-600">
                  <SelectValue placeholder="All employees" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value=" ">All employees</SelectItem>
                  {profiles.map(profile => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.full_name} {profile.employee_id ? `(${profile.employee_id})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <Label>From Date</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="bg-white dark:bg-slate-900 border-slate-600"
              />
            </div>
            
            <div>
              <Label>To Date</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="bg-white dark:bg-slate-900 border-slate-600"
              />
            </div>
            
            <div>
              <Label>Reason</Label>
              <Select value={reasonId} onValueChange={setReasonId}>
                <SelectTrigger className="bg-white dark:bg-slate-900 border-slate-600">
                  <SelectValue placeholder="All reasons" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value=" ">All reasons</SelectItem>
                  {reasons?.map(reason => (
                    <SelectItem key={reason.id} value={reason.id}>
                      {reason.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="bg-white dark:bg-slate-900 border-slate-600">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value=" ">All statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          
          <div className="mt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setProfileId('');
                setDateFrom('');
                setDateTo('');
                setReasonId('');
                setStatus('');
              }}
              className="border-slate-600 text-slate-300"
            >
              Clear Filters
            </Button>
          </div>
        </CardContent>
      </Card>
      
      {/* Absences Table */}
      <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
        <CardHeader>
          <CardTitle className="text-slate-900 dark:text-white">
            Absence Records
          </CardTitle>
          <CardDescription className="text-slate-400">
            {absences?.length || 0} records found
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!absences || absences.length === 0 ? (
            <div className="text-center py-12">
              <Calendar className="h-16 w-16 text-slate-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-white mb-2">No absences found</h3>
              <p className="text-slate-400">Try adjusting your filters</p>
            </div>
          ) : (
            <div className="space-y-3">
              {absences.map(absence => (
                <div
                  key={absence.id}
                  className="p-4 rounded-lg bg-slate-800/30 border border-slate-700/50 hover:border-slate-600 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="font-semibold text-white">
                          {absence.profiles.full_name}
                          {absence.profiles.employee_id && ` (${absence.profiles.employee_id})`}
                        </h3>
                        <Badge variant="outline" className="border-slate-600 text-slate-300">
                          {absence.absence_reasons.name}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={
                            absence.status === 'approved'
                              ? 'border-green-500/30 text-green-400 bg-green-500/10'
                              : absence.status === 'pending'
                              ? 'border-amber-500/30 text-amber-400 bg-amber-500/10'
                              : absence.status === 'rejected'
                              ? 'border-red-500/30 text-red-400 bg-red-500/10'
                              : 'border-slate-600 text-slate-400'
                          }
                        >
                          {absence.status}
                        </Badge>
                        {absence.absence_reasons.is_paid ? (
                          <Badge variant="outline" className="border-blue-500/30 text-blue-400 bg-blue-500/10">
                            Paid
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-slate-600 text-slate-400">
                            Unpaid
                          </Badge>
                        )}
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-2 text-sm text-slate-400">
                        <div>
                          <span className="text-slate-500">Date:</span>{' '}
                          {absence.end_date && absence.date !== absence.end_date
                            ? `${formatDate(absence.date)} - ${formatDate(absence.end_date)}`
                            : formatDate(absence.date)
                          }
                          {absence.is_half_day && ` (${absence.half_day_session})`}
                        </div>
                        <div>
                          <span className="text-slate-500">Duration:</span> {absence.duration_days} days
                        </div>
                        <div>
                          <span className="text-slate-500">Created:</span> {formatDate(absence.created_at)}
                        </div>
                        {absence.approved_at && (
                          <div>
                            <span className="text-slate-500">Approved:</span> {formatDate(absence.approved_at)}
                          </div>
                        )}
                      </div>
                      
                      {absence.notes && (
                        <p className="text-sm text-slate-400 mt-2">
                          <span className="text-slate-500">Notes:</span> {absence.notes}
                        </p>
                      )}
                    </div>
                    
                    <div className="flex gap-2">
                      {absence.status === 'pending' && (
                        <Link href={`/approvals?tab=absences`}>
                          <Button
                            variant="outline"
                            size="sm"
                            className="border-green-500/30 text-green-400 hover:bg-green-500/10"
                          >
                            Review
                          </Button>
                        </Link>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDelete(absence.id)}
                        className="border-red-500/30 text-red-400 hover:bg-red-500/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      
      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="bg-slate-900 border-slate-700 max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-white">Create Absence Entry</DialogTitle>
            <DialogDescription className="text-slate-400">
              Create an absence entry for any employee
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div>
              <Label>Employee *</Label>
              <Select value={selectedProfileId} onValueChange={setSelectedProfileId}>
                <SelectTrigger className="bg-slate-900 border-slate-600">
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map(profile => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.full_name} {profile.employee_id ? `(${profile.employee_id})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <Label>Reason *</Label>
              <Select value={selectedReasonId} onValueChange={setSelectedReasonId}>
                <SelectTrigger className="bg-slate-900 border-slate-600">
                  <SelectValue placeholder="Select reason" />
                </SelectTrigger>
                <SelectContent>
                  {reasons?.filter(r => r.is_active).map(reason => (
                    <SelectItem key={reason.id} value={reason.id}>
                      {reason.name} ({reason.is_paid ? 'Paid' : 'Unpaid'})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Start Date *</Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    if (endDate && endDate < e.target.value) {
                      setEndDate('');
                    }
                  }}
                  className="bg-slate-900 border-slate-600"
                />
              </div>
              
              <div>
                <Label>End Date (optional)</Label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate}
                  disabled={!startDate || isHalfDay}
                  className="bg-slate-900 border-slate-600"
                />
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isHalfDay}
                  onChange={(e) => {
                    setIsHalfDay(e.target.checked);
                    if (e.target.checked) setEndDate('');
                  }}
                  className="rounded border-slate-600"
                />
                <span className="text-sm text-slate-300">Half Day</span>
              </label>
              
              {isHalfDay && (
                <div className="flex gap-2">
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      name="session"
                      value="AM"
                      checked={halfDaySession === 'AM'}
                      onChange={() => setHalfDaySession('AM')}
                    />
                    <span className="text-sm text-slate-300">AM</span>
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      name="session"
                      value="PM"
                      checked={halfDaySession === 'PM'}
                      onChange={() => setHalfDaySession('PM')}
                    />
                    <span className="text-sm text-slate-300">PM</span>
                  </label>
                </div>
              )}
            </div>
            
            <div>
              <Label>Notes</Label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes..."
                className="bg-slate-900 border-slate-600"
              />
            </div>
            
            <div className="flex items-center gap-2 p-3 bg-slate-800/50 rounded-lg">
              <input
                type="checkbox"
                id="autoApprove"
                checked={autoApprove}
                onChange={(e) => setAutoApprove(e.target.checked)}
                className="rounded border-slate-600"
              />
              <label htmlFor="autoApprove" className="text-sm text-slate-300 cursor-pointer">
                Auto-approve (mark as approved immediately)
              </label>
            </div>
            
            {startDate && (
              <div className="bg-slate-800/30 p-3 rounded-lg">
                <p className="text-sm text-slate-400">
                  Duration: <span className="text-white font-medium">{duration} days</span>
                </p>
              </div>
            )}
          </div>
          
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCreateDialog(false)}
              className="border-slate-600 text-slate-300"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={submitting || !selectedProfileId || !selectedReasonId || !startDate}
              className="bg-red-500 hover:bg-red-600 text-white"
            >
              {submitting ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

