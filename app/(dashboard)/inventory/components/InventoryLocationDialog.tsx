'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  dialogContentViewportClassName,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import {
  EMPTY_INVENTORY_LOCATION_FORM,
  type FleetAssetLinkType,
  type FleetAssetOption,
  type InventoryLocation,
  type InventoryLocationFormData,
} from '../types';

interface InventoryLocationDialogProps {
  open: boolean;
  location?: InventoryLocation | null;
  fleetAssets: FleetAssetOption[];
  onClose: () => void;
  onSubmit: (data: InventoryLocationFormData) => Promise<void>;
}

function getLinkedAssetType(location: InventoryLocation): FleetAssetLinkType | 'none' {
  if (location.linked_van_id) return 'van';
  if (location.linked_hgv_id) return 'hgv';
  if (location.linked_plant_id) return 'plant';
  return 'none';
}

function getLinkedAssetId(location: InventoryLocation): string {
  return location.linked_van_id || location.linked_hgv_id || location.linked_plant_id || '';
}

export function InventoryLocationDialog({
  open,
  location,
  fleetAssets,
  onClose,
  onSubmit,
}: InventoryLocationDialogProps) {
  const [form, setForm] = useState<InventoryLocationFormData>(EMPTY_INVENTORY_LOCATION_FORM);
  const [saving, setSaving] = useState(false);
  const isEditing = !!location;
  const canEditLinkedAsset = !location || location.location_type === 'manual';

  const filteredAssets = useMemo(() => {
    if (form.linked_asset_type === 'none') return [];
    return fleetAssets.filter((asset) => asset.type === form.linked_asset_type);
  }, [fleetAssets, form.linked_asset_type]);

  useEffect(() => {
    if (location) {
      setForm({
        name: location.name,
        description: location.description || '',
        linked_asset_type: getLinkedAssetType(location),
        linked_asset_id: getLinkedAssetId(location),
      });
      return;
    }

    setForm(EMPTY_INVENTORY_LOCATION_FORM);
  }, [location, open]);

  function updateField<K extends keyof InventoryLocationFormData>(key: K, value: InventoryLocationFormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSubmit(form);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen && !saving) onClose(); }}>
      <DialogContent
        mobileKeyboardSafe
        data-keyboard-safe-dialog="true"
        className={dialogContentViewportClassName({
          size: 'xl',
          scroll: 'content',
          className: 'top-0 h-[100dvh] max-h-none w-screen max-w-none translate-y-0 gap-0 rounded-none border-slate-700 bg-slate-900 p-0 text-white sm:top-1/2 sm:h-auto sm:max-h-[calc(100dvh-1rem)] sm:w-[calc(100vw-1rem)] sm:max-w-xl sm:-translate-y-1/2 sm:rounded-xl',
        })}
      >
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader className="shrink-0 px-6 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))] sm:pt-6">
            <DialogTitle>{isEditing ? 'Edit Location' : 'Add Location'}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {canEditLinkedAsset
                ? 'Create a manual location bucket and optionally link it to a current fleet asset.'
                : 'This generated location is synced from its source. Edit display details only.'}
            </DialogDescription>
          </DialogHeader>

          <div
            data-mobile-scroll-lock="true"
            className="grid min-h-0 flex-1 gap-4 overflow-y-auto overscroll-contain px-6 py-4"
          >
            <div className="space-y-2">
              <Label htmlFor="location_name">Location Name *</Label>
              <Input
                id="location_name"
                required
                value={form.name}
                onChange={(event) => updateField('name', event.target.value)}
                className="bg-slate-800 border-slate-600"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="location_description">Description</Label>
              <Textarea
                id="location_description"
                value={form.description}
                onChange={(event) => updateField('description', event.target.value)}
                className="bg-slate-800 border-slate-600"
                rows={3}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Linked Asset Type</Label>
                <Select
                  value={form.linked_asset_type}
                  disabled={!canEditLinkedAsset}
                  onValueChange={(value) => {
                    updateField('linked_asset_type', value as FleetAssetLinkType | 'none');
                    updateField('linked_asset_id', '');
                  }}
                >
                  <SelectTrigger className="bg-slate-800 border-slate-600">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No linked asset</SelectItem>
                    <SelectItem value="van">Van</SelectItem>
                    <SelectItem value="hgv">HGV</SelectItem>
                    <SelectItem value="plant">Plant</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Linked Asset</Label>
                <Select
                  value={form.linked_asset_id || 'none'}
                  disabled={!canEditLinkedAsset || form.linked_asset_type === 'none'}
                  onValueChange={(value) => updateField('linked_asset_id', value === 'none' ? '' : value)}
                >
                  <SelectTrigger className="bg-slate-800 border-slate-600">
                    <SelectValue placeholder="Select asset" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No asset selected</SelectItem>
                    {filteredAssets.map((asset) => (
                      <SelectItem key={asset.id} value={asset.id}>{asset.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {!canEditLinkedAsset ? (
              <p className="text-xs text-muted-foreground">
                Linked assets for van, HGV, plant, site, Yard, and Unknown locations are maintained by sync rules.
              </p>
            ) : null}
          </div>

          <DialogFooter className="shrink-0 border-t border-slate-700 px-6 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:pb-6">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" className="bg-inventory text-white hover:bg-inventory-dark" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEditing ? 'Save Location' : 'Add Location'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
