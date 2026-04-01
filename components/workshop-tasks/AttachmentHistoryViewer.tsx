'use client';

import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { AttachmentHybridFormModal } from './AttachmentHybridFormModal';
import type {
  AttachmentSchemaResponse,
  AttachmentSchemaSnapshot,
} from '@/types/workshop-attachments-v2';

interface AttachmentDetails {
  id: string;
  status: 'pending' | 'completed';
  templateName: string;
  snapshot: AttachmentSchemaSnapshot;
  responses: AttachmentSchemaResponse[];
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
      if (!attachment.schema_snapshot?.snapshot_json?.sections?.length) {
        throw new Error('Attachment has no V2 schema snapshot');
      }

      setDetails({
        id: attachment.id,
        status: attachment.status,
        templateName: attachment.workshop_attachment_templates?.name || 'Attachment',
        snapshot: attachment.schema_snapshot,
        responses: attachment.field_responses || [],
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
        <AttachmentHybridFormModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          templateName={details.templateName}
          snapshot={details.snapshot}
          existingResponses={details.responses}
          onSave={async () => {}}
          readOnly
          isCompleted={details.status === 'completed'}
          attachmentId={details.id}
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
