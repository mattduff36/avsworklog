'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { addDays, format, parseISO } from 'date-fns';
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { AppPageHeader, AppPageShell } from '@/components/layout/AppPageShell';
import { AppPageLoadingShell } from '@/components/layout/AppPageLoadingShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { JobCataloguePicker } from '@/components/daily-allocation/JobCataloguePicker';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { usePermissionSnapshot } from '@/lib/hooks/usePermissionSnapshot';
import { formatFleetAssetLabel } from '@/lib/utils/fleet-asset-label';
import type { DailyAllocationBoardPayload, DailyLabourBoardRow, DailyPlantBoardRow } from '@/types/daily-allocation';
import type { JobCatalogueOption } from '@/types/job-catalogue';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

function tomorrowIso() {
  return format(addDays(new Date(), 1), 'yyyy-MM-dd');
}

export default function DailyAllocationBoardPage() {
  const { hasPermission, loading: permissionLoading } = usePermissionCheck('daily-allocation');
  const { permissionLevels } = usePermissionSnapshot();
  const [workDate, setWorkDate] = useState(tomorrowIso);
  const [board, setBoard] = useState<DailyAllocationBoardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [hiredSerial, setHiredSerial] = useState('');
  const [hiredDescription, setHiredDescription] = useState('');
  const [hiredCompany, setHiredCompany] = useState('');
  const [hiredJob, setHiredJob] = useState<JobCatalogueOption | null>(null);
  const [registeredPlantId, setRegisteredPlantId] = useState('');
  const [registeredJob, setRegisteredJob] = useState<JobCatalogueOption | null>(null);
  const canManage = (permissionLevels?.['daily-allocation'] || 0) >= 4 || Boolean(board?.context.is_manager);

  const loadBoard = useCallback(async (date: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/daily-allocation/board?date=${date}`, { cache: 'no-store' });
      const payload = await response.json() as DailyAllocationBoardPayload & { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Unable to load the allocation board.');
      setBoard(payload);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to load the allocation board.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!hasPermission || permissionLoading) return;
    void loadBoard(workDate);
  }, [hasPermission, loadBoard, permissionLoading, workDate]);

  const incompleteCount = useMemo(
    () => (board?.labour || []).filter((row) => !row.publish_ready).length,
    [board]
  );

  async function saveLabour(row: DailyLabourBoardRow, patch: Partial<DailyLabourBoardRow['draft']> & {
    job_source_type?: string | null;
    job_source_id?: string | null;
    job_code?: string | null;
    start_time?: string | null;
    meeting_point?: string | null;
    meet_person?: string | null;
    notes?: string | null;
  }) {
    setSavingId(row.profile_id);
    try {
      const response = await fetch('/api/daily-allocation/labour', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          work_date: workDate,
          profile_id: row.profile_id,
          job_source_type: patch?.job_source_type ?? row.draft?.job_source_type,
          job_source_id: patch?.job_source_id ?? row.draft?.job_source_id,
          job_code: patch?.job_code ?? row.draft?.job_code,
          start_time: patch?.start_time ?? row.draft?.instructions.start_time,
          meeting_point: patch?.meeting_point ?? row.draft?.instructions.meeting_point,
          meet_person: patch?.meet_person ?? row.draft?.instructions.meet_person,
          notes: patch?.notes ?? row.draft?.instructions.notes,
          row_version: row.draft?.row_version,
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Unable to save allocation.');
      await loadBoard(workDate);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save allocation.');
    } finally {
      setSavingId(null);
    }
  }

  async function savePlant(body: Record<string, unknown>) {
    setSavingId('plant');
    try {
      const response = await fetch('/api/daily-allocation/plant', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ work_date: workDate, ...body }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Unable to save plant allocation.');
      await loadBoard(workDate);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save plant allocation.');
    } finally {
      setSavingId(null);
    }
  }

  async function publish() {
    setPublishing(true);
    try {
      const response = await fetch('/api/daily-allocation/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          work_date: workDate,
          idempotency_key: `${workDate}:${board?.context.user_id}:${Date.now()}`,
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Unable to publish.');
      toast.success('Allocation published. Employees have been notified.');
      setConfirmPublish(false);
      await loadBoard(workDate);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to publish.');
    } finally {
      setPublishing(false);
    }
  }

  if (permissionLoading || !hasPermission || loading) {
    return <AppPageLoadingShell title="Daily Allocation" message="Loading daily allocation..." />;
  }

  if (!canManage) {
    return (
      <AppPageShell>
        <AppPageHeader title="Daily Allocation" description="Manager access is required to plan this board." />
      </AppPageShell>
    );
  }

  return (
    <AppPageShell width="wide">
      <AppPageHeader
        title="Daily Allocation"
        description="Assign one primary job per employee, plan plant, then publish immutable instructions."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => setWorkDate(format(addDays(parseISO(workDate), -1), 'yyyy-MM-dd'))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Input
              type="date"
              value={workDate}
              onChange={(event) => setWorkDate(event.target.value)}
              className="w-auto"
            />
            <Button variant="outline" onClick={() => setWorkDate(format(addDays(parseISO(workDate), 1), 'yyyy-MM-dd'))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button onClick={() => setConfirmPublish(true)} disabled={loading || incompleteCount > 0}>
              Publish
            </Button>
          </div>
        }
      />

      {loading || !board ? (
        <AppPageLoadingShell title="Daily Allocation" message="Loading board..." />
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            {board.latest_publication ? (
              <span>
                Latest published revision {board.latest_publication.revision_no}
                {board.latest_publication.published_by_name ? ` by ${board.latest_publication.published_by_name}` : ''}
              </span>
            ) : (
              <span>No published revision for this date yet.</span>
            )}
            {incompleteCount > 0 ? (
              <Badge variant="secondary">{incompleteCount} employee{incompleteCount === 1 ? '' : 's'} still need a job</Badge>
            ) : (
              <Badge>Ready to publish</Badge>
            )}
          </div>

          <div className="space-y-4">
            {board.labour.map((row) => (
              <LabourRow
                key={row.profile_id}
                row={row}
                disabled={row.availability === 'full_day_absence' || savingId === row.profile_id}
                onJobSelect={(option) => void saveLabour(row, {
                  job_source_type: option?.source || null,
                  job_source_id: option?.sourceId || null,
                  job_code: option?.value || null,
                })}
                onInstructionChange={(field, value) => void saveLabour(row, { [field]: value })}
              />
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Plant planning</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-3 rounded-lg border p-4">
                  <h3 className="font-medium">Registered plant</h3>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={registeredPlantId}
                    onChange={(event) => setRegisteredPlantId(event.target.value)}
                  >
                    <option value="">Select plant</option>
                    {board.available_plant.map((plant) => (
                      <option key={plant.id} value={plant.id}>
                        {formatFleetAssetLabel({ identifier: plant.plant_id, nickname: plant.nickname })}
                      </option>
                    ))}
                  </select>
                  <JobCataloguePicker value={registeredJob?.value || null} sourceId={registeredJob?.sourceId} onSelect={setRegisteredJob} />
                  <Button
                    disabled={!registeredPlantId || !registeredJob}
                    onClick={() => void savePlant({
                      plant_kind: 'registered',
                      plant_id: registeredPlantId,
                      job_source_type: registeredJob?.source,
                      job_source_id: registeredJob?.sourceId,
                      job_code: registeredJob?.value,
                    })}
                  >
                    Add registered plant
                  </Button>
                </div>
                <div className="space-y-3 rounded-lg border p-4">
                  <h3 className="font-medium">Hired plant</h3>
                  <Input placeholder="Serial / ID" value={hiredSerial} onChange={(event) => setHiredSerial(event.target.value)} />
                  <Input placeholder="Description" value={hiredDescription} onChange={(event) => setHiredDescription(event.target.value)} />
                  <Input placeholder="Hire company" value={hiredCompany} onChange={(event) => setHiredCompany(event.target.value)} />
                  <JobCataloguePicker value={hiredJob?.value || null} sourceId={hiredJob?.sourceId} onSelect={setHiredJob} />
                  <Button
                    disabled={!hiredSerial || !hiredDescription || !hiredCompany || !hiredJob}
                    onClick={() => void savePlant({
                      plant_kind: 'hired',
                      hired_serial: hiredSerial,
                      hired_description: hiredDescription,
                      hired_company: hiredCompany,
                      job_source_type: hiredJob?.source,
                      job_source_id: hiredJob?.sourceId,
                      job_code: hiredJob?.value,
                    })}
                  >
                    Add hired plant
                  </Button>
                </div>
              </div>

              <div className="space-y-3">
                {board.plant.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No plant planned for this date.</p>
                ) : board.plant.map((row) => (
                  <PlantRow
                    key={row.draft.id}
                    row={row}
                    onRemove={async () => {
                      const response = await fetch(`/api/daily-allocation/plant?id=${row.draft.id}`, { method: 'DELETE' });
                      const payload = await response.json() as { error?: string };
                      if (!response.ok) throw new Error(payload.error || 'Unable to remove plant.');
                      await loadBoard(workDate);
                    }}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <AlertDialog open={confirmPublish} onOpenChange={setConfirmPublish}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish allocation for {workDate}?</AlertDialogTitle>
            <AlertDialogDescription>
              This creates an immutable revision and sends a low-priority in-app message to each employee in scope. Later edits stay in draft until you publish again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void publish()} disabled={publishing}>
              {publishing ? 'Publishing…' : 'Publish'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppPageShell>
  );
}

function LabourRow({
  row,
  disabled,
  onJobSelect,
  onInstructionChange,
}: {
  row: DailyLabourBoardRow;
  disabled: boolean;
  onJobSelect: (option: JobCatalogueOption | null) => void;
  onInstructionChange: (field: 'start_time' | 'meeting_point' | 'meet_person' | 'notes', value: string) => void;
}) {
  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="font-semibold">{row.full_name}</h3>
            <p className="text-sm text-muted-foreground">{[row.employee_id, row.team_name].filter(Boolean).join(' · ')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {row.availability !== 'available' ? (
              <Badge variant="secondary">{row.blocking_absence?.reason_name || row.availability.replaceAll('_', ' ')}</Badge>
            ) : null}
            {row.pending_absence ? <Badge variant="outline">Pending absence</Badge> : null}
            {row.publish_ready ? <Badge>Ready</Badge> : <Badge variant="secondary">Incomplete</Badge>}
          </div>
        </div>
        {row.warnings.map((warning) => (
          <p key={warning} className="text-sm text-amber-600">{warning}</p>
        ))}
        {row.availability !== 'full_day_absence' ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <Label>Job code</Label>
              <JobCataloguePicker
                value={row.draft?.job_code || null}
                sourceId={row.draft?.job_source_id}
                disabled={disabled}
                onSelect={onJobSelect}
              />
              <p className="text-sm text-muted-foreground">
                Site: {row.draft?.site_address || 'Derived from the selected job'}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Start time</Label>
                <Input
                  defaultValue={row.draft?.instructions.start_time || ''}
                  disabled={disabled}
                  onBlur={(event) => onInstructionChange('start_time', event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Meeting point</Label>
                <Input
                  defaultValue={row.draft?.instructions.meeting_point || ''}
                  disabled={disabled}
                  onBlur={(event) => onInstructionChange('meeting_point', event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Meet</Label>
                <Input
                  defaultValue={row.draft?.instructions.meet_person || ''}
                  disabled={disabled}
                  onBlur={(event) => onInstructionChange('meet_person', event.target.value)}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Notes</Label>
                <Textarea
                  defaultValue={row.draft?.instructions.notes || ''}
                  disabled={disabled}
                  onBlur={(event) => onInstructionChange('notes', event.target.value)}
                />
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Approved leave replaces work for this date.</p>
        )}
      </CardContent>
    </Card>
  );
}

function PlantRow({ row, onRemove }: { row: DailyPlantBoardRow; onRemove: () => Promise<void> }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-medium">{row.plant_label}</p>
        <p className="text-sm text-muted-foreground">
          {row.draft.job_code} · {row.draft.site_address}
        </p>
        {row.warnings.map((warning) => (
          <p key={warning} className="text-sm text-amber-600">{warning}</p>
        ))}
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          void onRemove().catch((error: unknown) => {
            toast.error(error instanceof Error ? error.message : 'Unable to remove plant.');
          });
        }}
      >
        <Trash2 className="mr-2 h-4 w-4" />
        Remove
      </Button>
    </div>
  );
}
