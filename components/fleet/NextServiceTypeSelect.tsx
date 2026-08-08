'use client';

import { useEffect, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ServiceAssetType } from '@/lib/utils/assetServiceRotation';
import { compactServiceLabel } from '@/lib/utils/assetServiceRotation';

interface ServiceTemplateOption {
  templateId: string;
  templateName: string;
  compactLabel: string | null;
}

interface NextServiceTypeSelectProps {
  assetType: ServiceAssetType;
  value: string;
  onChange: (templateId: string) => void;
  disabled?: boolean;
  required?: boolean;
  id?: string;
}

export function NextServiceTypeSelect({
  assetType,
  value,
  onChange,
  disabled,
  required = true,
  id = 'next-service-type',
}: NextServiceTypeSelectProps) {
  const [options, setOptions] = useState<ServiceTemplateOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError('');
        const response = await fetch(`/api/fleet/service-types?assetType=${assetType}`);
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Failed to load service types');
        }
        const templates = ((data.templates || []) as ServiceTemplateOption[])
          .filter((template) => Boolean(template.templateId));
        if (!cancelled) {
          setOptions(templates);
          if (!value && templates.length === 1) {
            onChange(templates[0].templateId);
          }
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load service types');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // intentionally omit value/onChange to avoid re-fetch loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetType]);

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Next service type{required ? ' *' : ''}</Label>
      <Select value={value} onValueChange={onChange} disabled={disabled || loading || options.length === 0}>
        <SelectTrigger id={id} className="bg-slate-900 text-white">
          <SelectValue placeholder={loading ? 'Loading service types...' : 'Select next service type'} />
        </SelectTrigger>
        <SelectContent className="border-slate-700 bg-slate-900">
          {options.map((option) => (
            <SelectItem key={option.templateId} value={option.templateId} className="text-white">
              {compactServiceLabel(option.compactLabel, option.templateName)}
              {option.templateName ? ` — ${option.templateName}` : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error ? <p className="text-xs text-red-300">{error}</p> : null}
    </div>
  );
}
