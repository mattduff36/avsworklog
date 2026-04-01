import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Database } from '@/types/database';

export type AttachmentTemplate = Database['public']['Tables']['workshop_attachment_templates']['Row'];

interface UseAttachmentTemplatesOptions {
  includeInactive?: boolean;
  enabled?: boolean;
}

interface UseAttachmentTemplatesReturn {
  templates: AttachmentTemplate[];
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useAttachmentTemplates({ 
  includeInactive = false,
  enabled = true 
}: UseAttachmentTemplatesOptions = {}): UseAttachmentTemplatesReturn {
  const [templates, setTemplates] = useState<AttachmentTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const supabase = createClient();

  const fetchTemplates = async () => {
    if (!enabled) {
      return;
    }

    try {
      setLoading(true);
      setError(null);

      let query = supabase
        .from('workshop_attachment_templates')
        .select('*')
        .order('name', { ascending: true });

      if (!includeInactive) {
        query = query.eq('is_active', true);
      }

      const { data, error: fetchError } = await query;

      if (fetchError) {
        throw fetchError;
      }

      setTemplates(data || []);
    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error('Failed to fetch templates');
      setError(errorObj);
      console.error('Error fetching attachment templates:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeInactive, enabled]);

  return {
    templates,
    loading,
    error,
    refetch: fetchTemplates,
  };
}
