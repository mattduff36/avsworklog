'use client';

import { useMemo, useRef, useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Check, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Database } from '@/types/database';
import { useTabletMode } from '@/components/layout/tablet-mode-context';
import { triggerShakeAnimation } from '@/lib/utils/animations';

type AttachmentQuestion = Database['public']['Tables']['workshop_attachment_questions']['Row'];
type AttachmentResponse = Database['public']['Tables']['workshop_attachment_responses']['Row'];

interface AttachmentFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateName: string;
  questions: AttachmentQuestion[];
  existingResponses?: AttachmentResponse[];
  onSave?: (responses: { question_id: string; response_value: string | null }[], markComplete: boolean) => Promise<void>;
  readOnly?: boolean;
  /** When provided, shows a "Download PDF" button in read-only mode */
  attachmentId?: string;
  /** Controls whether the PDF download button is enabled (only for completed attachments) */
  isCompleted?: boolean;
}

export function AttachmentFormModal({
  open,
  onOpenChange,
  templateName,
  questions,
  existingResponses = [],
  onSave,
  readOnly = false,
  attachmentId,
  isCompleted = false,
}: AttachmentFormModalProps) {
  const { tabletModeEnabled } = useTabletMode();
  const contentRef = useRef<HTMLDivElement>(null);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Initialize responses from existing data
  useEffect(() => {
    if (open) {
      const initialResponses: Record<string, string> = {};
      existingResponses.forEach(resp => {
        initialResponses[resp.question_id] = resp.response_value || '';
      });
      setResponses(initialResponses);
    }
  }, [open, existingResponses]);

  const handleResponseChange = (questionId: string, value: string) => {
    setResponses(prev => ({
      ...prev,
      [questionId]: value,
    }));
  };

  const handleCheckboxChange = (questionId: string, checked: boolean) => {
    setResponses(prev => ({
      ...prev,
      [questionId]: checked ? 'true' : 'false',
    }));
  };

  const validateResponses = (): boolean => {
    const requiredQuestions = questions.filter(q => q.is_required);
    for (const question of requiredQuestions) {
      const value = responses[question.id];
      
      // For checkboxes, 'false' means unchecked (invalid for required fields)
      if (question.question_type === 'checkbox') {
        if (value !== 'true') {
          toast.error(`Please complete required field: ${question.question_text}`);
          return false;
        }
      } else {
        // For other types, check if value is empty
        if (!value || value.trim() === '') {
          toast.error(`Please complete required field: ${question.question_text}`);
          return false;
        }
      }
    }
    return true;
  };

  const [downloading, setDownloading] = useState(false);
  const isDirty = useMemo(() => Object.values(responses).some((v) => (v ?? '').trim() !== ''), [responses]);

  const handleSave = async (markComplete: boolean) => {
    if (!onSave) return;
    if (markComplete && !validateResponses()) {
      return;
    }

    setSaving(true);
    try {
      const responseArray = questions.map(q => ({
        question_id: q.id,
        response_value: responses[q.id] || null,
      }));

      await onSave(responseArray, markComplete);
      toast.success(markComplete ? 'Attachment completed' : 'Responses saved');
      onOpenChange(false);
    } catch (err) {
      console.error('Error saving responses:', err);
      toast.error('Failed to save responses');
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!attachmentId) return;
    setDownloading(true);
    try {
      const response = await fetch(`/api/workshop-tasks/attachments/${attachmentId}/pdf`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to generate PDF');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${templateName.replace(/[^a-z0-9]/gi, '_')}_attachment.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('PDF downloaded');
    } catch (err) {
      console.error('Error downloading PDF:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to download PDF');
    } finally {
      setDownloading(false);
    }
  };

  const renderQuestionInput = (question: AttachmentQuestion) => {
    const value = responses[question.id] || '';
    const isChecked = value === 'true';

    switch (question.question_type) {
      case 'checkbox':
        return (
          <div className="flex items-center space-x-3">
            <Checkbox
              id={question.id}
              checked={isChecked}
              onCheckedChange={(checked) => handleCheckboxChange(question.id, !!checked)}
              disabled={readOnly}
              className="h-5 w-5 border-2 data-[state=checked]:bg-green-600 data-[state=checked]:border-green-600 pointer-events-none"
            />
            <Label
              htmlFor={question.id}
              className={`flex-1 text-sm font-medium cursor-pointer select-none ${
                isChecked ? 'text-green-600 dark:text-green-400' : 'text-foreground'
              }`}
            >
              {question.question_text}
              {question.is_required && <span className="text-red-500 ml-1">*</span>}
            </Label>
            {isChecked && <Check className="h-5 w-5 text-green-600 dark:text-green-400 flex-shrink-0" />}
          </div>
        );

      case 'text':
        return (
          <div className="space-y-2">
            <Label htmlFor={question.id}>
              {question.question_text}
              {question.is_required && <span className="text-red-500 ml-1">*</span>}
            </Label>
            <Input
              id={question.id}
              value={value}
              onChange={(e) => handleResponseChange(question.id, e.target.value)}
              disabled={readOnly}
              placeholder="Enter your response"
            />
          </div>
        );

      case 'long_text':
        return (
          <div className="space-y-2">
            <Label htmlFor={question.id}>
              {question.question_text}
              {question.is_required && <span className="text-red-500 ml-1">*</span>}
            </Label>
            <Textarea
              id={question.id}
              value={value}
              onChange={(e) => handleResponseChange(question.id, e.target.value)}
              disabled={readOnly}
              placeholder="Enter your response"
              rows={3}
            />
          </div>
        );

      case 'number':
        return (
          <div className="space-y-2">
            <Label htmlFor={question.id}>
              {question.question_text}
              {question.is_required && <span className="text-red-500 ml-1">*</span>}
            </Label>
            <Input
              id={question.id}
              type="number"
              value={value}
              onChange={(e) => handleResponseChange(question.id, e.target.value)}
              disabled={readOnly}
              placeholder="Enter a number"
            />
          </div>
        );

      case 'date':
        return (
          <div className="space-y-2">
            <Label htmlFor={question.id}>
              {question.question_text}
              {question.is_required && <span className="text-red-500 ml-1">*</span>}
            </Label>
            <Input
              id={question.id}
              type="date"
              value={value}
              onChange={(e) => handleResponseChange(question.id, e.target.value)}
              disabled={readOnly}
            />
          </div>
        );

      default:
        return null;
    }
  };

  // Count completed questions
  const completedCount = questions.filter(q => {
    const value = responses[q.id];
    if (q.question_type === 'checkbox') {
      return value === 'true';
    }
    return value && value.trim() !== '';
  }).length;

  const requiredCount = questions.filter(q => q.is_required).length;
  const completedRequiredCount = questions.filter(q => {
    if (!q.is_required) return false;
    const value = responses[q.id];
    if (q.question_type === 'checkbox') {
      return value === 'true';
    }
    return value && value.trim() !== '';
  }).length;

  /** Sort questions so answered/checked items appear first, preserving relative order within each group. */
  function sortQuestionsCompletedFirst(
    qs: AttachmentQuestion[],
    resps: Record<string, string>,
  ): AttachmentQuestion[] {
    return [...qs].sort((a, b) => {
      const aCompleted = isQuestionCompleted(a, resps);
      const bCompleted = isQuestionCompleted(b, resps);
      if (aCompleted === bCompleted) return 0;
      return aCompleted ? -1 : 1;
    });
  }

  function isQuestionCompleted(q: AttachmentQuestion, resps: Record<string, string>): boolean {
    const val = resps[q.id];
    if (!val) return false;
    if (q.question_type === 'checkbox') return val === 'true';
    return val.trim() !== '';
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!readOnly && !saving && !downloading && !nextOpen && isDirty) {
          triggerShakeAnimation(contentRef.current);
          return;
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        ref={contentRef}
        className={`max-w-2xl max-h-[90vh] ${tabletModeEnabled ? 'p-5 sm:p-6' : ''}`}
        onInteractOutside={(event) => {
          if (!readOnly && !saving && !downloading && isDirty) {
            event.preventDefault();
            triggerShakeAnimation(contentRef.current);
          }
        }}
        onEscapeKeyDown={(event) => {
          if (!readOnly && !saving && !downloading && isDirty) {
            event.preventDefault();
            triggerShakeAnimation(contentRef.current);
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{templateName}</DialogTitle>
          <DialogDescription className="flex items-center gap-2">
            <span>
              {completedCount} of {questions.length} items completed
            </span>
            {requiredCount > 0 && (
              <>
                <span className="text-muted-foreground">•</span>
                <span className={completedRequiredCount === requiredCount ? 'text-green-600' : 'text-amber-600'}>
                  {completedRequiredCount}/{requiredCount} required
                </span>
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-4">
            {/* In read-only mode, show completed items first */}
            {(readOnly ? sortQuestionsCompletedFirst(questions, responses) : questions).map((question) => (
              <div
                key={question.id}
                className={`p-4 rounded-lg border transition-all ${
                  question.question_type === 'checkbox'
                    ? responses[question.id] === 'true'
                      ? 'bg-green-50 dark:bg-green-950/30 border-green-300 dark:border-green-700 shadow-sm'
                      : 'bg-muted/30 border-border hover:border-muted-foreground/30 hover:shadow-sm'
                    : 'bg-muted/30 border-border'
                } ${
                  question.question_type === 'checkbox' && !readOnly
                    ? 'cursor-pointer'
                    : ''
                }`}
                onClick={(e) => {
                  if (question.question_type === 'checkbox' && !readOnly) {
                    e.preventDefault();
                    const currentValue = responses[question.id] === 'true';
                    handleCheckboxChange(question.id, !currentValue);
                  }
                }}
              >
                {renderQuestionInput(question)}
              </div>
            ))}
          </div>
        </ScrollArea>

        {!readOnly && (
          <DialogFooter className={`gap-2 sm:gap-0 ${tabletModeEnabled ? 'pt-2' : ''}`}>
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
              className={tabletModeEnabled ? 'min-h-11 text-base px-4' : undefined}
            >
              {isDirty ? 'Discard Changes' : 'Cancel'}
            </Button>
            <Button
              variant="outline"
              onClick={() => handleSave(false)}
              disabled={saving}
              className={tabletModeEnabled ? 'min-h-11 text-base px-4' : undefined}
            >
              {saving ? 'Saving...' : 'Save Draft'}
            </Button>
            <Button
              onClick={() => handleSave(true)}
              disabled={saving}
              className={`bg-green-600 hover:bg-green-700 text-white ${tabletModeEnabled ? 'min-h-11 text-base px-4' : ''}`}
            >
              {saving ? 'Saving...' : 'Mark Complete'}
            </Button>
          </DialogFooter>
        )}

        {readOnly && (
          <DialogFooter className={`gap-2 sm:gap-0 ${tabletModeEnabled ? 'pt-2' : ''}`}>
            <Button variant="outline" onClick={() => onOpenChange(false)} className={tabletModeEnabled ? 'min-h-11 text-base px-4' : undefined}>
              Close
            </Button>
            {attachmentId && (
              <Button
                onClick={handleDownloadPdf}
                disabled={downloading || !isCompleted}
                className={`bg-blue-600 hover:bg-blue-700 text-white ${tabletModeEnabled ? 'min-h-11 text-base px-4' : ''}`}
                title={isCompleted ? 'Download as PDF' : 'Complete the attachment to enable PDF export'}
              >
                {downloading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                {downloading ? 'Generating...' : 'Download PDF'}
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
