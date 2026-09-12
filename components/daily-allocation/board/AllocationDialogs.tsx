'use client';

import { useState } from 'react';
import { format, parseISO } from 'date-fns';
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
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { JobCataloguePicker } from '@/components/daily-allocation/JobCataloguePicker';
import { boardControlStyles } from '@/components/daily-allocation/board/board-control-styles';
import { cn } from '@/lib/utils/cn';
import type { JobCatalogueOption } from '@/types/job-catalogue';
import type {
  DailyAllocationConflictKind,
  DailyAllocationEmployeeResource,
  DailyAllocationLabourAssignment,
  DailyAllocationPlantAssignment,
  DailyAllocationPlantResource,
  DailyAllocationVisit,
} from '@/types/daily-allocation';
import { formatFleetAssetLabel } from '@/lib/utils/fleet-asset-label';
import { employeeLabel } from '@/components/daily-allocation/board/board-model';

export interface VisitFormState {
  job: JobCatalogueOption | null;
  workDate: string;
  startTime: string;
  endTime: string;
  meetingPoint: string;
  meetPerson: string;
  notes: string;
}

export function emptyVisitForm(workDate: string): VisitFormState {
  return {
    job: null,
    workDate,
    startTime: '08:00',
    endTime: '11:00',
    meetingPoint: '',
    meetPerson: '',
    notes: '',
  };
}

export function VisitEditorDialog({
  open,
  mode,
  form,
  onFormChange,
  onOpenChange,
  onSubmit,
  saving,
}: {
  open: boolean;
  mode: 'add' | 'edit';
  form: VisitFormState;
  onFormChange: (form: VisitFormState) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
  saving?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg border-slate-700 bg-slate-900 text-slate-50">
        <DialogHeader>
          <DialogTitle>{mode === 'add' ? 'Add visit' : 'Edit visit'}</DialogTitle>
          <DialogDescription>
            Timed visits use London wall time on a 30-minute grid. End must be after start.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="space-y-2">
            <Label>Job</Label>
            <JobCataloguePicker
              value={form.job?.value || null}
              sourceId={form.job?.sourceId}
              onSelect={(job) => onFormChange({ ...form, job })}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="daily-allocation-visit-date">Date</Label>
              <Input
                id="daily-allocation-visit-date"
                type="date"
                value={form.workDate}
                disabled={mode === 'edit'}
                onChange={(event) => {
                  if (mode === 'edit') return;
                  onFormChange({ ...form, workDate: event.target.value });
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="daily-allocation-visit-start">Start</Label>
              <Input
                id="daily-allocation-visit-start"
                type="time"
                step={1800}
                value={form.startTime}
                onChange={(event) => onFormChange({ ...form, startTime: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="daily-allocation-visit-end">End</Label>
              <Input
                id="daily-allocation-visit-end"
                type="time"
                step={1800}
                value={form.endTime}
                onChange={(event) => onFormChange({ ...form, endTime: event.target.value })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="daily-allocation-visit-meeting">Meeting point</Label>
            <Input
              id="daily-allocation-visit-meeting"
              value={form.meetingPoint}
              onChange={(event) => onFormChange({ ...form, meetingPoint: event.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="daily-allocation-visit-meet">Meet</Label>
            <Input
              id="daily-allocation-visit-meet"
              value={form.meetPerson}
              onChange={(event) => onFormChange({ ...form, meetPerson: event.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="daily-allocation-visit-notes">Instructions</Label>
            <Textarea
              id="daily-allocation-visit-notes"
              value={form.notes}
              onChange={(event) => onFormChange({ ...form, notes: event.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" className={boardControlStyles.outline} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" className={boardControlStyles.primary} onClick={onSubmit} disabled={saving || !form.job}>
            {saving ? 'Saving…' : mode === 'add' ? 'Create visit' : 'Save visit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface MoveVisitFormState {
  workDate: string;
  startTime: string;
}

export function MoveVisitDialog({
  open,
  visit,
  dates,
  form,
  onFormChange,
  onOpenChange,
  onSubmit,
  saving,
}: {
  open: boolean;
  visit: DailyAllocationVisit | null;
  dates: string[];
  form: MoveVisitFormState;
  onFormChange: (form: MoveVisitFormState) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
  saving?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-slate-700 bg-slate-900 text-slate-50">
        <DialogHeader>
          <DialogTitle>Move visit</DialogTitle>
          <DialogDescription>
            Move {visit?.job_code || 'this visit'} to another board date and 30-minute start time. Its duration is preserved.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="daily-allocation-move-date">Date</Label>
            <select
              id="daily-allocation-move-date"
              className="flex h-9 w-full rounded-md border border-slate-600 bg-slate-950 px-3 text-sm"
              value={form.workDate}
              onChange={(event) => onFormChange({ ...form, workDate: event.target.value })}
            >
              {dates.map((date) => (
                <option key={date} value={date}>{format(parseISO(date), 'EEE d MMM yyyy')}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="daily-allocation-move-start">Start</Label>
            <Input
              id="daily-allocation-move-start"
              type="time"
              step={1800}
              value={form.startTime}
              onChange={(event) => onFormChange({ ...form, startTime: event.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" className={boardControlStyles.outline} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            className={boardControlStyles.primary}
            disabled={saving || !visit || !form.workDate || !form.startTime}
            onClick={onSubmit}
          >
            {saving ? 'Moving…' : 'Move visit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AssignResourcesDialog({
  open,
  visit,
  employees,
  plant,
  labour,
  plantAssignments,
  labourNames,
  plantLabels,
  onOpenChange,
  onAssignEmployee,
  onAssignPlant,
  onAssignHiredPlant,
  onRemoveLabour,
  onRemovePlant,
  saving,
}: {
  open: boolean;
  visit: DailyAllocationVisit | null;
  employees: DailyAllocationEmployeeResource[];
  plant: DailyAllocationPlantResource[];
  labour: DailyAllocationLabourAssignment[];
  plantAssignments: DailyAllocationPlantAssignment[];
  labourNames: string[];
  plantLabels: string[];
  onOpenChange: (open: boolean) => void;
  onAssignEmployee: (
    profileId: string,
    instructions: { meeting_point: string | null; meet_person: string | null; notes: string | null }
  ) => void;
  onAssignPlant: (plantId: string) => void;
  onAssignHiredPlant: (input: { hired_serial: string; hired_description: string; hired_company: string }) => void;
  onRemoveLabour: (assignmentId: string) => void;
  onRemovePlant: (assignmentId: string) => void;
  saving?: boolean;
}) {
  const [profileId, setProfileId] = useState('');
  const [plantId, setPlantId] = useState('');
  const [hiredSerial, setHiredSerial] = useState('');
  const [hiredDescription, setHiredDescription] = useState('');
  const [hiredCompany, setHiredCompany] = useState('');
  const [meetingPoint, setMeetingPoint] = useState('');
  const [meetPerson, setMeetPerson] = useState('');
  const [notes, setNotes] = useState('');
  const selectedAssignment = labour.find((assignment) => assignment.profile_id === profileId) || null;

  function chooseEmployee(nextProfileId: string) {
    setProfileId(nextProfileId);
    const assignment = labour.find((item) => item.profile_id === nextProfileId);
    setMeetingPoint(assignment?.meeting_point ?? '');
    setMeetPerson(assignment?.meet_person ?? '');
    setNotes(assignment?.notes ?? '');
  }

  function inheritVisitDefaults() {
    setMeetingPoint('');
    setMeetPerson('');
    setNotes('');
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg border-slate-700 bg-slate-900 text-slate-50">
        <DialogHeader>
          <DialogTitle>Assign resources</DialogTitle>
          <DialogDescription>
            {visit ? `${visit.job_code} · ${visit.site_address}` : 'Select a visit first.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="daily-allocation-assign-employee">Employee</Label>
            <select
              id="daily-allocation-assign-employee"
              className="flex h-9 w-full rounded-md border border-slate-600 bg-slate-950 px-3 text-sm"
              value={profileId}
              onChange={(event) => chooseEmployee(event.target.value)}
            >
              <option value="">Select employee</option>
              {employees.map((employee) => (
                <option key={employee.profile_id} value={employee.profile_id}>
                  {employeeLabel(employee)}
                </option>
              ))}
            </select>
            <div className="rounded-md border border-slate-700 bg-slate-950/40 p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">Employee instructions</p>
                  <p className="text-xs text-slate-400">
                    These override the visit defaults for the selected employee.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className={boardControlStyles.ghost}
                  onClick={inheritVisitDefaults}
                >
                  Inherit visit defaults
                </Button>
              </div>
              <div className="grid gap-3">
                <div className="space-y-1">
                  <Label htmlFor="daily-allocation-employee-meeting-point">Meeting point</Label>
                  <Input
                    id="daily-allocation-employee-meeting-point"
                    value={meetingPoint}
                    placeholder={visit?.meeting_point || 'No visit default'}
                    onChange={(event) => setMeetingPoint(event.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="daily-allocation-employee-meet-person">Meet person</Label>
                  <Input
                    id="daily-allocation-employee-meet-person"
                    value={meetPerson}
                    placeholder={visit?.meet_person || 'No visit default'}
                    onChange={(event) => setMeetPerson(event.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="daily-allocation-employee-notes">Notes</Label>
                  <Textarea
                    id="daily-allocation-employee-notes"
                    value={notes}
                    placeholder={visit?.notes || 'No visit default'}
                    onChange={(event) => setNotes(event.target.value)}
                  />
                </div>
              </div>
            </div>
            <Button
              type="button"
              className={cn(boardControlStyles.outline, 'min-h-9')}
              disabled={!profileId || saving}
              onClick={() => onAssignEmployee(profileId, {
                meeting_point: meetingPoint.trim() || null,
                meet_person: meetPerson.trim() || null,
                notes: notes.trim() || null,
              })}
            >
              {selectedAssignment ? 'Save employee instructions' : 'Assign employee'}
            </Button>
          </div>
          <div className="space-y-2">
            <Label htmlFor="daily-allocation-assign-plant">Registered plant</Label>
            <select
              id="daily-allocation-assign-plant"
              className="flex h-9 w-full rounded-md border border-slate-600 bg-slate-950 px-3 text-sm"
              value={plantId}
              onChange={(event) => setPlantId(event.target.value)}
            >
              <option value="">Select plant</option>
              {plant.map((item) => (
                <option key={item.id} value={item.id}>
                  {formatFleetAssetLabel({ identifier: item.plant_id, nickname: item.nickname })}
                </option>
              ))}
            </select>
            <Button
              type="button"
              className={cn(boardControlStyles.outline, 'min-h-9')}
              disabled={!plantId || saving}
              onClick={() => onAssignPlant(plantId)}
            >
              Assign registered plant
            </Button>
          </div>
          <div className="space-y-2 rounded-md border border-slate-700 p-3">
            <p className="text-sm font-medium">Hired plant</p>
            <Input placeholder="Serial / ID" value={hiredSerial} onChange={(event) => setHiredSerial(event.target.value)} />
            <Input placeholder="Description" value={hiredDescription} onChange={(event) => setHiredDescription(event.target.value)} />
            <Input placeholder="Hire company" value={hiredCompany} onChange={(event) => setHiredCompany(event.target.value)} />
            <Button
              type="button"
              className={cn(boardControlStyles.outline, 'min-h-9')}
              disabled={!hiredSerial || !hiredDescription || !hiredCompany || saving}
              onClick={() => onAssignHiredPlant({
                hired_serial: hiredSerial,
                hired_description: hiredDescription,
                hired_company: hiredCompany,
              })}
            >
              Assign hired plant
            </Button>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Current assignments</p>
            {labour.length === 0 && plantAssignments.length === 0 ? (
              <p className="text-sm text-slate-400">None yet.</p>
            ) : null}
            {labour.map((assignment, index) => (
              <div key={assignment.id} className="rounded-md border border-slate-700 p-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{labourNames[index] || assignment.profile_id}</span>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className={boardControlStyles.ghost}
                      aria-label={`Edit instructions for ${labourNames[index] || 'employee'}`}
                      onClick={() => chooseEmployee(assignment.profile_id)}
                    >
                      Edit instructions
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className={boardControlStyles.outline}
                      aria-label={`Remove ${labourNames[index] || 'employee'}`}
                      onClick={() => onRemoveLabour(assignment.id)}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  Meeting: {assignment.meeting_point ?? visit?.meeting_point ?? 'Not set'}
                  {' · '}Meet: {assignment.meet_person ?? visit?.meet_person ?? 'Not set'}
                  {' · '}Notes: {assignment.notes ?? visit?.notes ?? 'None'}
                </p>
              </div>
            ))}
            {plantAssignments.map((assignment, index) => (
              <div key={assignment.id} className="flex items-center justify-between gap-2 text-sm">
                <span>{plantLabels[index] || assignment.hired_serial || assignment.plant_id}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className={boardControlStyles.outline}
                  aria-label={`Remove ${plantLabels[index] || 'plant'}`}
                  onClick={() => onRemovePlant(assignment.id)}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function OverrideDialog({
  open,
  kind,
  onOpenChange,
  onConfirm,
  saving,
}: {
  open: boolean;
  kind: DailyAllocationConflictKind | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (evidence: string) => void;
  saving?: boolean;
}) {
  const [evidence, setEvidence] = useState('');
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Confirm warning override</AlertDialogTitle>
          <AlertDialogDescription>
            {kind === 'pending_absence'
              ? 'This employee has a pending absence. Record why the assignment should proceed.'
              : 'This assignment is outside the usual working pattern. Record why it should proceed.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor="daily-allocation-override-evidence">Evidence</Label>
          <Textarea
            id="daily-allocation-override-evidence"
            value={evidence}
            onChange={(event) => setEvidence(event.target.value)}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={!evidence.trim() || saving}
            onClick={(event) => {
              event.preventDefault();
              onConfirm(evidence.trim());
            }}
          >
            Confirm override
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function PublishDialog({
  open,
  workDate,
  failed,
  publishing,
  unallocatedConfirm,
  onOpenChange,
  onPublish,
  onRefresh,
}: {
  open: boolean;
  workDate: string;
  failed: boolean;
  publishing: boolean;
  unallocatedConfirm: boolean;
  onOpenChange: (open: boolean) => void;
  onPublish: () => void;
  onRefresh: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {unallocatedConfirm
              ? `Publish with unallocated employees for ${workDate}?`
              : `Publish allocation for ${workDate}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {unallocatedConfirm
              ? 'Some available employees are still unallocated. Confirm to snapshot that state into an immutable revision and notify everyone in scope.'
              : 'This creates an immutable revision and sends a low-priority in-app message to each employee in scope. Later edits stay in draft until you publish again.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          {failed ? (
            <Button variant="outline" onClick={onRefresh} disabled={publishing}>
              Refresh and start new attempt
            </Button>
          ) : null}
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              onPublish();
            }}
            disabled={publishing}
          >
            {publishing ? 'Publishing…' : failed ? 'Retry publish' : unallocatedConfirm ? 'Publish with unallocated' : 'Publish'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function DeleteVisitDialog({
  open,
  visit,
  onOpenChange,
  onConfirm,
  saving,
}: {
  open: boolean;
  visit: DailyAllocationVisit | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  saving?: boolean;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this visit?</AlertDialogTitle>
          <AlertDialogDescription>
            {visit
              ? `${visit.job_code} on ${format(parseISO(visit.work_date), 'd MMM yyyy')} will be removed from the draft board.`
              : 'This visit will be removed from the draft board.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={saving}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            Delete visit
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
