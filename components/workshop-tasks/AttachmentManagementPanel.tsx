'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Plus, Edit, Trash2, ChevronDown, ChevronUp, FileText, GripVertical, Check, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { Database } from '@/types/database';

type Template = Database['public']['Tables']['workshop_attachment_templates']['Row'];
type Question = Database['public']['Tables']['workshop_attachment_questions']['Row'];

const QUESTION_TYPES = [
  { value: 'checkbox', label: 'Checkbox (Yes/No)' },
  { value: 'text', label: 'Short Text' },
  { value: 'long_text', label: 'Long Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
] as const;

export function AttachmentManagementPanel() {
  const supabase = createClient();
  
  const [templates, setTemplates] = useState<Template[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  
  // Template dialog state
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');
  const [templateActive, setTemplateActive] = useState(true);
  const [savingTemplate, setSavingTemplate] = useState(false);
  
  // Question dialog state
  const [showQuestionDialog, setShowQuestionDialog] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [questionText, setQuestionText] = useState('');
  const [questionType, setQuestionType] = useState<Question['question_type']>('checkbox');
  const [questionRequired, setQuestionRequired] = useState(false);
  const [savingQuestion, setSavingQuestion] = useState(false);
  
  // Delete confirmation state
  const [deleteTemplateId, setDeleteTemplateId] = useState<string | null>(null);
  const [deleteQuestionId, setDeleteQuestionId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Fetch templates and questions on mount
  useEffect(() => {
    fetchTemplates();
    fetchQuestions();
  }, []);

  // Auto-select first template
  useEffect(() => {
    if (templates.length > 0 && !selectedTemplateId) {
      setSelectedTemplateId(templates[0].id);
    } else if (templates.length > 0 && selectedTemplateId) {
      const templateExists = templates.some(t => t.id === selectedTemplateId);
      if (!templateExists) {
        setSelectedTemplateId(templates[0].id);
      }
    } else if (templates.length === 0) {
      setSelectedTemplateId(null);
    }
  }, [templates, selectedTemplateId]);

  const fetchTemplates = async () => {
    try {
      const { data, error } = await supabase
        .from('workshop_attachment_templates')
        .select('*')
        .order('name');

      if (error) throw error;
      setTemplates(data || []);
    } catch (err) {
      console.error('Error fetching templates:', err);
      toast.error('Failed to load attachment templates');
    } finally {
      setLoading(false);
    }
  };

  const fetchQuestions = async () => {
    try {
      const { data, error } = await supabase
        .from('workshop_attachment_questions')
        .select('*')
        .order('sort_order');

      if (error) throw error;
      setQuestions(data || []);
    } catch (err) {
      console.error('Error fetching questions:', err);
    }
  };

  const selectedTemplate = templates.find(t => t.id === selectedTemplateId);
  const templateQuestions = selectedTemplateId
    ? questions.filter(q => q.template_id === selectedTemplateId).sort((a, b) => a.sort_order - b.sort_order)
    : [];

  // Template CRUD
  const openAddTemplateDialog = () => {
    setEditingTemplate(null);
    setTemplateName('');
    setTemplateDescription('');
    setTemplateActive(true);
    setShowTemplateDialog(true);
  };

  const openEditTemplateDialog = (template: Template) => {
    setEditingTemplate(template);
    setTemplateName(template.name);
    setTemplateDescription(template.description || '');
    setTemplateActive(template.is_active);
    setShowTemplateDialog(true);
  };

  const handleSaveTemplate = async () => {
    if (!templateName.trim()) {
      toast.error('Template name is required');
      return;
    }

    setSavingTemplate(true);
    try {
      if (editingTemplate) {
        const { error } = await supabase
          .from('workshop_attachment_templates')
          .update({
            name: templateName.trim(),
            description: templateDescription.trim() || null,
            is_active: templateActive,
          })
          .eq('id', editingTemplate.id);

        if (error) throw error;
        toast.success('Template updated');
      } else {
        const { error } = await supabase
          .from('workshop_attachment_templates')
          .insert({
            name: templateName.trim(),
            description: templateDescription.trim() || null,
            is_active: templateActive,
          });

        if (error) throw error;
        toast.success('Template created');
      }

      setShowTemplateDialog(false);
      fetchTemplates();
    } catch (err) {
      console.error('Error saving template:', err);
      toast.error('Failed to save template');
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleDeleteTemplate = async () => {
    if (!deleteTemplateId) return;

    setDeleting(true);
    try {
      const { error } = await supabase
        .from('workshop_attachment_templates')
        .delete()
        .eq('id', deleteTemplateId);

      if (error) throw error;
      toast.success('Template deleted');
      setDeleteTemplateId(null);
      fetchTemplates();
      fetchQuestions();
    } catch (err) {
      console.error('Error deleting template:', err);
      toast.error('Failed to delete template');
    } finally {
      setDeleting(false);
    }
  };

  // Question CRUD
  const openAddQuestionDialog = () => {
    setEditingQuestion(null);
    setQuestionText('');
    setQuestionType('checkbox');
    setQuestionRequired(false);
    setShowQuestionDialog(true);
  };

  const openEditQuestionDialog = (question: Question) => {
    setEditingQuestion(question);
    setQuestionText(question.question_text);
    setQuestionType(question.question_type);
    setQuestionRequired(question.is_required);
    setShowQuestionDialog(true);
  };

  const handleSaveQuestion = async () => {
    if (!questionText.trim()) {
      toast.error('Question text is required');
      return;
    }

    if (!selectedTemplateId) {
      toast.error('No template selected');
      return;
    }

    setSavingQuestion(true);
    try {
      if (editingQuestion) {
        const { error } = await supabase
          .from('workshop_attachment_questions')
          .update({
            question_text: questionText.trim(),
            question_type: questionType,
            is_required: questionRequired,
          })
          .eq('id', editingQuestion.id);

        if (error) throw error;
        toast.success('Question updated');
      } else {
        // Get max sort_order for this template
        const maxSortOrder = templateQuestions.length > 0
          ? Math.max(...templateQuestions.map(q => q.sort_order))
          : 0;

        const { error } = await supabase
          .from('workshop_attachment_questions')
          .insert({
            template_id: selectedTemplateId,
            question_text: questionText.trim(),
            question_type: questionType,
            is_required: questionRequired,
            sort_order: maxSortOrder + 1,
          });

        if (error) throw error;
        toast.success('Question added');
      }

      setShowQuestionDialog(false);
      fetchQuestions();
    } catch (err) {
      console.error('Error saving question:', err);
      toast.error('Failed to save question');
    } finally {
      setSavingQuestion(false);
    }
  };

  const handleDeleteQuestion = async () => {
    if (!deleteQuestionId) return;

    setDeleting(true);
    try {
      const { error } = await supabase
        .from('workshop_attachment_questions')
        .delete()
        .eq('id', deleteQuestionId);

      if (error) throw error;
      toast.success('Question deleted');
      setDeleteQuestionId(null);
      fetchQuestions();
    } catch (err) {
      console.error('Error deleting question:', err);
      toast.error('Failed to delete question');
    } finally {
      setDeleting(false);
    }
  };

  const moveQuestion = async (questionId: string, direction: 'up' | 'down') => {
    const questionIndex = templateQuestions.findIndex(q => q.id === questionId);
    if (questionIndex === -1) return;

    const targetIndex = direction === 'up' ? questionIndex - 1 : questionIndex + 1;
    if (targetIndex < 0 || targetIndex >= templateQuestions.length) return;

    const currentQuestion = templateQuestions[questionIndex];
    const targetQuestion = templateQuestions[targetIndex];

    try {
      // Swap sort orders
      await supabase
        .from('workshop_attachment_questions')
        .update({ sort_order: targetQuestion.sort_order })
        .eq('id', currentQuestion.id);

      await supabase
        .from('workshop_attachment_questions')
        .update({ sort_order: currentQuestion.sort_order })
        .eq('id', targetQuestion.id);

      fetchQuestions();
    } catch (err) {
      console.error('Error reordering questions:', err);
      toast.error('Failed to reorder questions');
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <div className="animate-pulse text-muted-foreground">Loading attachment templates...</div>
        </CardContent>
      </Card>
    );
  }

  if (templates.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <FileText className="h-16 w-16 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">
            No Attachment Templates Yet
          </h3>
          <p className="text-muted-foreground mb-6 text-center max-w-md">
            Create attachment templates to add service checklists and documentation forms to workshop tasks
          </p>
          <Button onClick={openAddTemplateDialog} className="bg-workshop hover:bg-workshop-dark text-white">
            <Plus className="h-4 w-4 mr-2" />
            Create First Template
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Attachment Templates</CardTitle>
              <CardDescription>
                Create and manage service checklists and documentation forms
              </CardDescription>
            </div>
            <Button onClick={openAddTemplateDialog} className="bg-workshop hover:bg-workshop-dark text-white">
              <Plus className="h-4 w-4 mr-2" />
              Add Template
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
            {/* Left Column: Template List */}
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground mb-3 uppercase tracking-wide">
                Templates ({templates.length})
              </p>
              {templates.map((template) => {
                const questionCount = questions.filter(q => q.template_id === template.id).length;
                const isSelected = selectedTemplateId === template.id;

                return (
                  <button
                    key={template.id}
                    onClick={() => setSelectedTemplateId(template.id)}
                    className={`w-full text-left p-3 rounded-lg border transition-all ${
                      isSelected
                        ? 'bg-workshop/10 border-workshop'
                        : 'bg-muted/30 border-border hover:border-border/80'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className={`font-medium truncate ${
                            isSelected ? 'text-workshop' : 'text-foreground'
                          }`}>
                            {template.name}
                          </p>
                          {!template.is_active && (
                            <Badge variant="outline" className="text-xs bg-muted">
                              Inactive
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-muted-foreground">
                            {questionCount} {questionCount === 1 ? 'question' : 'questions'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Right Column: Template Detail Panel */}
            <div className="space-y-4">
              {selectedTemplate ? (
                <>
                  {/* Template Header with Actions */}
                  <div className="flex items-start justify-between pb-4 border-b border-border">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-xl font-semibold text-foreground">
                          {selectedTemplate.name}
                        </h3>
                        {!selectedTemplate.is_active && (
                          <Badge variant="outline" className="bg-muted">
                            Inactive
                          </Badge>
                        )}
                      </div>
                      {selectedTemplate.description && (
                        <p className="text-sm text-muted-foreground">
                          {selectedTemplate.description}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openEditTemplateDialog(selectedTemplate)}
                      >
                        <Edit className="h-4 w-4 mr-1" />
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDeleteTemplateId(selectedTemplate.id)}
                        className="border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950"
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        Delete
                      </Button>
                    </div>
                  </div>

                  {/* Questions Section */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-semibold text-foreground uppercase tracking-wide">
                        Questions ({templateQuestions.length})
                      </h4>
                      <Button
                        size="sm"
                        onClick={openAddQuestionDialog}
                        className="bg-workshop/20 hover:bg-workshop/30 text-workshop border border-workshop/30"
                        variant="outline"
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        Add Question
                      </Button>
                    </div>

                    {templateQuestions.length === 0 ? (
                      <div className="text-center py-8 bg-muted/30 rounded-lg border border-border">
                        <p className="text-muted-foreground mb-3">
                          No questions yet
                        </p>
                        <Button
                          size="sm"
                          onClick={openAddQuestionDialog}
                          variant="outline"
                          className="border-workshop/30 text-workshop hover:bg-workshop/10"
                        >
                          <Plus className="h-3 w-3 mr-1" />
                          Add First Question
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {templateQuestions.map((question, index) => (
                          <div
                            key={question.id}
                            className="flex items-center gap-2 p-3 bg-muted/30 rounded-lg border border-border"
                          >
                            {/* Reorder buttons */}
                            <div className="flex flex-col gap-0.5">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => moveQuestion(question.id, 'up')}
                                disabled={index === 0}
                                className="h-6 w-6 p-0"
                              >
                                <ChevronUp className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => moveQuestion(question.id, 'down')}
                                disabled={index === templateQuestions.length - 1}
                                className="h-6 w-6 p-0"
                              >
                                <ChevronDown className="h-3 w-3" />
                              </Button>
                            </div>

                            {/* Question content */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-foreground">
                                  {question.question_text}
                                </span>
                                {question.is_required && (
                                  <Badge variant="outline" className="text-xs bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800">
                                    Required
                                  </Badge>
                                )}
                              </div>
                              <span className="text-xs text-muted-foreground">
                                {QUESTION_TYPES.find(t => t.value === question.question_type)?.label}
                              </span>
                            </div>

                            {/* Actions */}
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openEditQuestionDialog(question)}
                                className="h-8 w-8 p-0"
                              >
                                <Edit className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setDeleteQuestionId(question.id)}
                                className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950 h-8 w-8 p-0"
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-center py-12">
                  <p className="text-muted-foreground">
                    Select a template from the list to view details
                  </p>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Template Dialog */}
      <Dialog open={showTemplateDialog} onOpenChange={setShowTemplateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingTemplate ? 'Edit Template' : 'Create Template'}
            </DialogTitle>
            <DialogDescription>
              {editingTemplate
                ? 'Update the attachment template details'
                : 'Create a new attachment template for workshop tasks'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="templateName">
                Template Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="templateName"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="e.g., Full Service Checklist"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="templateDescription">Description</Label>
              <Textarea
                id="templateDescription"
                value={templateDescription}
                onChange={(e) => setTemplateDescription(e.target.value)}
                placeholder="Optional description of what this template is used for"
                rows={3}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="templateActive">Active</Label>
                <p className="text-xs text-muted-foreground">
                  Inactive templates won't appear when creating tasks
                </p>
              </div>
              <Switch
                id="templateActive"
                checked={templateActive}
                onCheckedChange={setTemplateActive}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTemplateDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveTemplate}
              disabled={savingTemplate || !templateName.trim()}
              className="bg-workshop hover:bg-workshop-dark text-white"
            >
              {savingTemplate ? 'Saving...' : editingTemplate ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Question Dialog */}
      <Dialog open={showQuestionDialog} onOpenChange={setShowQuestionDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingQuestion ? 'Edit Question' : 'Add Question'}
            </DialogTitle>
            <DialogDescription>
              {editingQuestion
                ? 'Update the question details'
                : 'Add a new question to this template'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="questionText">
                Question Text <span className="text-red-500">*</span>
              </Label>
              <Input
                id="questionText"
                value={questionText}
                onChange={(e) => setQuestionText(e.target.value)}
                placeholder="e.g., Engine oil replaced"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="questionType">Response Type</Label>
              <Select value={questionType} onValueChange={(v) => setQuestionType(v as Question['question_type'])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QUESTION_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="questionRequired">Required</Label>
                <p className="text-xs text-muted-foreground">
                  User must answer this question to complete the attachment
                </p>
              </div>
              <Switch
                id="questionRequired"
                checked={questionRequired}
                onCheckedChange={setQuestionRequired}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowQuestionDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveQuestion}
              disabled={savingQuestion || !questionText.trim()}
              className="bg-workshop hover:bg-workshop-dark text-white"
            >
              {savingQuestion ? 'Saving...' : editingQuestion ? 'Update' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Template Confirmation */}
      <AlertDialog open={!!deleteTemplateId} onOpenChange={(open) => !open && setDeleteTemplateId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Template?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this template and all its questions.
              Any existing task attachments using this template will lose their template reference.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteTemplate}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Question Confirmation */}
      <AlertDialog open={!!deleteQuestionId} onOpenChange={(open) => !open && setDeleteQuestionId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Question?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this question from the template.
              Existing responses to this question will be preserved but the question will be removed from future use.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteQuestion}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
