'use client';

import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { MapPin, Trash2, UserPlus } from 'lucide-react';
import type { InventoryLocation } from '../types';
import {
  getInventoryLocationTypePresentation,
  isLegacyQuoteInventoryLocation,
} from '../utils';
import { LegacyQuoteLocationOptIn } from './LegacyQuoteLocationOptIn';

export interface InventorySiteAssignmentUser {
  id: string;
  full_name: string | null;
  employee_id: string | null;
}

export interface InventorySiteAssignment {
  user_id: string;
  location_id: string;
  assigned_by: string | null;
  assigned_at: string;
  note: string | null;
  user?: InventorySiteAssignmentUser | null;
  location?: InventoryLocation | null;
}

interface InventorySiteAssignmentsPanelProps {
  users: InventorySiteAssignmentUser[];
  assignableLocations: InventoryLocation[];
  assignments: InventorySiteAssignment[];
  onAssign: (payload: { userId: string; locationId: string }) => Promise<void>;
  onRemove: (payload: { userId: string; locationId: string }) => Promise<void>;
  onIncludeLegacyQuotesChange: (includeLegacyQuotes: boolean) => Promise<void>;
}

function getUserLabel(user: InventorySiteAssignmentUser | null | undefined): string {
  if (!user) return 'Unknown user';
  return [user.full_name || 'Unnamed user', user.employee_id ? `#${user.employee_id}` : null]
    .filter(Boolean)
    .join(' ');
}

function getLocationLabel(location: InventoryLocation | null | undefined): string {
  if (!location) return 'Unknown location';
  return location.external_reference
    ? `${location.external_reference} - ${location.name}`
    : location.name;
}

export function InventorySiteAssignmentsPanel({
  users,
  assignableLocations,
  assignments,
  onAssign,
  onRemove,
  onIncludeLegacyQuotesChange,
}: InventorySiteAssignmentsPanelProps) {
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [saving, setSaving] = useState(false);
  const [removingKey, setRemovingKey] = useState<string | null>(null);
  const [includeLegacyQuotes, setIncludeLegacyQuotes] = useState(false);

  const assignedLocationIdsForSelectedUser = useMemo(() => new Set(
    assignments
      .filter((assignment) => assignment.user_id === selectedUserId)
      .map((assignment) => assignment.location_id)
  ), [assignments, selectedUserId]);

  const availableLocations = useMemo(
    () => assignableLocations.filter((location) => (
      !assignedLocationIdsForSelectedUser.has(location.id)
      && (includeLegacyQuotes || !isLegacyQuoteInventoryLocation(location))
    )),
    [assignableLocations, assignedLocationIdsForSelectedUser, includeLegacyQuotes]
  );

  async function handleIncludeLegacyQuotesChange(nextIncludeLegacyQuotes: boolean) {
    setIncludeLegacyQuotes(nextIncludeLegacyQuotes);
    setSelectedLocationId('');
    await onIncludeLegacyQuotesChange(nextIncludeLegacyQuotes);
  }

  async function handleAssign() {
    if (!selectedUserId || !selectedLocationId) return;
    setSaving(true);
    try {
      await onAssign({ userId: selectedUserId, locationId: selectedLocationId });
      setSelectedLocationId('');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(assignment: InventorySiteAssignment) {
    const key = `${assignment.user_id}:${assignment.location_id}`;
    setRemovingKey(key);
    try {
      await onRemove({ userId: assignment.user_id, locationId: assignment.location_id });
    } finally {
      setRemovingKey(null);
    }
  }

  return (
    <Card className="border-slate-700 bg-slate-900/70">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-white">
          <MapPin className="h-5 w-5 text-inventory" />
          Location Assignments
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <div className="space-y-2">
            <Label>Employee</Label>
            <Select value={selectedUserId} onValueChange={(value) => {
              setSelectedUserId(value);
              setSelectedLocationId('');
            }}>
              <SelectTrigger className="min-h-11 border-slate-600 bg-slate-800">
                <SelectValue placeholder="Select employee" />
              </SelectTrigger>
              <SelectContent>
                {users.map((user) => (
                  <SelectItem key={user.id} value={user.id}>{getUserLabel(user)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <Label>Active Site or Manual Location</Label>
              <LegacyQuoteLocationOptIn
                enabled={includeLegacyQuotes}
                onEnabledChange={(enabled) => { void handleIncludeLegacyQuotesChange(enabled); }}
              />
            </div>
            <Select
              value={selectedLocationId}
              onValueChange={setSelectedLocationId}
              disabled={!selectedUserId}
              onOpenChange={(open) => {
                if (!open && includeLegacyQuotes) {
                  void handleIncludeLegacyQuotesChange(false);
                }
              }}
            >
              <SelectTrigger className="min-h-11 border-slate-600 bg-slate-800">
                <SelectValue placeholder="Select location" />
              </SelectTrigger>
              <SelectContent>
                {availableLocations.map((location) => (
                  <SelectItem key={location.id} value={location.id}>
                    {getLocationLabel(location)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            type="button"
            onClick={handleAssign}
            disabled={saving || !selectedUserId || !selectedLocationId}
            className="min-h-11 w-full bg-inventory text-white hover:bg-inventory-dark md:w-auto"
          >
            <UserPlus className="mr-2 h-4 w-4" />
            Assign Location
          </Button>
        </div>

        <div className="space-y-3">
          {assignments.length > 0 ? assignments.map((assignment) => {
            const key = `${assignment.user_id}:${assignment.location_id}`;
            const location = assignment.location
              || assignableLocations.find((candidate) => candidate.id === assignment.location_id);
            const presentation = getInventoryLocationTypePresentation(location || { location_type: 'site' });

            return (
              <div
                key={key}
                data-location-type={location?.location_type || 'site'}
                className={cn(
                  'flex flex-col gap-3 rounded-lg border p-3 transition-colors sm:flex-row sm:items-center sm:justify-between',
                  presentation.surfaceClassName,
                )}
              >
                <div className="min-w-0">
                  <div className="break-words font-medium text-white">{getUserLabel(assignment.user)}</div>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline" className={cn('max-w-full whitespace-normal break-words text-left', presentation.badgeClassName)}>
                      {getLocationLabel(location)}
                    </Badge>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => { void handleRemove(assignment); }}
                  disabled={removingKey === key}
                  className="min-h-11 w-full border-red-500/30 text-red-300 hover:bg-red-500/10 sm:w-auto"
                >
                  <Trash2 className="mr-2 h-3 w-3" />
                  Remove
                </Button>
              </div>
            );
          }) : (
            <p className="rounded-lg border border-slate-700 bg-slate-800/40 p-4 text-sm text-muted-foreground">
              No Site or Manual locations are assigned yet.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
