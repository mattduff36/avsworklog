'use client';

import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { PanelLoader } from '@/components/ui/panel-loader';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Edit, HardHat, Plus, Trash2, Truck } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { triggerShakeAnimation } from '@/lib/utils/animations';
import { useTabletMode } from '@/components/layout/tablet-mode-context';
import { toast } from 'sonner';
import { Database } from '@/types/database';
import { AttachmentSchemaBuilderPanel } from './AttachmentSchemaBuilderPanel';

type Template = Database['public']['Tables']['workshop_attachment_templates']['Row'];

interface AttachmentManagementPanelProps {
  assetPicker: ReactNode;
  taxonomyMode?: 'van' | 'plant' | 'hgv';
  selectedTemplateId: string | null;
  onSelectedTemplateChange: (templateId: string) => void;
  onTemplatesChanged: () => Promise<void>;
}

function normalizeTemplateAppliesTo(rawValues?: string[] | null): string[] {
  const normalized = (rawValues || [])
    .map((value) => value.trim().toLowerCase())
    .map((value) => (value === 'vehicle' ? 'van' : value))
    .filter(Boolean);

  if (normalized.length === 0) return ['van', 'hgv', 'plant'];
  return Array.from(new Set(normalized));
}

export function AttachmentManagementPanel({ taxonomyMode, selectedTemplateId, onSelectedTemplateChange, onTemplatesChanged, assetPicker }: AttachmentManagementPanelProps) {
  const supabase = createClient();
  const { tabletModeEnabled } = useTabletMode();

  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');
  const [templateActive, setTemplateActive] = useState(true);
  const [templateAppliesToVehicle, setTemplateAppliesToVehicle] = useState(true);
  const [templateAppliesToHgv, setTemplateAppliesToHgv] = useState(true);
  const [templateAppliesToPlant, setTemplateAppliesToPlant] = useState(true);
  const [savingTemplate, setSavingTemplate] = useState(false);

  const [deleteTemplateId, setDeleteTemplateId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const templateDialogRef = useRef<HTMLDivElement>(null);

  const fetchTemplates = useCallback(async () => {
    setLoadError(false);
    try {
      const { data, error } = await supabase
        .from('workshop_attachment_templates')
        .select('*')
        .order('name');
      if (error) throw error;
      setTemplates(data || []);
    } catch (error) {
      console.error('Error loading templates:', error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const filteredTemplates = useMemo(() => (
    taxonomyMode
      ? templates.filter((template) =>
          normalizeTemplateAppliesTo(template.applies_to).includes(taxonomyMode),
        )
      : templates
  ), [taxonomyMode, templates]);

  const selectedTemplate = filteredTemplates.find((template) => template.id === selectedTemplateId) ?? filteredTemplates[0];

  const isTemplateDirty = useMemo(() => {
    const originalName = editingTemplate?.name || '';
    const originalDescription = editingTemplate?.description || '';
    const originalActive = editingTemplate?.is_active ?? true;
    const originalAppliesTo = normalizeTemplateAppliesTo(editingTemplate?.applies_to);

    return (
      templateName.trim() !== originalName.trim()
      || templateDescription.trim() !== originalDescription.trim()
      || templateActive !== originalActive
      || templateAppliesToVehicle !== originalAppliesTo.includes('van')
      || templateAppliesToHgv !== originalAppliesTo.includes('hgv')
      || templateAppliesToPlant !== originalAppliesTo.includes('plant')
    );
  }, [
    editingTemplate,
    templateActive,
    templateAppliesToHgv,
    templateAppliesToPlant,
    templateAppliesToVehicle,
    templateDescription,
    templateName,
  ]);

  function resetTemplateDialogForCreate() {
    setEditingTemplate(null);
    setTemplateName('');
    setTemplateDescription('');
    setTemplateActive(true);
    setTemplateAppliesToVehicle(true);
    setTemplateAppliesToHgv(true);
    setTemplateAppliesToPlant(true);
    setShowTemplateDialog(true);
  }

  function resetTemplateDialogForEdit(template: Template) {
    const appliesTo = normalizeTemplateAppliesTo(template.applies_to);
    setEditingTemplate(template);
    setTemplateName(template.name);
    setTemplateDescription(template.description || '');
    setTemplateActive(template.is_active ?? true);
    setTemplateAppliesToVehicle(appliesTo.includes('van'));
    setTemplateAppliesToHgv(appliesTo.includes('hgv'));
    setTemplateAppliesToPlant(appliesTo.includes('plant'));
    setShowTemplateDialog(true);
  }

  async function handleSaveTemplate() {
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
      await Promise.all([fetchTemplates(), onTemplatesChanged()]);
    } catch (error) {
      console.error('Error saving template:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to save template');
    } finally {
      setSavingTemplate(false);
    }
  }

  async function handleDeleteTemplate() {
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
      await Promise.all([fetchTemplates(), onTemplatesChanged()]);
    } catch (error) {
      console.error('Error deleting template:', error);
      toast.error('Failed to delete template');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          {assetPicker && <div className="mb-3">{assetPicker}</div>}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>Attachment templates</CardTitle>
              <CardDescription>Manage the forms staff can attach to workshop tasks.</CardDescription>
            </div>
            <Button size="sm" onClick={resetTemplateDialogForCreate} className={tabletModeEnabled ? 'min-h-11 text-base' : undefined}>
              <Plus aria-hidden="true" className="h-4 w-4" /> Add template
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <PanelLoader message="Loading attachment templates..." accent="workshop" className="py-8" />
          ) : loadError ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span role="alert">Unable to load attachment templates.</span>
              <Button size="sm" variant="outline" onClick={() => { setLoading(true); void fetchTemplates(); }}>Retry</Button>
            </div>
          ) : selectedTemplate ? (
            <div className="grid min-w-0 rounded-lg border border-border md:grid-cols-[minmax(13rem,1fr)_minmax(0,2fr)]">
              <ul aria-label="Attachment templates" className="divide-y divide-border border-b border-border md:border-b-0 md:border-r">
                {filteredTemplates.map((template) => (
                  <li key={template.id}>
                    <button
                      type="button"
                      aria-pressed={selectedTemplate.id === template.id}
                      onClick={() => onSelectedTemplateChange(template.id)}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset aria-pressed:bg-muted aria-pressed:font-semibold ${tabletModeEnabled ? 'min-h-11' : 'min-h-10'}`}
                    >
                      <span className="min-w-0 break-words">{template.name}</span>
                      {!template.is_active && <Badge variant="outline">Inactive</Badge>}
                    </button>
                  </li>
                ))}
              </ul>

              <div className="min-w-0 space-y-4 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <h3 className="break-words font-semibold">{selectedTemplate.name}</h3>
                    {selectedTemplate.description && (
                      <p className="break-words text-sm text-muted-foreground">{selectedTemplate.description}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-3 pt-1 text-xs text-muted-foreground">
                      {normalizeTemplateAppliesTo(selectedTemplate.applies_to).includes('van') && (
                        <span className="inline-flex items-center gap-1"><Truck aria-hidden="true" className="h-3 w-3" /> Van</span>
                      )}
                      {normalizeTemplateAppliesTo(selectedTemplate.applies_to).includes('hgv') && (
                        <span className="inline-flex items-center gap-1"><Truck aria-hidden="true" className="h-3 w-3" /> HGV</span>
                      )}
                      {normalizeTemplateAppliesTo(selectedTemplate.applies_to).includes('plant') && (
                        <span className="inline-flex items-center gap-1"><HardHat aria-hidden="true" className="h-3 w-3" /> Plant</span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Button variant="ghost" size="sm" onClick={() => resetTemplateDialogForEdit(selectedTemplate)} className={tabletModeEnabled ? 'min-h-11 text-base' : undefined}>
                      <Edit aria-hidden="true" className="h-4 w-4" /> Edit template
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setDeleteTemplateId(selectedTemplate.id)} className={tabletModeEnabled ? 'min-h-11 text-base text-destructive' : 'text-destructive'}>
                      <Trash2 aria-hidden="true" className="h-4 w-4" /> Delete
                    </Button>
                  </div>
                </div>

                <details key={selectedTemplate.id} className="space-y-3 border-t border-border pt-3">
                  <summary className="w-fit cursor-pointer rounded text-sm font-medium focus-visible:outline focus-visible:outline-2">
                    Checklist editor
                  </summary>
                  <AttachmentSchemaBuilderPanel
                    templateId={selectedTemplate.id}
                    templateName={selectedTemplate.name}
                    templates={templates}
                  />
                </details>
              </div>
            </div>
          ) : <p className="text-sm text-muted-foreground">No attachment templates for this asset type.</p>}
        </CardContent>
      </Card>

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
            <DialogTitle>{editingTemplate ? 'Edit Template' : 'Create Template'}</DialogTitle>
            <DialogDescription>
              {editingTemplate ? 'Update template details' : 'Create a new attachment template'}
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
                onChange={(event) => setTemplateName(event.target.value)}
                placeholder="e.g., Full Service Checklist"
                className={tabletModeEnabled ? 'min-h-11 text-base' : undefined}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="templateDescription">Description</Label>
              <Textarea
                id="templateDescription"
                value={templateDescription}
                onChange={(event) => setTemplateDescription(event.target.value)}
                placeholder="Optional description"
                rows={3}
                className={tabletModeEnabled ? 'text-base' : undefined}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="templateActive">Active</Label>
                <p className="text-xs text-muted-foreground">
                  Inactive templates will not be available for new tasks.
                </p>
              </div>
              <Switch id="templateActive" checked={templateActive} onCheckedChange={setTemplateActive} />
            </div>

            <div className="space-y-3">
              <Label>Applies To <span className="text-red-500">*</span></Label>
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="template-applies-van"
                    checked={templateAppliesToVehicle}
                    onCheckedChange={(checked) => setTemplateAppliesToVehicle(Boolean(checked))}
                    className="border-slate-600"
                  />
                  <Label htmlFor="template-applies-van" className="cursor-pointer flex items-center gap-2">
                    <Truck className="h-4 w-4 text-blue-400" />
                    Van Tasks
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="template-applies-hgv"
                    checked={templateAppliesToHgv}
                    onCheckedChange={(checked) => setTemplateAppliesToHgv(Boolean(checked))}
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
                    onCheckedChange={(checked) => setTemplateAppliesToPlant(Boolean(checked))}
                    className="border-slate-600"
                  />
                  <Label htmlFor="template-applies-plant" className="cursor-pointer flex items-center gap-2">
                    <HardHat className="h-4 w-4 text-orange-400" />
                    Plant Tasks
                  </Label>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className={tabletModeEnabled ? 'gap-3 pt-2' : undefined}>
            <Button
              variant="outline"
              onClick={() => setShowTemplateDialog(false)}
              className={tabletModeEnabled ? 'min-h-11 text-base px-4' : undefined}
            >
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

      <AlertDialog open={Boolean(deleteTemplateId)} onOpenChange={(open) => !open && setDeleteTemplateId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Template?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the template and all V2 schema versions.
              Existing task attachments retain their immutable schema snapshots.
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
    </>
  );
}
