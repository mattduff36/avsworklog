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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { InventoryLocationSelect } from '@/app/(dashboard)/inventory/components/InventoryLocationSelect';
import type { FleetAssetLinkType, FleetAssetOption, InventoryLocation } from '@/app/(dashboard)/inventory/types';
import { isOperationalInventoryLocation } from '@/app/(dashboard)/inventory/utils';
import type { ReminderActionWithAsset } from '@/types/reminders';

interface YardTransferAllocateDialogProps {
  open: boolean;
  action: ReminderActionWithAsset | null;
  onOpenChange: (open: boolean) => void;
  onAllocated: () => Promise<void> | void;
}

function getMetadataString(action: ReminderActionWithAsset | null, key: string): string {
  const value = action?.metadata?.[key];
  return typeof value === 'string' ? value : '';
}

export function YardTransferAllocateDialog({
  open,
  action,
  onOpenChange,
  onAllocated,
}: YardTransferAllocateDialogProps) {
  const [mode, setMode] = useState<'existing' | 'create'>('existing');
  const [locationId, setLocationId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [linkedAssetType, setLinkedAssetType] = useState<FleetAssetLinkType | 'none'>('none');
  const [linkedAssetId, setLinkedAssetId] = useState('');
  const [fleetAssets, setFleetAssets] = useState<FleetAssetOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const typedDetails = getMetadataString(action, 'location_details') || action?.description || '';

  useEffect(() => {
    if (!open) return;
    setMode('existing');
    setLocationId('');
    setName('');
    setDescription(typedDetails);
    setLinkedAssetType('none');
    setLinkedAssetId('');
    setError('');
    void fetch('/api/actions/fleet-assets', { cache: 'no-store' })
      .then((response) => response.json())
      .then((payload) => setFleetAssets(payload.assets || []))
      .catch(() => setFleetAssets([]));
  }, [open, typedDetails]);

  const filteredAssets = useMemo(() => {
    if (linkedAssetType === 'none') return [];
    return fleetAssets.filter((asset) => asset.type === linkedAssetType);
  }, [fleetAssets, linkedAssetType]);

  async function handleSubmit() {
    if (!action) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/actions/allocate-kiosk-take', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'existing'
          ? {
            action_id: action.id,
            destination_location_id: locationId,
          }
          : {
            action_id: action.id,
            new_location: {
              name,
              description,
              linked_asset_type: linkedAssetType,
              linked_asset_id: linkedAssetId || null,
            },
          }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to allocate the Yard take');
      }
      onOpenChange(false);
      await onAllocated();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to allocate the Yard take');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={dialogContentViewportClassName()}>
        <DialogHeader>
          <DialogTitle>Allocate Yard take</DialogTitle>
          <DialogDescription>
            Move the collected stock from In transfer to the real location.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {typedDetails ? (
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
              <p className="font-medium">Typed location details</p>
              <p className="mt-1 text-muted-foreground">{typedDetails}</p>
            </div>
          ) : null}

          <RadioGroup value={mode} onValueChange={(value) => setMode(value as 'existing' | 'create')}>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="existing" id="allocate-existing" />
              <Label htmlFor="allocate-existing">Use an existing location</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="create" id="allocate-create" />
              <Label htmlFor="allocate-create">Create a location</Label>
            </div>
          </RadioGroup>

          {mode === 'existing' ? (
            <InventoryLocationSelect
              value={locationId}
              onValueChange={(value) => setLocationId(value)}
              serverSearch
              searchEndpoint="/api/actions/inventory-locations"
              locationFilter={(location: InventoryLocation) => isOperationalInventoryLocation(location)}
              allowLegacyQuoteOptIn
              placeholder="Search a van, site or location"
              ariaLabel="Destination location"
            />
          ) : (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="allocate-name">Location name</Label>
                <Input
                  id="allocate-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Van, site or store name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="allocate-description">Description</Label>
                <Textarea
                  id="allocate-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Link a fleet asset</Label>
                <Select
                  value={linkedAssetType}
                  onValueChange={(value) => {
                    setLinkedAssetType(value as FleetAssetLinkType | 'none');
                    setLinkedAssetId('');
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No fleet link</SelectItem>
                    <SelectItem value="van">Van</SelectItem>
                    <SelectItem value="hgv">HGV</SelectItem>
                    <SelectItem value="plant">Plant</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {linkedAssetType !== 'none' ? (
                <div className="space-y-2">
                  <Label>Fleet asset</Label>
                  <Select value={linkedAssetId} onValueChange={setLinkedAssetId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose an asset" />
                    </SelectTrigger>
                    <SelectContent>
                      {filteredAssets.map((asset) => (
                        <SelectItem key={asset.id} value={asset.id}>
                          {asset.label}
                          {asset.description ? ` (${asset.description})` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>
          )}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={
              saving
              || (mode === 'existing'
                ? !locationId
                : !name.trim() || (linkedAssetType !== 'none' && !linkedAssetId))
            }
          >
            {saving ? 'Allocating…' : 'Allocate location'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
