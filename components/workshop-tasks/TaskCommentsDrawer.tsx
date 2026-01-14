'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { MessageSquare, Send, Edit2, Trash2, CheckCircle2, Clock, User } from 'lucide-react';
import { formatDate } from '@/lib/utils/date';
import { toast } from 'sonner';

// Types from API
type TimelineItem = {
  id: string;
  type: 'status_event' | 'comment';
  created_at: string;
  author: { id: string; full_name: string } | null;
  body: string;
  can_edit?: boolean;
  can_delete?: boolean;
  meta?: {
    status: string;
  };
  updated_at?: string | null;
};

interface TaskCommentsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string;
  taskTitle: string;
}

export function TaskCommentsDrawer({
  open,
  onOpenChange,
  taskId,
  taskTitle,
}: TaskCommentsDrawerProps) {
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  // Fetch timeline when dialog opens
  useEffect(() => {
    if (open && taskId) {
      fetchTimeline();
    }
  }, [open, taskId]);

  const fetchTimeline = async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/workshop-tasks/tasks/${taskId}/comments?order=asc`
      );

      if (!response.ok) {
        throw new Error('Failed to fetch timeline');
      }

      const data = await response.json();
      setTimeline(data.items || []);
    } catch (error) {
      console.error('Error fetching timeline:', error);
      toast.error('Failed to load timeline');
    } finally {
      setLoading(false);
    }
  };

  const handleAddComment = async () => {
    if (!newComment.trim()) {
      toast.error('Comment cannot be empty');
      return;
    }

    if (newComment.trim().length > 1000) {
      toast.error('Comment must be less than 1000 characters');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(
        `/api/workshop-tasks/tasks/${taskId}/comments`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: newComment.trim() }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to add comment');
      }

      const data = await response.json();
      
      // Add new comment to timeline
      setTimeline((prev) => [...prev, data.comment]);
      setNewComment('');
      toast.success('Comment added');
    } catch (error: any) {
      console.error('Error adding comment:', error);
      toast.error(error.message || 'Failed to add comment');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditComment = async (commentId: string) => {
    if (!editText.trim()) {
      toast.error('Comment cannot be empty');
      return;
    }

    if (editText.trim().length > 1000) {
      toast.error('Comment must be less than 1000 characters');
      return;
    }

    try {
      const response = await fetch(
        `/api/workshop-tasks/comments/${commentId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: editText.trim() }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update comment');
      }

      const data = await response.json();
      
      // Update comment in timeline
      setTimeline((prev) =>
        prev.map((item) =>
          item.id === commentId ? { ...item, body: data.comment.body, updated_at: data.comment.updated_at } : item
        )
      );
      setEditingCommentId(null);
      setEditText('');
      toast.success('Comment updated');
    } catch (error: any) {
      console.error('Error updating comment:', error);
      toast.error(error.message || 'Failed to update comment');
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!confirm('Are you sure you want to delete this comment?')) {
      return;
    }

    try {
      const response = await fetch(
        `/api/workshop-tasks/comments/${commentId}`,
        {
          method: 'DELETE',
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete comment');
      }

      // Remove comment from timeline
      setTimeline((prev) => prev.filter((item) => item.id !== commentId));
      toast.success('Comment deleted');
    } catch (error: any) {
      console.error('Error deleting comment:', error);
      toast.error(error.message || 'Failed to delete comment');
    }
  };

  const startEdit = (comment: TimelineItem) => {
    setEditingCommentId(comment.id);
    setEditText(comment.body);
  };

  const cancelEdit = () => {
    setEditingCommentId(null);
    setEditText('');
  };

  const renderTimelineItem = (item: TimelineItem) => {
    const isEditing = editingCommentId === item.id;

    if (item.type === 'status_event') {
      return (
        <Card key={item.id} className="border-l-4 border-l-blue-500">
          <CardContent className="pt-4">
            <div className="flex items-start gap-3">
              {item.meta?.status === 'logged' ? (
                <Clock className="h-5 w-5 text-blue-500 mt-0.5" />
              ) : (
                <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5" />
              )}
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant={item.meta?.status === 'logged' ? 'default' : 'success'}>
                    {item.meta?.status === 'logged' ? 'In Progress' : 'Completed'}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {formatDate(item.created_at)}
                  </span>
                </div>
                <p className="text-sm">{item.body}</p>
                {item.author && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <User className="h-3 w-3" />
                    {item.author.full_name}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      );
    }

    // Comment
    return (
      <Card key={item.id}>
        <CardContent className="pt-4">
          <div className="flex items-start gap-3">
            <MessageSquare className="h-5 w-5 text-gray-500 mt-0.5" />
            <div className="flex-1 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {item.author && (
                    <span className="text-sm font-medium">{item.author.full_name}</span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {formatDate(item.created_at)}
                    {item.updated_at && ' (edited)'}
                  </span>
                </div>
                {!isEditing && (item.can_edit || item.can_delete) && (
                  <div className="flex gap-1">
                    {item.can_edit && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => startEdit(item)}
                        className="h-7 w-7 p-0"
                      >
                        <Edit2 className="h-3 w-3" />
                      </Button>
                    )}
                    {item.can_delete && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteComment(item.id)}
                        className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                )}
              </div>
              {isEditing ? (
                <div className="space-y-2">
                  <Textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    placeholder="Edit comment..."
                    rows={3}
                    maxLength={1000}
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => handleEditComment(item.id)}>
                      Save
                    </Button>
                    <Button size="sm" variant="outline" onClick={cancelEdit}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm whitespace-pre-wrap">{item.body}</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            {taskTitle}
          </DialogTitle>
        </DialogHeader>

        {/* Timeline */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-2">
          {loading ? (
            <>
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </>
          ) : timeline.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <MessageSquare className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>No comments yet. Add the first note.</p>
            </div>
          ) : (
            timeline.map(renderTimelineItem)
          )}
        </div>

        {/* Add Comment */}
        <div className="border-t pt-4 space-y-2">
          <Textarea
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Add a note..."
            rows={3}
            maxLength={1000}
            disabled={submitting}
          />
          <div className="flex justify-between items-center">
            <span className="text-xs text-muted-foreground">
              {newComment.length}/1000
            </span>
            <Button
              onClick={handleAddComment}
              disabled={submitting || !newComment.trim()}
              size="sm"
            >
              <Send className="h-4 w-4 mr-2" />
              {submitting ? 'Adding...' : 'Add Note'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
