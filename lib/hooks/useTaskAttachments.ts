import { useState, useEffect, useCallback } from 'react';
import { Database } from '@/types/database';
import type {
  AttachmentSchemaResponse,
  AttachmentSchemaSnapshot,
} from '@/types/workshop-attachments-v2';

type TaskAttachment = Database['public']['Tables']['workshop_task_attachments']['Row'];
type AttachmentTemplate = Database['public']['Tables']['workshop_attachment_templates']['Row'];

export type TaskAttachmentWithDetails = TaskAttachment & {
  workshop_attachment_templates: AttachmentTemplate | null;
  schema_snapshot?: AttachmentSchemaSnapshot | null;
  field_responses?: AttachmentSchemaResponse[];
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
  saveSchemaResponses: (attachmentId: string, responses: AttachmentSchemaResponse[], markComplete?: boolean) => Promise<boolean>;
}

export function useTaskAttachments({ 
  taskId, 
  enabled = true 
}: UseTaskAttachmentsOptions): UseTaskAttachmentsReturn {
  const [attachments, setAttachments] = useState<TaskAttachmentWithDetails[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchAttachments = useCallback(async () => {
    if (!enabled || !taskId) {
      setAttachments([]);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/workshop-tasks/attachments/task/${taskId}`, {
        method: 'GET',
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch task attachments');
      }

      setAttachments((data.attachments || []) as TaskAttachmentWithDetails[]);
    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error('Failed to fetch attachments');
      setError(errorObj);
      console.error('Error fetching task attachments:', err);
    } finally {
      setLoading(false);
    }
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

  const saveSchemaResponses = useCallback(async (
    attachmentId: string,
    responses: AttachmentSchemaResponse[],
    markComplete: boolean = false,
  ): Promise<boolean> => {
    try {
      const response = await fetch(`/api/workshop-tasks/attachments/${attachmentId}/schema`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responses, mark_complete: markComplete }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save schema responses');
      }

      await fetchAttachments();
      return true;
    } catch (err) {
      console.error('Error saving schema responses:', err);
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
    saveSchemaResponses,
  };
}
