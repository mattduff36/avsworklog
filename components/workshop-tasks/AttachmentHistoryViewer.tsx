'use client';

import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { AttachmentFormModal } from './AttachmentFormModal';
import type { Database } from '@/types/database';

type AttachmentQuestion = Database['public']['Tables']['workshop_attachment_questions']['Row'];
type AttachmentResponse = Database['public']['Tables']['workshop_attachment_responses']['Row'];

interface AttachmentDetails {
  id: string;
  status: 'pending' | 'completed';
  templateName: string;
  questions: AttachmentQuestion[];
  responses: AttachmentResponse[];
}

interface AttachmentHistoryViewerProps {
  children: (props: {
    openAttachment: (attachmentId: string) => void;
    loadingAttachmentId: string | null;
  }) => React.ReactNode;
}

/**
 * Shared component for viewing attachment details from history pages.
 * Fetches attachment data on-demand and opens a read-only modal.
 * Renders children as a function to give the parent control over card layout.
 */
export function AttachmentHistoryViewer({ children }: AttachmentHistoryViewerProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [details, setDetails] = useState<AttachmentDetails | null>(null);

  const openAttachment = useCallback(async (attachmentId: string) => {
    setLoadingId(attachmentId);
    try {
      const response = await fetch(`/api/workshop-tasks/attachments/${attachmentId}`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to load attachment');
      }
      const data = await response.json();
      const attachment = data.attachment;

      setDetails({
        id: attachment.id,
        status: attachment.status,
        templateName: attachment.workshop_attachment_templates?.name || 'Attachment',
        questions: attachment.questions || [],
        responses: attachment.responses || [],
      });
      setModalOpen(true);
    } catch (err) {
      console.error('Error fetching attachment details:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to load attachment details');
    } finally {
      setLoadingId(null);
    }
  }, []);

  return (
    <>
      {children({ openAttachment, loadingAttachmentId: loadingId })}

      {details && (
        <AttachmentFormModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          templateName={details.templateName}
          questions={details.questions}
          existingResponses={details.responses}
          readOnly
          attachmentId={details.id}
          isCompleted={details.status === 'completed'}
        />
      )}
    </>
  );
}

/**
 * Inline loading indicator for attachment cards while fetching details.
 */
export function AttachmentLoadingOverlay({ isLoading }: { isLoading: boolean }) {
  if (!isLoading) return null;
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-slate-900/40 rounded-lg z-10">
      <Loader2 className="h-5 w-5 text-blue-400 animate-spin" />
    </div>
  );
}
