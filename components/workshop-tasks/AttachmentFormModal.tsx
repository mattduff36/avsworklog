'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Check, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Database } from '@/types/database';

type AttachmentQuestion = Database['public']['Tables']['workshop_attachment_questions']['Row'];
type AttachmentResponse = Database['public']['Tables']['workshop_attachment_responses']['Row'];

interface AttachmentFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateName: string;
  questions: AttachmentQuestion[];
  existingResponses?: AttachmentResponse[];
  onSave: (responses: { question_id: string; response_value: string | null }[], markComplete: boolean) => Promise<void>;
  readOnly?: boolean;
}

export function AttachmentFormModal({
  open,
  onOpenChange,
  templateName,
  questions,
  existingResponses = [],
  onSave,
  readOnly = false,
}: AttachmentFormModalProps) {
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
      if (!value || value.trim() === '' || value === 'false') {
        toast.error(`Please complete required field: ${question.question_text}`);
        return false;
      }
    }
    return true;
  };

  const handleSave = async (markComplete: boolean) => {
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
            />
            <Label
              htmlFor={question.id}
              className={`text-sm font-normal cursor-pointer ${isChecked ? 'text-green-600 dark:text-green-400' : 'text-foreground'}`}
            >
              {question.question_text}
              {question.is_required && <span className="text-red-500 ml-1">*</span>}
            </Label>
            {isChecked && <Check className="h-4 w-4 text-green-600 dark:text-green-400" />}
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh]">
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
            {questions.map((question) => (
              <div
                key={question.id}
                className={`p-3 rounded-lg border ${
                  question.question_type === 'checkbox'
                    ? responses[question.id] === 'true'
                      ? 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800'
                      : 'bg-muted/30 border-border'
                    : 'bg-muted/30 border-border'
                }`}
              >
                {renderQuestionInput(question)}
              </div>
            ))}
          </div>
        </ScrollArea>

        {!readOnly && (
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => handleSave(false)}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save Draft'}
            </Button>
            <Button
              onClick={() => handleSave(true)}
              disabled={saving}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              {saving ? 'Saving...' : 'Mark Complete'}
            </Button>
          </DialogFooter>
        )}

        {readOnly && (
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
