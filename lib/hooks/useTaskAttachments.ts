import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Database } from '@/types/database';

type TaskAttachment = Database['public']['Tables']['workshop_task_attachments']['Row'];
type AttachmentTemplate = Database['public']['Tables']['workshop_attachment_templates']['Row'];
type AttachmentQuestion = Database['public']['Tables']['workshop_attachment_questions']['Row'];
type AttachmentResponse = Database['public']['Tables']['workshop_attachment_responses']['Row'];

export type TaskAttachmentWithDetails = TaskAttachment & {
  workshop_attachment_templates: AttachmentTemplate | null;
  questions: AttachmentQuestion[];
  responses: AttachmentResponse[];
};

interface UseTaskAttachmentsOptions {
  taskId: string | null;
  enabled?: boolean;
}

interface UseTaskAttachmentsReturn {
  attachments: TaskAttachmentWithDetails[];
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  addAttachment: (templateId: string) => Promise<TaskAttachmentWithDetails | null>;
  saveResponses: (attachmentId: string, responses: { question_id: string; response_value: string | null }[], markComplete?: boolean) => Promise<boolean>;
}

export function useTaskAttachments({ 
  taskId, 
  enabled = true 
}: UseTaskAttachmentsOptions): UseTaskAttachmentsReturn {
  const [attachments, setAttachments] = useState<TaskAttachmentWithDetails[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const supabase = createClient();

  const fetchAttachments = useCallback(async () => {
    if (!enabled || !taskId) {
      setAttachments([]);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Fetch attachments with templates
      const { data: attachmentsData, error: attachmentsError } = await supabase
        .from('workshop_task_attachments')
        .select(`
          *,
          workshop_attachment_templates (*)
        `)
        .eq('task_id', taskId)
        .order('created_at', { ascending: true });

      if (attachmentsError) {
        throw attachmentsError;
      }

      if (!attachmentsData || attachmentsData.length === 0) {
        setAttachments([]);
        return;
      }
      const typedAttachmentsData = attachmentsData as TaskAttachmentWithDetails[];

      // Get all template IDs and attachment IDs
      const templateIds = [...new Set(typedAttachmentsData.map((a: TaskAttachmentWithDetails) => a.template_id))];
      const attachmentIds = typedAttachmentsData.map((a: TaskAttachmentWithDetails) => a.id);

      // Fetch questions for all templates
      const { data: questionsData, error: questionsError } = await supabase
        .from('workshop_attachment_questions')
        .select('*')
        .in('template_id', templateIds)
        .order('sort_order', { ascending: true });

      if (questionsError) {
        throw questionsError;
      }

      // Fetch responses for all attachments
      const { data: responsesData, error: responsesError } = await supabase
        .from('workshop_attachment_responses')
        .select('*')
        .in('attachment_id', attachmentIds);

      if (responsesError) {
        throw responsesError;
      }
      const typedQuestions = (questionsData || []) as AttachmentQuestion[];
      const typedResponses = (responsesData || []) as AttachmentResponse[];

      // Combine data
      const combinedAttachments: TaskAttachmentWithDetails[] = typedAttachmentsData.map((attachment: TaskAttachmentWithDetails) => ({
        ...attachment,
        questions: typedQuestions.filter((q: AttachmentQuestion) => q.template_id === attachment.template_id),
        responses: typedResponses.filter((r: AttachmentResponse) => r.attachment_id === attachment.id),
      }));

      setAttachments(combinedAttachments);
    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error('Failed to fetch attachments');
      setError(errorObj);
      console.error('Error fetching task attachments:', err);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, enabled]);

  const addAttachment = useCallback(async (templateId: string): Promise<TaskAttachmentWithDetails | null> => {
    if (!taskId) {
      return null;
    }

    try {
      const response = await fetch(`/api/workshop-tasks/attachments/task/${taskId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_id: templateId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to add attachment');
      }

      // Refetch to get updated list
      await fetchAttachments();
      
      return data.attachment;
    } catch (err) {
      console.error('Error adding attachment:', err);
      throw err;
    }
  }, [taskId, fetchAttachments]);

  const saveResponses = useCallback(async (
    attachmentId: string, 
    responses: { question_id: string; response_value: string | null }[],
    markComplete: boolean = false
  ): Promise<boolean> => {
    try {
      const response = await fetch(`/api/workshop-tasks/attachments/${attachmentId}/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responses, mark_complete: markComplete }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save responses');
      }

      // Refetch to get updated list
      await fetchAttachments();
      
      return true;
    } catch (err) {
      console.error('Error saving responses:', err);
      throw err;
    }
  }, [fetchAttachments]);

  useEffect(() => {
    fetchAttachments();
  }, [fetchAttachments]);

  return {
    attachments,
    loading,
    error,
    refetch: fetchAttachments,
    addAttachment,
    saveResponses,
  };
}
