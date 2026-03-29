'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Plus, Edit, Trash2, ChevronDown, ChevronUp, FileText, Truck, HardHat } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { Database } from '@/types/database';
import { useTabletMode } from '@/components/layout/tablet-mode-context';
import { triggerShakeAnimation } from '@/lib/utils/animations';

type Template = Database['public']['Tables']['workshop_attachment_templates']['Row'];
type Question = Database['public']['Tables']['workshop_attachment_questions']['Row'];

const QUESTION_TYPES = [
  { value: 'checkbox', label: 'Checkbox (Yes/No)' },
  { value: 'text', label: 'Short Text' },
  { value: 'long_text', label: 'Long Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
] as const;

interface AttachmentManagementPanelProps {
  taxonomyMode?: 'van' | 'plant' | 'hgv';
}

function normalizeTemplateAppliesTo(rawValues?: string[] | null): string[] {
  // Legacy rows stored "vehicle", which now maps to "van".
  const normalized = (rawValues || [])
    .map((value) => value.trim().toLowerCase())
    .map((value) => (value === 'vehicle' ? 'van' : value))
    .filter(Boolean);

  if (normalized.length === 0) {
    return ['van', 'hgv', 'plant'];
  }

  return Array.from(new Set(normalized));
}

export function AttachmentManagementPanel({ taxonomyMode }: AttachmentManagementPanelProps) {
  const { tabletModeEnabled } = useTabletMode();
  const supabase = createClient();
  
  const [templates, setTemplates] = useState<Template[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  
  // Template dialog state
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');
  const [templateActive, setTemplateActive] = useState(true);
  const [templateAppliesToVehicle, setTemplateAppliesToVehicle] = useState(true);
  const [templateAppliesToHgv, setTemplateAppliesToHgv] = useState(true);
  const [templateAppliesToPlant, setTemplateAppliesToPlant] = useState(true);
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
  const templateDialogRef = useRef<HTMLDivElement>(null);
  const questionDialogRef = useRef<HTMLDivElement>(null);

  const fetchTemplates = useCallback(async () => {
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
  }, [supabase]);

  const fetchQuestions = useCallback(async () => {
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
  }, [supabase]);

  // Fetch templates and questions on mount
  useEffect(() => {
    fetchTemplates();
    fetchQuestions();
  }, [fetchTemplates, fetchQuestions]);

  // Filter templates by taxonomy mode if provided
  const filteredTemplates = taxonomyMode 
    ? templates.filter((template) =>
        normalizeTemplateAppliesTo(template.applies_to).includes(taxonomyMode)
      )
    : templates;

  // Auto-select first template (from filtered templates)
  useEffect(() => {
    if (filteredTemplates.length > 0 && !selectedTemplateId) {
      setSelectedTemplateId(filteredTemplates[0].id);
    } else if (filteredTemplates.length > 0 && selectedTemplateId) {
      const templateExists = filteredTemplates.some(t => t.id === selectedTemplateId);
      if (!templateExists) {
        setSelectedTemplateId(filteredTemplates[0].id);
      }
    } else if (filteredTemplates.length === 0) {
      setSelectedTemplateId(null);
    }
  }, [filteredTemplates, selectedTemplateId]);

  const selectedTemplate = templates.find(t => t.id === selectedTemplateId);
  const isTemplateDirty = useMemo(() => {
    const defaultName = editingTemplate?.name ?? '';
    const defaultDescription = editingTemplate?.description ?? '';
    const defaultActive = editingTemplate?.is_active ?? true;
    const defaultAppliesTo = normalizeTemplateAppliesTo(editingTemplate?.applies_to);
    return (
      templateName.trim() !== defaultName.trim() ||
      templateDescription.trim() !== defaultDescription.trim() ||
      templateActive !== defaultActive ||
      templateAppliesToVehicle !== defaultAppliesTo.includes('van') ||
      templateAppliesToHgv !== defaultAppliesTo.includes('hgv') ||
      templateAppliesToPlant !== defaultAppliesTo.includes('plant')
    );
  }, [
    editingTemplate,
    templateName,
    templateDescription,
    templateActive,
    templateAppliesToVehicle,
    templateAppliesToHgv,
    templateAppliesToPlant,
  ]);
  const isQuestionDirty = useMemo(() => {
    const defaultText = editingQuestion?.question_text ?? '';
    const defaultType = editingQuestion?.question_type ?? 'checkbox';
    const defaultRequired = editingQuestion?.is_required ?? false;
    return (
      questionText.trim() !== defaultText.trim() ||
      questionType !== defaultType ||
      questionRequired !== defaultRequired
    );
  }, [editingQuestion, questionText, questionType, questionRequired]);
  
  const templateQuestions = selectedTemplateId
    ? questions.filter(q => q.template_id === selectedTemplateId).sort((a, b) => a.sort_order - b.sort_order)
    : [];

  // Template CRUD
  const openAddTemplateDialog = () => {
    setEditingTemplate(null);
    setTemplateName('');
    setTemplateDescription('');
    setTemplateActive(true);
    setTemplateAppliesToVehicle(true);
    setTemplateAppliesToHgv(true);
    setTemplateAppliesToPlant(true);
    setShowTemplateDialog(true);
  };

  const openEditTemplateDialog = (template: Template) => {
    setEditingTemplate(template);
    setTemplateName(template.name);
    setTemplateDescription(template.description || '');
    setTemplateActive(template.is_active);
    const appliesTo = normalizeTemplateAppliesTo(template.applies_to);
    setTemplateAppliesToVehicle(appliesTo.includes('van'));
    setTemplateAppliesToHgv(appliesTo.includes('hgv'));
    setTemplateAppliesToPlant(appliesTo.includes('plant'));
    setShowTemplateDialog(true);
  };

  const handleSaveTemplate = async () => {
    if (!templateName.trim()) {
      toast.error('Template name is required');
      return;
    }

    if (!templateAppliesToVehicle && !templateAppliesToHgv && !templateAppliesToPlant) {
      toast.error('Template must apply to at least one asset type');
      return;
    }

    setSavingTemplate(true);
    try {
      const appliesTo: string[] = [];
      if (templateAppliesToVehicle) appliesTo.push('van');
      if (templateAppliesToHgv) appliesTo.push('hgv');
      if (templateAppliesToPlant) appliesTo.push('plant');

      if (editingTemplate) {
        const { error } = await supabase
          .from('workshop_attachment_templates')
          .update({
            name: templateName.trim(),
            description: templateDescription.trim() || null,
            is_active: templateActive,
            applies_to: appliesTo,
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
            applies_to: appliesTo,
          });

        if (error) throw error;
        toast.success('Template created');
      }

      setShowTemplateDialog(false);
      fetchTemplates();
    } catch (err) {
      console.error('Error saving template:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to save template';
      toast.error(errorMessage);
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
      <Card className="border-border">
        <CardHeader
          className="cursor-pointer hover:bg-slate-800/30 transition-colors"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 flex-1">
              <ChevronDown 
                className={`h-5 w-5 text-muted-foreground transition-transform ${
                  isExpanded ? 'rotate-180' : ''
                }`}
              />
              <div>
                <CardTitle className="text-white">Attachment Templates</CardTitle>
                <CardDescription className="text-muted-foreground">
                  Loading...
                </CardDescription>
              </div>
            </div>
          </div>
        </CardHeader>
        {isExpanded && (
          <CardContent className="flex items-center justify-center py-12">
            <div className="animate-pulse text-muted-foreground">Loading attachment templates...</div>
          </CardContent>
        )}
      </Card>
    );
  }

  if (templates.length === 0) {
    return (
      <Card className="border-border">
        <CardHeader
          className="cursor-pointer hover:bg-slate-800/30 transition-colors"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 flex-1">
              <ChevronDown 
                className={`h-5 w-5 text-muted-foreground transition-transform ${
                  isExpanded ? 'rotate-180' : ''
                }`}
              />
              <div>
                <CardTitle className="text-white">Attachment Templates</CardTitle>
                <CardDescription className="text-muted-foreground">
                  0 templates
                </CardDescription>
              </div>
            </div>
            <Button
              onClick={(e) => {
                e.stopPropagation();
                openAddTemplateDialog();
              }}
              className={`bg-workshop hover:bg-workshop-dark text-white ${tabletModeEnabled ? 'min-h-11 text-base px-4' : ''}`}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Template
            </Button>
          </div>
        </CardHeader>
        {isExpanded && (
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">
              No Attachment Templates Yet
            </h3>
            <p className="text-muted-foreground text-center max-w-md">
              Create attachment templates to add service checklists and documentation forms to workshop tasks
            </p>
          </CardContent>
        )}
      </Card>
    );
  }

  return (
    <>
      <Card className="border-border">
        <CardHeader
          className="cursor-pointer hover:bg-slate-800/30 transition-colors"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 flex-1">
              <ChevronDown 
                className={`h-5 w-5 text-muted-foreground transition-transform ${
                  isExpanded ? 'rotate-180' : ''
                }`}
              />
              <div>
                <CardTitle className="text-white">Attachment Templates</CardTitle>
                <CardDescription className="text-muted-foreground">
                  {filteredTemplates.length} {filteredTemplates.length === 1 ? 'template' : 'templates'} • Service checklists and documentation forms
                </CardDescription>
              </div>
            </div>
            <Button
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                openAddTemplateDialog();
              }}
              className={`bg-workshop hover:bg-workshop-dark text-white ${tabletModeEnabled ? 'min-h-11 text-base px-4' : ''}`}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Template
            </Button>
          </div>
        </CardHeader>
        
        {isExpanded && (
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
            {/* Left Column: Template List */}
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground mb-3 uppercase tracking-wide">
                Templates ({filteredTemplates.length})
              </p>
              {filteredTemplates.map((template) => {
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
                        className={tabletModeEnabled ? 'min-h-11 text-base px-4' : undefined}
                      >
                        <Edit className="h-4 w-4 mr-1" />
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDeleteTemplateId(selectedTemplate.id)}
                        className={`${tabletModeEnabled ? 'min-h-11 text-base px-4' : ''} border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950`}
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
                        className={`bg-workshop/20 hover:bg-workshop/30 text-workshop border border-workshop/30 ${tabletModeEnabled ? 'min-h-11 text-base px-4' : ''}`}
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
                          className={`border-workshop/30 text-workshop hover:bg-workshop/10 ${tabletModeEnabled ? 'min-h-11 text-base px-4' : ''}`}
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
                                className={`${tabletModeEnabled ? 'h-11 w-11' : 'h-6 w-6'} p-0`}
                              >
                                <ChevronUp className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => moveQuestion(question.id, 'down')}
                                disabled={index === templateQuestions.length - 1}
                                className={`${tabletModeEnabled ? 'h-11 w-11' : 'h-6 w-6'} p-0`}
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
                                className={`${tabletModeEnabled ? 'h-11 w-11' : 'h-8 w-8'} p-0`}
                              >
                                <Edit className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setDeleteQuestionId(question.id)}
                                className={`text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950 ${tabletModeEnabled ? 'h-11 w-11' : 'h-8 w-8'} p-0`}
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
        )}
      </Card>

      {/* Template Dialog */}
      <Dialog
        open={showTemplateDialog}
        onOpenChange={(open) => {
          if (!open && !savingTemplate && isTemplateDirty) {
            triggerShakeAnimation(templateDialogRef.current);
            return;
          }
          setShowTemplateDialog(open);
        }}
      >
        <DialogContent
          ref={templateDialogRef}
          className={tabletModeEnabled ? 'p-5 sm:p-6' : undefined}
          onInteractOutside={(event) => {
            if (!savingTemplate && isTemplateDirty) {
              event.preventDefault();
              triggerShakeAnimation(templateDialogRef.current);
            }
          }}
          onEscapeKeyDown={(event) => {
            if (!savingTemplate && isTemplateDirty) {
              event.preventDefault();
              triggerShakeAnimation(templateDialogRef.current);
            }
          }}
        >
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
                className={tabletModeEnabled ? 'min-h-11 text-base' : undefined}
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
                className={tabletModeEnabled ? 'text-base' : undefined}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="templateActive">Active</Label>
                <p className="text-xs text-muted-foreground">
                  Inactive templates won&apos;t appear when creating tasks
                </p>
              </div>
              <Switch
                id="templateActive"
                checked={templateActive}
                onCheckedChange={setTemplateActive}
              />
            </div>

            {/* Applies To Checkboxes */}
            <div className="space-y-3">
              <Label>Applies To <span className="text-red-500">*</span></Label>
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="template-applies-vehicle"
                    checked={templateAppliesToVehicle}
                    onCheckedChange={(checked) => setTemplateAppliesToVehicle(checked as boolean)}
                    className="border-slate-600"
                  />
                  <Label htmlFor="template-applies-vehicle" className="cursor-pointer flex items-center gap-2">
                    <Truck className="h-4 w-4 text-blue-400" />
                    Van Tasks
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="template-applies-hgv"
                    checked={templateAppliesToHgv}
                    onCheckedChange={(checked) => setTemplateAppliesToHgv(checked as boolean)}
                    className="border-slate-600"
                  />
                  <Label htmlFor="template-applies-hgv" className="cursor-pointer flex items-center gap-2">
                    <Truck className="h-4 w-4 text-cyan-400" />
                    HGV Tasks
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="template-applies-plant"
                    checked={templateAppliesToPlant}
                    onCheckedChange={(checked) => setTemplateAppliesToPlant(checked as boolean)}
                    className="border-slate-600"
                  />
                  <Label htmlFor="template-applies-plant" className="cursor-pointer flex items-center gap-2">
                    <HardHat className="h-4 w-4 text-orange-400" />
                    Plant Machinery Tasks
                  </Label>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Select which types of workshop tasks this template can be used for
              </p>
            </div>
          </div>

          <DialogFooter className={tabletModeEnabled ? 'gap-3 pt-2' : undefined}>
            <Button variant="outline" onClick={() => setShowTemplateDialog(false)} className={tabletModeEnabled ? 'min-h-11 text-base px-4' : undefined}>
              {isTemplateDirty ? 'Discard Changes' : 'Cancel'}
            </Button>
            <Button
              onClick={handleSaveTemplate}
              disabled={savingTemplate || !templateName.trim()}
              className={`bg-workshop hover:bg-workshop-dark text-white ${tabletModeEnabled ? 'min-h-11 text-base px-4' : ''}`}
            >
              {savingTemplate ? 'Saving...' : editingTemplate ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Question Dialog */}
      <Dialog
        open={showQuestionDialog}
        onOpenChange={(open) => {
          if (!open && !savingQuestion && isQuestionDirty) {
            triggerShakeAnimation(questionDialogRef.current);
            return;
          }
          setShowQuestionDialog(open);
        }}
      >
        <DialogContent
          ref={questionDialogRef}
          className={tabletModeEnabled ? 'p-5 sm:p-6' : undefined}
          onInteractOutside={(event) => {
            if (!savingQuestion && isQuestionDirty) {
              event.preventDefault();
              triggerShakeAnimation(questionDialogRef.current);
            }
          }}
          onEscapeKeyDown={(event) => {
            if (!savingQuestion && isQuestionDirty) {
              event.preventDefault();
              triggerShakeAnimation(questionDialogRef.current);
            }
          }}
        >
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
                className={tabletModeEnabled ? 'min-h-11 text-base' : undefined}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="questionType">Response Type</Label>
              <Select value={questionType} onValueChange={(v) => setQuestionType(v as Question['question_type'])}>
                <SelectTrigger className={tabletModeEnabled ? 'min-h-11 text-base' : undefined}>
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

          <DialogFooter className={tabletModeEnabled ? 'gap-3 pt-2' : undefined}>
            <Button variant="outline" onClick={() => setShowQuestionDialog(false)} className={tabletModeEnabled ? 'min-h-11 text-base px-4' : undefined}>
              {isQuestionDirty ? 'Discard Changes' : 'Cancel'}
            </Button>
            <Button
              onClick={handleSaveQuestion}
              disabled={savingQuestion || !questionText.trim()}
              className={`bg-workshop hover:bg-workshop-dark text-white ${tabletModeEnabled ? 'min-h-11 text-base px-4' : ''}`}
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
