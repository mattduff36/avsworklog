'use client';

import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { AttachmentHybridFormModal } from './AttachmentHybridFormModal';
import { canEnableAttachmentCorrection } from '@/lib/workshop-tasks/attachment-correction-access';
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
  preimageHash?: string;
}

export interface AttachmentHistoryOpenContext {
  task?: { status?: string | null; actioned_at?: string | null } | null;
}

interface AttachmentHistoryViewerProps {
  canCorrectCompleted?: boolean;
  children: (props: {
    openAttachment: (attachmentId: string, context?: AttachmentHistoryOpenContext) => void;
    loadingAttachmentId: string | null;
  }) => React.ReactNode;
}

/**
 * Shared component for viewing attachment details from history pages.
 * Fetches attachment data on-demand and opens a read-only modal.
 * Managers can wrench-enable correction for completed, non-archived tasks.
 */
export function AttachmentHistoryViewer({
  canCorrectCompleted = false,
  children,
}: AttachmentHistoryViewerProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [details, setDetails] = useState<AttachmentDetails | null>(null);
  const [openTask, setOpenTask] = useState<AttachmentHistoryOpenContext['task']>(null);

  const openAttachment = useCallback(async (
    attachmentId: string,
    context?: AttachmentHistoryOpenContext,
  ) => {
    setLoadingId(attachmentId);
    try {
      const response = await fetch(`/api/workshop-tasks/attachments/${attachmentId}`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to load attachment');
      }
      const data = await response.json();
      const attachment = data.attachment;
      if (!attachment.schema_snapshot?.snapshot_json?.sections?.length) {
        throw new Error('Attachment has no V2 schema snapshot');
      }

      setOpenTask(context?.task ?? null);
      setDetails({
        id: attachment.id,
        status: attachment.status,
        templateName: attachment.workshop_attachment_templates?.name || 'Attachment',
        snapshot: attachment.schema_snapshot,
        responses: attachment.field_responses || [],
        preimageHash: attachment.preimageHash,
      });
      setModalOpen(true);
    } catch (err) {
      console.error('Error fetching attachment details:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to load attachment details');
    } finally {
      setLoadingId(null);
    }
  }, []);

  const handleCorrect = async (responses: AttachmentSchemaResponse[], reason: string) => {
    if (!details?.preimageHash) {
      toast.error('Refresh the attachment before correcting it.');
      throw new Error('Missing attachment preimage hash');
    }
    const response = await fetch(`/api/workshop-tasks/attachments/${details.id}/correct-responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        responses,
        reason,
        expectedPreimageHash: details.preimageHash,
      }),
    });
    const data = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      throw new Error(data.error || 'Failed to correct attachment responses');
    }
  };

  const canEnableCorrection = canEnableAttachmentCorrection({
    canCorrectCompleted,
    task: openTask,
    attachmentStatus: details?.status,
  });

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
          canEnableCorrection={canEnableCorrection}
          onCorrect={canEnableCorrection ? handleCorrect : undefined}
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
