import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

export type WorkshopTaskComment = {
  id: string;
  body: string;
  created_at: string;
  updated_at: string | null;
  author: {
    id: string;
    full_name: string;
  } | null;
};

type TaskCommentsMap = Record<string, WorkshopTaskComment[]>;

interface UseWorkshopTaskCommentsOptions {
  taskIds: string[];
  enabled?: boolean;
}

interface UseWorkshopTaskCommentsReturn {
  comments: TaskCommentsMap;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useWorkshopTaskComments({ 
  taskIds, 
  enabled = true 
}: UseWorkshopTaskCommentsOptions): UseWorkshopTaskCommentsReturn {
  const [comments, setComments] = useState<TaskCommentsMap>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const supabase = createClient();

  const fetchComments = async () => {
    if (!enabled || taskIds.length === 0) {
      setComments({});
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('workshop_task_comments')
        .select(`
          id,
          task_id,
          body,
          created_at,
          updated_at,
          profiles:author_id (
            id,
            full_name
          )
        `)
        .in('task_id', taskIds)
        .order('created_at', { ascending: true });

      if (fetchError) {
        console.error('Supabase error fetching task comments:', {
          message: fetchError.message,
          details: fetchError.details,
          hint: fetchError.hint,
          code: fetchError.code,
        });
        throw fetchError;
      }

      // Group comments by task_id
      const commentsByTask: TaskCommentsMap = {};
      (data || []).forEach((comment: { 
        task_id: string; 
        id: string; 
        body: string; 
        created_at: string; 
        updated_at: string | null; 
        profiles: { id: string; full_name: string } | null 
      }) => {
        const taskId = comment.task_id;
        if (!commentsByTask[taskId]) {
          commentsByTask[taskId] = [];
        }
        commentsByTask[taskId].push({
          id: comment.id,
          body: comment.body,
          created_at: comment.created_at,
          updated_at: comment.updated_at,
          author: comment.profiles ? {
            id: comment.profiles.id,
            full_name: comment.profiles.full_name,
          } : null,
        });
      });

      setComments(commentsByTask);
    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error('Failed to fetch task comments');
      setError(errorObj);
      console.error('Error fetching task comments:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchComments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(taskIds), enabled]);

  return {
    comments,
    loading,
    error,
    refetch: fetchComments,
  };
}
