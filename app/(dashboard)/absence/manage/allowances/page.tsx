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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Users, Edit, ArrowLeft, Search } from 'lucide-react';
import { useUpdateEmployeeAllowance, useAbsenceSummaryForEmployee } from '@/lib/hooks/useAbsence';
import { getCurrentFinancialYear } from '@/lib/utils/date';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import Link from 'next/link';

interface Profile {
  id: string;
  full_name: string;
  employee_id: string | null;
  annual_holiday_allowance_days: number | null;
}

export default function AllowancesPage() {
  const { isAdmin, loading: authLoading } = useAuth();
  const router = useRouter();
  const supabase = createClient();
  
  // Data
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [filteredProfiles, setFilteredProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Mutation
  const updateAllowance = useUpdateEmployeeAllowance();
  
  // Dialog state
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [newAllowance, setNewAllowance] = useState('');
  const [submitting, setSubmitting] = useState(false);
  
  // Check admin access
  useEffect(() => {
    if (!authLoading && !isAdmin) {
      router.push('/dashboard');
    }
  }, [isAdmin, authLoading, router]);
  
  // Fetch profiles
  useEffect(() => {
    async function fetchProfiles() {
      setLoading(true);
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, employee_id, annual_holiday_allowance_days')
        .order('full_name');
      
      if (error) {
        console.error('Error fetching profiles:', error);
        toast.error('Failed to load employees');
      } else {
        setProfiles(data || []);
        setFilteredProfiles(data || []);
      }
      
      setLoading(false);
    }
    
    if (isAdmin) {
      fetchProfiles();
    }
  }, [supabase, isAdmin]);
  
  // Filter profiles by search term
  useEffect(() => {
    if (!searchTerm.trim()) {
      setFilteredProfiles(profiles);
    } else {
      const term = searchTerm.toLowerCase();
      setFilteredProfiles(
        profiles.filter(
          p =>
            p.full_name.toLowerCase().includes(term) ||
            p.employee_id?.toLowerCase().includes(term)
        )
      );
    }
  }, [searchTerm, profiles]);
  
  // Handle edit
  function handleEditClick(profile: Profile) {
    setEditingProfile(profile);
    setNewAllowance(String(profile.annual_holiday_allowance_days || 28));
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
      
      // Refresh profiles
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, employee_id, annual_holiday_allowance_days')
        .order('full_name');
      
      if (!error && data) {
        setProfiles(data);
      }
      
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
  
  const financialYear = getCurrentFinancialYear();
  
  if (authLoading || loading) {
    return (
      <div className="space-y-6 max-w-6xl">
        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
          <CardContent className="flex items-center justify-center py-12">
            <p className="text-slate-400">Loading...</p>
          </CardContent>
        </Card>
      </div>
    );
  }
  
  if (!isAdmin) return null;
  
  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-slate-200 dark:border-slate-700">
        <div>
          <Link href="/absence/manage" className="inline-flex items-center gap-2 text-slate-400 hover:text-white mb-2">
            <ArrowLeft className="h-4 w-4" />
            Back to Absence Management
          </Link>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
            Employee Allowances
          </h1>
          <p className="text-slate-600 dark:text-slate-400">
            Manage annual leave allowances for all employees ({financialYear.label})
          </p>
        </div>
      </div>
      
      {/* Search */}
      <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
        <CardContent className="pt-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by name or employee ID..."
              className="pl-10 bg-white dark:bg-slate-900 border-slate-600"
            />
          </div>
        </CardContent>
      </Card>
      
      {/* Allowances Table */}
      <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-slate-900 dark:text-white">
            <Users className="h-5 w-5" />
            Employees
          </CardTitle>
          <CardDescription className="text-slate-400">
            {filteredProfiles.length} employees {searchTerm && `(filtered from ${profiles.length})`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {filteredProfiles.length === 0 ? (
            <div className="text-center py-12">
              <Users className="h-16 w-16 text-slate-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-white mb-2">No employees found</h3>
              <p className="text-slate-400">Try adjusting your search</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredProfiles.map(profile => (
                <AllowanceRow
                  key={profile.id}
                  profile={profile}
                  onEdit={() => handleEditClick(profile)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      
      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="bg-slate-900 border-slate-700">
          <DialogHeader>
            <DialogTitle className="text-white">Edit Allowance</DialogTitle>
            <DialogDescription className="text-slate-400">
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
                className="bg-slate-900 border-slate-600"
              />
              <p className="text-xs text-slate-400 mt-1">
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
              className="border-slate-600 text-slate-300"
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpdate}
              disabled={submitting}
              className="bg-purple-500 hover:bg-purple-600 text-white"
            >
              {submitting ? 'Updating...' : 'Update'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// AllowanceRow component to show employee summary
function AllowanceRow({ profile, onEdit }: { profile: Profile; onEdit: () => void }) {
  const { data: summary, isLoading } = useAbsenceSummaryForEmployee(profile.id);
  
  return (
    <div className="p-4 rounded-lg bg-slate-800/30 border border-slate-700/50 hover:border-slate-600 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="font-semibold text-white text-lg">
              {profile.full_name}
            </h3>
            {profile.employee_id && (
              <Badge variant="outline" className="border-slate-600 text-slate-400">
                {profile.employee_id}
              </Badge>
            )}
          </div>
          
          {isLoading ? (
            <p className="text-sm text-slate-400">Loading summary...</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-slate-500 mb-1">Allowance</p>
                <p className="text-white font-semibold text-lg">{summary?.allowance || 28} days</p>
              </div>
              <div>
                <p className="text-slate-500 mb-1">Approved Taken</p>
                <p className="text-white font-semibold text-lg">{summary?.approved_taken || 0} days</p>
              </div>
              <div>
                <p className="text-slate-500 mb-1">Pending</p>
                <p className="text-amber-400 font-semibold text-lg">{summary?.pending_total || 0} days</p>
              </div>
              <div>
                <p className="text-slate-500 mb-1">Remaining</p>
                <p className={`font-semibold text-lg ${(summary?.remaining || 0) < 0 ? 'text-red-400' : 'text-green-400'}`}>
                  {summary?.remaining || 0} days
                </p>
              </div>
            </div>
          )}
        </div>
        
        <Button
          variant="outline"
          size="sm"
          onClick={onEdit}
          className="border-slate-600 text-slate-300"
        >
          <Edit className="h-4 w-4 mr-2" />
          Edit
        </Button>
      </div>
    </div>
  );
}

