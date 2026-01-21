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
  Lightbulb, 
  Loader2, 
  Search,
  MessageSquare,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  User
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import type { SuggestionWithUser, SuggestionStatus, SuggestionUpdateWithUser } from '@/types/faq';
import { SUGGESTION_STATUS_LABELS, SUGGESTION_STATUS_COLORS } from '@/types/faq';

export default function SuggestionsManagePage() {
  const router = useRouter();
  const { isManager, isAdmin, loading: authLoading } = useAuth();
  
  const [suggestions, setSuggestions] = useState<SuggestionWithUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [counts, setCounts] = useState<Record<string, number>>({});
  
  // Detail dialog
  const [selectedSuggestion, setSelectedSuggestion] = useState<SuggestionWithUser | null>(null);
  const [suggestionUpdates, setSuggestionUpdates] = useState<SuggestionUpdateWithUser[]>([]);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  
  // Update form
  const [newStatus, setNewStatus] = useState<SuggestionStatus | ''>('');
  const [adminNote, setAdminNote] = useState('');
  const [updateNote, setUpdateNote] = useState('');
  const [updating, setUpdating] = useState(false);

  // Redirect non-managers
  useEffect(() => {
    if (!authLoading && !isManager && !isAdmin) {
      router.push('/dashboard');
    }
  }, [authLoading, isManager, isAdmin, router]);

  const fetchSuggestions = useCallback(async (filter: string) => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (filter !== 'all') {
        params.set('status', filter);
      }
      
      const response = await fetch(`/api/management/suggestions?${params}`);
      const data = await response.json();
      
      if (data.success) {
        setSuggestions(data.suggestions);
        setCounts(data.counts);
      } else {
        throw new Error(data.error || 'Failed to fetch suggestions');
      }
    } catch (error) {
      console.error('Error fetching suggestions:', error);
      toast.error('Failed to load suggestions');
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch suggestions
  useEffect(() => {
    if (isManager || isAdmin) {
      fetchSuggestions(statusFilter);
    }
  }, [statusFilter, isManager, isAdmin, fetchSuggestions]);

  const openDetailDialog = async (suggestion: SuggestionWithUser) => {
    setSelectedSuggestion(suggestion);
    setNewStatus(suggestion.status);
    setAdminNote(suggestion.admin_notes || '');
    setUpdateNote('');
    setDetailDialogOpen(true);
    
    // Fetch update history
    try {
      setLoadingDetail(true);
      const response = await fetch(`/api/management/suggestions/${suggestion.id}`);
      const data = await response.json();
      
      if (data.success) {
        setSuggestionUpdates(data.updates || []);
      }
    } catch (error) {
      console.error('Error fetching suggestion details:', error);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleUpdateSuggestion = async () => {
    if (!selectedSuggestion) return;
    
    try {
      setUpdating(true);
      
      const response = await fetch(`/api/management/suggestions/${selectedSuggestion.id}`, {
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
        toast.success('Suggestion updated');
        setDetailDialogOpen(false);
        fetchSuggestions(statusFilter);
      } else {
        throw new Error(data.error || 'Failed to update suggestion');
      }
    } catch (error) {
      console.error('Error updating suggestion:', error);
      toast.error('Failed to update suggestion');
    } finally {
      setUpdating(false);
    }
  };

  // Filter suggestions by search
  const filteredSuggestions = suggestions.filter(s => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      s.title.toLowerCase().includes(query) ||
      s.body.toLowerCase().includes(query) ||
      s.user?.full_name?.toLowerCase().includes(query)
    );
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'new': return <Clock className="h-4 w-4" />;
      case 'under_review': return <AlertTriangle className="h-4 w-4" />;
      case 'planned': return <MessageSquare className="h-4 w-4" />;
      case 'completed': return <CheckCircle2 className="h-4 w-4" />;
      case 'declined': return <XCircle className="h-4 w-4" />;
      default: return <Clock className="h-4 w-4" />;
    }
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!isManager && !isAdmin) {
    return null;
  }

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-border">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-yellow-100 dark:bg-yellow-950 rounded-lg">
            <Lightbulb className="h-6 w-6 text-yellow-600" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">
              Manage Suggestions
            </h1>
            <p className="text-muted-foreground">
              Review and respond to user suggestions
            </p>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        {[
          { key: 'all', label: 'All', color: 'bg-slate-500' },
          { key: 'new', label: 'New', color: 'bg-blue-500' },
          { key: 'under_review', label: 'Reviewing', color: 'bg-yellow-500' },
          { key: 'planned', label: 'Planned', color: 'bg-purple-500' },
          { key: 'completed', label: 'Done', color: 'bg-green-500' },
          { key: 'declined', label: 'Declined', color: 'bg-slate-400' },
        ].map(({ key, label, color }) => (
          <Card 
            key={key}
            className={`cursor-pointer transition-all ${
              statusFilter === key ? 'ring-2 ring-yellow-500' : ''
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
              placeholder="Search suggestions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-slate-50 dark:bg-slate-800 dark:text-slate-100 text-slate-900"
            />
          </div>
        </CardContent>
      </Card>

      {/* Suggestions List */}
      <Card className="">
        <CardHeader>
          <CardTitle className="text-foreground">
            Suggestions
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {filteredSuggestions.length} suggestion{filteredSuggestions.length !== 1 ? 's' : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
            </div>
          ) : filteredSuggestions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Lightbulb className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p>No suggestions found</p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredSuggestions.map((suggestion) => (
                <div
                  key={suggestion.id}
                  className="p-4 rounded-lg border border-border bg-slate-50 dark:bg-slate-800 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                  onClick={() => openDetailDialog(suggestion)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-medium text-foreground truncate">
                          {suggestion.title}
                        </h3>
                        <Badge className={`${SUGGESTION_STATUS_COLORS[suggestion.status]} text-white shrink-0`}>
                          {getStatusIcon(suggestion.status)}
                          <span className="ml-1">{SUGGESTION_STATUS_LABELS[suggestion.status]}</span>
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground dark:text-muted-foreground line-clamp-2">
                        {suggestion.body}
                      </p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {suggestion.user?.full_name || 'Unknown'}
                        </span>
                        <span>
                          {formatDistanceToNow(new Date(suggestion.created_at), { addSuffix: true })}
                        </span>
                        {suggestion.page_hint && (
                          <span className="text-muted-foreground">
                            Related to: {suggestion.page_hint}
                          </span>
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
        <DialogContent className="max-w-2xl bg-white dark:bg-slate-900 border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              Suggestion Details
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Review and update this suggestion
            </DialogDescription>
          </DialogHeader>
          
          {selectedSuggestion && (
            <div className="space-y-4">
              {/* Suggestion Info */}
              <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-800 space-y-3">
                <div className="flex items-start justify-between">
                  <h3 className="font-semibold text-foreground">
                    {selectedSuggestion.title}
                  </h3>
                  <Badge className={`${SUGGESTION_STATUS_COLORS[selectedSuggestion.status]} text-white`}>
                    {SUGGESTION_STATUS_LABELS[selectedSuggestion.status]}
                  </Badge>
                </div>
                <p className="text-sm text-slate-600 dark:text-muted-foreground whitespace-pre-wrap">
                  {selectedSuggestion.body}
                </p>
                <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2 border-t border-border">
                  <span>From: {selectedSuggestion.user?.full_name || 'Unknown'}</span>
                  <span>{new Date(selectedSuggestion.created_at).toLocaleString()}</span>
                  {selectedSuggestion.page_hint && (
                    <span>Related to: {selectedSuggestion.page_hint}</span>
                  )}
                </div>
              </div>

              {/* Update Form */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-slate-700 dark:text-muted-foreground">Status</Label>
                  <Select value={newStatus} onValueChange={(v) => setNewStatus(v as SuggestionStatus)}>
                    <SelectTrigger className="bg-slate-50 dark:bg-slate-800 dark:text-slate-100 text-slate-900">
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">New</SelectItem>
                      <SelectItem value="under_review">Under Review</SelectItem>
                      <SelectItem value="planned">Planned</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="declined">Declined</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-700 dark:text-muted-foreground">
                    Internal Notes (not visible to submitter)
                  </Label>
                  <Textarea
                    value={adminNote}
                    onChange={(e) => setAdminNote(e.target.value)}
                    placeholder="Add internal notes..."
                    rows={2}
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
                  <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
                </div>
              ) : suggestionUpdates.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-slate-700 dark:text-muted-foreground">History</Label>
                  <div className="max-h-32 overflow-y-auto space-y-2">
                    {suggestionUpdates.map((update) => (
                      <div 
                        key={update.id}
                        className="text-xs p-2 rounded bg-slate-100 dark:bg-slate-700"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">
                            {update.old_status && update.new_status ? (
                              <>
                                {SUGGESTION_STATUS_LABELS[update.old_status]} → {SUGGESTION_STATUS_LABELS[update.new_status]}
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
              onClick={handleUpdateSuggestion}
              disabled={updating}
              className="bg-blue-600 hover:bg-blue-700"
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
