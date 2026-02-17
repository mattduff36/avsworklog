'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Save, Users, X, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import type { MaintenanceCategory } from '@/types/maintenance';

interface Profile {
  id: string;
  full_name: string | null;
  role: {
    name: string;
    is_manager_admin: boolean;
  } | null;
}

interface CategoryRecipientsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category: MaintenanceCategory;
}

export function CategoryRecipientsDialog({
  open,
  onOpenChange,
  category,
}: CategoryRecipientsDialogProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  
  // Fetch profiles and current recipients when dialog opens
  useEffect(() => {
    if (open) {
      const fetchData = async () => {
        setLoading(true);
        const supabase = createClient();
        
        try {
          // Fetch all profiles (managers/admins primarily)
          const { data: profilesData, error: profilesError } = await supabase
            .from('profiles')
            .select(`
              id,
              full_name,
              role:roles(name, is_manager_admin)
            `)
            .order('full_name');
          
          if (profilesError) throw profilesError;
          
          // Fetch current recipients for this category
          const { data: recipientsData, error: recipientsError } = await supabase
            .from('maintenance_category_recipients')
            .select('user_id')
            .eq('category_id', category.id);
          
          if (recipientsError) throw recipientsError;
          
          setProfiles(profilesData || []);
          setSelectedUserIds(new Set(recipientsData?.map(r => r.user_id) || []));
        } catch (error) {
          console.error('Error fetching data:', error);
          toast.error('Failed to load recipients');
        } finally {
          setLoading(false);
        }
      };
      fetchData();
    }
  }, [open, category.id]);
  
  const handleToggleUser = (userId: string) => {
    const newSelected = new Set(selectedUserIds);
    if (newSelected.has(userId)) {
      newSelected.delete(userId);
    } else {
      newSelected.add(userId);
    }
    setSelectedUserIds(newSelected);
  };
  
  const handleSave = async () => {
    setSaving(true);
    
    try {
      const response = await fetch(`/api/maintenance/categories/${category.id}/recipients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_ids: Array.from(selectedUserIds),
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save recipients');
      }
      
      toast.success('Recipients updated', {
        description: `${data.count} user(s) will receive reminders for ${category.name}`,
      });
      
      onOpenChange(false);
    } catch (error) {
      console.error('Error saving recipients:', error);
      toast.error('Failed to save recipients', {
        description: error instanceof Error ? error.message : 'Please try again',
      });
    } finally {
      setSaving(false);
    }
  };
  
  const handleSelectAllManagers = () => {
    const managerIds = profiles
      .filter(p => p.role?.is_manager_admin || p.role?.name === 'admin' || p.role?.name === 'manager')
      .map(p => p.id);
    setSelectedUserIds(new Set([...selectedUserIds, ...managerIds]));
  };
  
  const handleClearAll = () => {
    setSelectedUserIds(new Set());
  };
  
  // Filter profiles by search query
  const filteredProfiles = profiles.filter(p => {
    const name = p.full_name?.toLowerCase() || '';
    const query = searchQuery.toLowerCase();
    return name.includes(query);
  });
  
  // Sort to show managers first, then by name
  const sortedProfiles = [...filteredProfiles].sort((a, b) => {
    const aIsManager = a.role?.is_manager_admin || a.role?.name === 'admin' || a.role?.name === 'manager';
    const bIsManager = b.role?.is_manager_admin || b.role?.name === 'admin' || b.role?.name === 'manager';
    
    if (aIsManager && !bIsManager) return -1;
    if (!aIsManager && bIsManager) return 1;
    
    return (a.full_name || '').localeCompare(b.full_name || '');
  });
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border text-white max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl flex items-center gap-2">
            <Users className="h-5 w-5" />
            Reminder Recipients
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Select users who should receive reminders for <strong>{category.name}</strong>
          </DialogDescription>
        </DialogHeader>
        
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search users..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 bg-input border-border text-white"
              />
            </div>
            
            {/* Quick actions */}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleSelectAllManagers}
                className="text-xs border-slate-600 hover:bg-slate-800"
              >
                Select All Managers
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleClearAll}
                className="text-xs border-slate-600 hover:bg-slate-800"
              >
                <X className="h-3 w-3 mr-1" />
                Clear All
              </Button>
            </div>
            
            {/* User list */}
            <ScrollArea className="h-[300px] border border-slate-700 rounded-lg">
              <div className="p-2 space-y-1">
                {sortedProfiles.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-8">
                    No users found
                  </p>
                ) : (
                  sortedProfiles.map((profile) => {
                    const isManager = profile.role?.is_manager_admin || 
                                     profile.role?.name === 'admin' || 
                                     profile.role?.name === 'manager';
                    const isSelected = selectedUserIds.has(profile.id);
                    
                    return (
                      <div
                        key={profile.id}
                        className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors ${
                          isSelected 
                            ? 'bg-blue-600/20 border border-blue-500/30' 
                            : 'hover:bg-slate-800 border border-transparent'
                        }`}
                        onClick={() => handleToggleUser(profile.id)}
                      >
                        <div className="flex items-center gap-3">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => handleToggleUser(profile.id)}
                            className="data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
                          />
                          <div>
                            <p className="text-sm font-medium text-white">
                              {profile.full_name || 'Unknown User'}
                            </p>
                            {profile.role && (
                              <p className="text-xs text-slate-400 capitalize">
                                {profile.role.name}
                              </p>
                            )}
                          </div>
                        </div>
                        {isManager && (
                          <Badge variant="outline" className="text-xs text-amber-400 border-amber-400/50">
                            Manager
                          </Badge>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </ScrollArea>
            
            {/* Selected count */}
            <p className="text-sm text-muted-foreground">
              {selectedUserIds.size} user{selectedUserIds.size !== 1 ? 's' : ''} selected
            </p>
          </div>
        )}
        
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="border-slate-600 text-white hover:bg-slate-800"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={loading || saving}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Save Recipients
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
