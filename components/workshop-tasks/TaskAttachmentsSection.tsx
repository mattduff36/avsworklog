'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { FileText, Plus, Check, Clock, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { useTaskAttachments, TaskAttachmentWithDetails } from '@/lib/hooks/useTaskAttachments';
import { useAttachmentTemplates } from '@/lib/hooks/useAttachmentTemplates';
import { AttachmentFormModal } from './AttachmentFormModal';
import { formatDate } from '@/lib/utils/date';

interface TaskAttachmentsSectionProps {
  taskId: string;
  taskStatus: string;
  onUpdate?: () => void;
}

export function TaskAttachmentsSection({ taskId, taskStatus, onUpdate }: TaskAttachmentsSectionProps) {
  const { attachments, loading, addAttachment, saveResponses, refetch } = useTaskAttachments({ taskId });
  const { templates } = useAttachmentTemplates();
  
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [adding, setAdding] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [activeAttachment, setActiveAttachment] = useState<TaskAttachmentWithDetails | null>(null);

  const isTaskCompleted = taskStatus === 'completed';

  // Filter out templates that are already attached
  const attachedTemplateIds = attachments.map(a => a.template_id);
  const availableTemplates = templates.filter(t => !attachedTemplateIds.includes(t.id));

  const handleAddAttachment = async () => {
    if (!selectedTemplateId) {
      toast.error('Please select a template');
      return;
    }

    setAdding(true);
    try {
      await addAttachment(selectedTemplateId);
      setSelectedTemplateId('');
      toast.success('Attachment added');
      onUpdate?.();
    } catch (err) {
      toast.error('Failed to add attachment');
    } finally {
      setAdding(false);
    }
  };

  const handleOpenForm = (attachment: TaskAttachmentWithDetails) => {
    setActiveAttachment(attachment);
    setShowForm(true);
  };

  const handleSaveResponses = async (
    responses: { question_id: string; response_value: string | null }[],
    markComplete: boolean
  ) => {
    if (!activeAttachment) return;

    await saveResponses(activeAttachment.id, responses, markComplete);
    await refetch();
    onUpdate?.();
  };

  const getCompletionProgress = (attachment: TaskAttachmentWithDetails) => {
    const totalQuestions = attachment.questions.length;
    if (totalQuestions === 0) return { completed: 0, total: 0, percentage: 100 };

    const completedQuestions = attachment.questions.filter(q => {
      const response = attachment.responses.find(r => r.question_id === q.id);
      if (!response?.response_value) return false;
      if (q.question_type === 'checkbox') return response.response_value === 'true';
      return response.response_value.trim() !== '';
    }).length;

    return {
      completed: completedQuestions,
      total: totalQuestions,
      percentage: Math.round((completedQuestions / totalQuestions) * 100),
    };
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Existing Attachments */}
      {attachments.length > 0 && (
        <div className="space-y-2">
          {attachments.map((attachment) => {
            const progress = getCompletionProgress(attachment);
            const templateName = attachment.workshop_attachment_templates?.name || 'Unknown Template';

            return (
              <Card
                key={attachment.id}
                className={`cursor-pointer hover:border-workshop/50 transition-colors ${
                  attachment.status === 'completed'
                    ? 'bg-green-50/50 dark:bg-green-950/20 border-green-200 dark:border-green-800'
                    : 'bg-muted/30'
                }`}
                onClick={() => handleOpenForm(attachment)}
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <FileText className={`h-5 w-5 ${
                        attachment.status === 'completed'
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-workshop'
                      }`} />
                      <div>
                        <p className="font-medium text-foreground">{templateName}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{progress.completed}/{progress.total} items</span>
                          {attachment.status === 'completed' && attachment.completed_at && (
                            <>
                              <span>•</span>
                              <span>Completed {formatDate(attachment.completed_at)}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {attachment.status === 'completed' ? (
                        <Badge className="bg-green-600 text-white">
                          <Check className="h-3 w-3 mr-1" />
                          Complete
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800">
                          <Clock className="h-3 w-3 mr-1" />
                          {progress.percentage}%
                        </Badge>
                      )}
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add Attachment */}
      {!isTaskCompleted && availableTemplates.length > 0 && (
        <div className="flex items-center gap-2">
          <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="Select an attachment template" />
            </SelectTrigger>
            <SelectContent>
              {availableTemplates.map((template) => (
                <SelectItem key={template.id} value={template.id}>
                  {template.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={handleAddAttachment}
            disabled={adding || !selectedTemplateId}
            size="sm"
            className="bg-workshop hover:bg-workshop-dark text-white"
          >
            <Plus className="h-4 w-4 mr-1" />
            {adding ? 'Adding...' : 'Add'}
          </Button>
        </div>
      )}

      {/* Empty State */}
      {attachments.length === 0 && availableTemplates.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">
          No attachment templates available
        </p>
      )}

      {attachments.length === 0 && availableTemplates.length > 0 && !isTaskCompleted && (
        <p className="text-sm text-muted-foreground text-center py-2">
          Add service checklists or documentation to this task
        </p>
      )}

      {/* Attachment Form Modal */}
      {activeAttachment && (
        <AttachmentFormModal
          open={showForm}
          onOpenChange={setShowForm}
          templateName={activeAttachment.workshop_attachment_templates?.name || 'Attachment'}
          questions={activeAttachment.questions}
          existingResponses={activeAttachment.responses}
          onSave={handleSaveResponses}
          readOnly={isTaskCompleted}
        />
      )}
    </div>
  );
}
