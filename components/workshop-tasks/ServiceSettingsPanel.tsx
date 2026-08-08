'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Save, ArrowUp, ArrowDown, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ServiceAssetType, ServiceMeterUnit } from '@/lib/utils/assetServiceRotation';
import { useAttachmentTemplates } from '@/lib/hooks/useAttachmentTemplates';

interface ServiceSettingsPanelProps {
  assetType: ServiceAssetType;
}

interface LinkedTemplate {
  templateId: string;
  templateName: string;
  sortOrder: number;
  compactLabel: string | null;
  isActive: boolean;
}

interface RotationStep {
  id?: string;
  position: number;
  templateId: string;
  templateName?: string | null;
  compactLabel?: string | null;
}

export function ServiceSettingsPanel({ assetType }: ServiceSettingsPanelProps) {
  const { templates: allTemplates } = useAttachmentTemplates();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [intervalValue, setIntervalValue] = useState('0');
  const [intervalUnit, setIntervalUnit] = useState<ServiceMeterUnit>(
    assetType === 'hgv' ? 'km' : assetType === 'plant' ? 'hours' : 'miles',
  );
  const [linkedTemplates, setLinkedTemplates] = useState<LinkedTemplate[]>([]);
  const [rotation, setRotation] = useState<RotationStep[]>([]);
  const [addTemplateId, setAddTemplateId] = useState('');

  const loadSettings = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/workshop-tasks/service-settings?assetType=${assetType}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to load service settings');
      setIntervalValue(String(data.settings.intervalValue));
      setIntervalUnit(data.settings.intervalUnit);
      setLinkedTemplates(data.settings.linkedTemplates || []);
      setRotation(data.settings.rotation || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load service settings');
    } finally {
      setLoading(false);
    }
  }, [assetType]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const scopedTemplates = (allTemplates || []).filter((template) => {
    const appliesTo = (template.applies_to || []) as string[];
    if (assetType === 'van') {
      return appliesTo.includes('van') || appliesTo.includes('vehicle');
    }
    return appliesTo.includes(assetType);
  });

  const availableToLink = scopedTemplates.filter(
    (template) => !linkedTemplates.some((linked) => linked.templateId === template.id),
  );

  async function handleSave() {
    try {
      setSaving(true);
      const compactLabels: Record<string, string | null> = {};
      for (const linked of linkedTemplates) {
        compactLabels[linked.templateId] = linked.compactLabel;
      }
      const response = await fetch('/api/workshop-tasks/service-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetType,
          intervalValue: Number(intervalValue),
          intervalUnit,
          linkedTemplateIds: linkedTemplates.map((template) => template.templateId),
          compactLabels,
          rotationTemplateIds: rotation.map((step) => step.templateId),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to save settings');
      setLinkedTemplates(data.settings.linkedTemplates || []);
      setRotation(data.settings.rotation || []);
      toast.success('Service settings saved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading service settings...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Service Interval & Rotation</CardTitle>
        <CardDescription>
          Configure the {assetType.toUpperCase()} service interval, linked service attachments, and rotation order.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor={`${assetType}-interval-value`}>Service interval</Label>
            <Input
              id={`${assetType}-interval-value`}
              type="number"
              min="1"
              value={intervalValue}
              onChange={(event) => setIntervalValue(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${assetType}-interval-unit`}>Unit</Label>
            <Select value={intervalUnit} onValueChange={(value) => setIntervalUnit(value as ServiceMeterUnit)}>
              <SelectTrigger id={`${assetType}-interval-unit`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {assetType === 'plant' ? (
                  <SelectItem value="hours">Hours</SelectItem>
                ) : assetType === 'hgv' ? (
                  <>
                    <SelectItem value="km">Kilometres</SelectItem>
                    <SelectItem value="miles">Miles</SelectItem>
                  </>
                ) : (
                  <>
                    <SelectItem value="miles">Miles</SelectItem>
                    <SelectItem value="km">Kilometres</SelectItem>
                  </>
                )}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-3">
          <Label>Linked service attachments</Label>
          <div className="space-y-2">
            {linkedTemplates.map((linked) => (
              <div key={linked.templateId} className="flex flex-col sm:flex-row gap-2 items-start sm:items-center border rounded-md p-2">
                <div className="flex-1 text-sm font-medium">{linked.templateName}</div>
                <Input
                  className="sm:w-32"
                  placeholder="Badge label"
                  value={linked.compactLabel || ''}
                  onChange={(event) =>
                    setLinkedTemplates((prev) =>
                      prev.map((item) =>
                        item.templateId === linked.templateId
                          ? { ...item, compactLabel: event.target.value || null }
                          : item,
                      ),
                    )
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setLinkedTemplates((prev) => prev.filter((item) => item.templateId !== linked.templateId));
                    setRotation((prev) => prev.filter((step) => step.templateId !== linked.templateId));
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Select value={addTemplateId} onValueChange={setAddTemplateId}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Add linked attachment" />
              </SelectTrigger>
              <SelectContent>
                {availableToLink.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              disabled={!addTemplateId}
              onClick={() => {
                const template = availableToLink.find((item) => item.id === addTemplateId);
                if (!template) return;
                setLinkedTemplates((prev) => [
                  ...prev,
                  {
                    templateId: template.id,
                    templateName: template.name,
                    sortOrder: prev.length + 1,
                    compactLabel: null,
                    isActive: true,
                  },
                ]);
                if (rotation.length === 0) {
                  setRotation([{ position: 1, templateId: template.id, templateName: template.name }]);
                }
                setAddTemplateId('');
              }}
            >
              <Plus className="h-4 w-4 mr-1" /> Add
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          <Label>Service rotation order</Label>
          <p className="text-xs text-muted-foreground">
            The same attachment can appear more than once (for example Basic A → Basic B → Basic A → Full).
          </p>
          <div className="space-y-2">
            {rotation.map((step, index) => {
              const label =
                linkedTemplates.find((linked) => linked.templateId === step.templateId)?.templateName ||
                step.templateName ||
                step.templateId;
              return (
                <div key={`${step.templateId}-${index}`} className="flex items-center gap-2 border rounded-md p-2">
                  <span className="text-xs text-muted-foreground w-6">{index + 1}.</span>
                  <div className="flex-1 text-sm">{label}</div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={index === 0}
                    onClick={() =>
                      setRotation((prev) => {
                        const next = [...prev];
                        [next[index - 1], next[index]] = [next[index], next[index - 1]];
                        return next.map((item, position) => ({ ...item, position: position + 1 }));
                      })
                    }
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={index === rotation.length - 1}
                    onClick={() =>
                      setRotation((prev) => {
                        const next = [...prev];
                        [next[index + 1], next[index]] = [next[index], next[index + 1]];
                        return next.map((item, position) => ({ ...item, position: position + 1 }));
                      })
                    }
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setRotation((prev) => prev.filter((_, i) => i !== index))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </div>
          <Select
            value=""
            onValueChange={(templateId) => {
              const linked = linkedTemplates.find((item) => item.templateId === templateId);
              if (!linked) return;
              setRotation((prev) => [
                ...prev,
                {
                  position: prev.length + 1,
                  templateId,
                  templateName: linked.templateName,
                  compactLabel: linked.compactLabel,
                },
              ]);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Append rotation step from linked attachments" />
            </SelectTrigger>
            <SelectContent>
              {linkedTemplates.map((linked) => (
                <SelectItem key={`rot-${linked.templateId}-${linked.sortOrder}`} value={linked.templateId}>
                  {linked.templateName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex justify-end">
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Save service settings
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
