'use client';



import { useEffect, useRef, useState } from 'react';

import Link from 'next/link';

import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, dialogContentViewportClassName } from '@/components/ui/dialog';

import { Label } from '@/components/ui/label';

import { Input } from '@/components/ui/input';

import { Textarea } from '@/components/ui/textarea';

import SignaturePad from '@/components/forms/SignaturePad';

import PhotoUpload from '@/components/forms/PhotoUpload';

import { requestHgvInspectionSave } from '@/lib/client/hgv-inspection-save';

import { canCorrectHgvCheck, londonDate, type HgvUpdateItem, type HgvVersion, type HgvRecordKind } from '@/lib/inspections/hgv-updates';

import { TRUCK_CHECKLIST_ITEMS } from '@/lib/checklists/vehicle-checklists';



export interface HgvCheckUpdateProps {

  check: { id: string; user_id: string; hgv_id: string | null; inspection_date: string; submitted_at: string | null; status: string; current_mileage: number | null; inspector_comments: string | null; record_kind?: HgvRecordKind; parent_check_id?: string | null; discovered_at?: string | null; revision?: number };

  items: HgvUpdateItem[];

  actorId: string;

  onUpdated: () => void;

}

interface HistoryResponse {
  updatesEnabled?: boolean;

  versions: HgvVersion[];

  observations: Array<{ task_id: string; revision: number; item_number: number; comment: string | null }>;

  reports: Array<{ id: string; submitted_at: string | null; status: string }>;

}

const timeLabel = (value: string | null) => value ? new Date(value).toLocaleString('en-GB', { timeZone: 'Europe/London' }) : 'Not submitted';



export function HgvCheckUpdates({ check, items, actorId, onUpdated }: HgvCheckUpdateProps) {

  const [mode, setMode] = useState<'defect' | 'correction' | null>(null);

  const [answers, setAnswers] = useState<HgvUpdateItem[]>([]);

  const [notes, setNotes] = useState('');

  const [reason, setReason] = useState('');

  const [discovered, setDiscovered] = useState('');

  const [signature, setSignature] = useState(false);

  const [busy, setBusy] = useState(false);

  const [error, setError] = useState('');

  const [draftId, setDraftId] = useState<string | null>(null);

  const [photoItem, setPhotoItem] = useState<number | null>(null);

  const [history, setHistory] = useState<HistoryResponse | null>(null);

  const [historyError, setHistoryError] = useState('');

  const operationId = useRef('');

  const inFlight = useRef(false);

  const owner = actorId === check.user_id;

  const isReport = check.record_kind === 'defect_report';



  useEffect(() => {

    let active = true;

    setHistoryError('');

    fetch(`/api/hgv-inspections/${check.id}/history`).then(async response => {

      if (!response.ok) throw new Error('Check history could not be loaded. Refresh to try again.');

      return response.json() as Promise<HistoryResponse>;

    }).then(data => { if (active) setHistory(data); }).catch(err => { if (active) setHistoryError(err.message); });

    return () => { active = false; };

  }, [check.id, check.revision]);



  function open(next: 'defect' | 'correction') {

    operationId.current = isReport && check.status === 'draft' ? check.id : crypto.randomUUID();

    setMode(next); setAnswers(next === 'correction' || isReport ? items.map(item => ({ ...item })) : []);

    setNotes(next === 'correction' || isReport ? check.inspector_comments || '' : '');

    setReason(''); setDraftId(isReport && check.status === 'draft' ? check.id : null); setError(''); setSignature(false); setPhotoItem(null);

    // datetime-local uses the device's local zone; submission serialises the actual instant.

    const now = isReport && check.discovered_at ? new Date(check.discovered_at) : new Date();

    setDiscovered(new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16));

  }

  function changeItem(number: number, update: Partial<HgvUpdateItem>) {

    setAnswers(previous => previous.map(item => item.item_number === number ? { ...item, ...update } : item));

  }

  function validate() {

    if (!answers.length) return 'Select at least one affected item.';

    if (answers.some(item => item.status === 'attention' && !item.comments?.trim())) return 'Describe each defect.';

    if (mode === 'correction' && reason.trim().length < 5) return 'Enter a reason for this correction (at least 5 characters).';

    if (mode === 'defect' && (!discovered || Number.isNaN(new Date(discovered).getTime()) || new Date(discovered).getTime() > Date.now())) return 'Enter when the defect was discovered, not a future time.';

    return '';

  }

  async function save(status: 'draft' | 'submitted', signatureData?: string) {

    if (inFlight.current || !check.hgv_id) return;

    const validation = status === 'submitted' ? validate() : '';

    if (validation) { setError(validation); setSignature(false); return; }

    inFlight.current = true; setBusy(true); setError('');

    const date = mode === 'correction' || isReport ? check.inspection_date : londonDate();

    const day = new Date(`${date}T12:00:00Z`).getUTCDay() || 7;

    try {

      const result = await requestHgvInspectionSave({

        requestId: operationId.current,

        hintInspectionId: mode === 'correction' ? check.id : draftId,

        hgvId: check.hgv_id, userId: actorId, inspectionDate: date,

        currentMileage: mode === 'correction' ? check.current_mileage : null,

        status, inspectorComments: notes.trim() || null, signatureData: signatureData || null,

        recordKind: mode === 'correction' ? check.record_kind || 'full_check' : 'defect_report',

        parentCheckId: mode === 'correction' ? check.parent_check_id || null : isReport ? check.parent_check_id || null : check.id,

        discoveredAt: mode === 'correction' ? check.discovered_at || null : new Date(discovered).toISOString(),

        correctionReason: mode === 'correction' ? reason.trim() : null,

        expectedRevision: mode === 'correction' ? check.revision || 0 : null,

        informWorkshop: false,

        items: answers.map(item => ({ item_number: item.item_number, item_description: item.item_description, day_of_week: day, status: item.status, comments: item.comments?.trim() || null })),

      });

      if (status === 'draft') { setDraftId(result.id); return result.id; }

      toast.success(mode === 'correction' ? 'Correction saved with history' : 'Defect reported to Workshop');

      if (mode === 'defect') window.location.assign(`/hgv-inspections/${result.id}`);

      else { setMode(null); setSignature(false); onUpdated(); }

    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save. Your report has not been confirmed. Please retry.'); }

    finally { inFlight.current = false; setBusy(false); }

  }

  const canCorrect = canCorrectHgvCheck(check, actorId);

  return <Card className="border-border">

    <CardHeader><CardTitle className="text-lg">{isReport ? 'Additional defect report' : 'Check updates'}</CardTitle></CardHeader>

    <CardContent className="space-y-4">

      <p className="text-sm text-muted-foreground">Submitted {timeLabel(check.submitted_at)} · Revision {check.revision || 0}{isReport && check.discovered_at ? ` · Discovered ${timeLabel(check.discovered_at)}` : ''}</p>

      {check.parent_check_id && <Link className="text-sm underline" href={`/hgv-inspections/${check.parent_check_id}`}>View original daily check</Link>}

      {history?.updatesEnabled && owner && check.status === 'draft' && isReport && <Button onClick={() => open('defect')}>Resume defect report</Button>}

      {history?.updatesEnabled && owner && check.status === 'submitted' && <div className="flex flex-wrap gap-2">

        {!isReport && <Button onClick={() => open('defect')}>Report a new defect</Button>}

        <Button variant="outline" asChild><Link href={`/hgv-inspections/new?hgvId=${check.hgv_id}`}>Start another full check</Link></Button>

        {canCorrect && <Button variant="outline" onClick={() => open('correction')}>Correct my check</Button>}

      </div>}

      {historyError && <p role="alert" className="text-destructive">{historyError}</p>}

      {history && <div className="space-y-3 text-sm">

        {history.reports.map(report => <p key={report.id}><Link className="underline" href={`/hgv-inspections/${report.id}`}>Additional defect report · {timeLabel(report.submitted_at)} ({report.status})</Link></p>)}

        {history.observations.length > 0 && <div><p className="font-medium">Reported to Workshop</p>{history.observations.map(observation => <p key={`${observation.revision}-${observation.item_number}`}><Link className="underline" href={`/workshop-tasks?taskId=${observation.task_id}`}>Task {observation.task_id.slice(-5).toUpperCase()}</Link> · Revision {observation.revision} · {observation.comment}</p>)}</div>}

        {history.versions.map(version => <details key={version.revision} className="rounded border border-border p-3">

          <summary className="cursor-pointer">{version.revision === 0 ? 'Original submission' : `Correction ${version.revision}`} · {timeLabel(version.recorded_at)} · {version.reason}</summary>

          <div className="mt-3 space-y-2">

            <p>Recorded by {version.actor_id === actorId ? 'you' : version.actor_id}</p>

            {version.snapshot.items.map(item => <p key={item.item_number}>{item.item_description}: {item.status === 'attention' ? 'Defect' : item.status.toUpperCase()}{item.comments ? ` — ${item.comments}` : ''}</p>)}

            {version.snapshot.inspection.inspector_comments && <p>Notes: {version.snapshot.inspection.inspector_comments}</p>}

            {version.snapshot.photos.map((photo, index) => <p key={`${photo.photo_url}-${index}`}><a className="underline" href={photo.photo_url} target="_blank" rel="noreferrer">Retained photo {index + 1}{photo.caption ? `: ${photo.caption}` : ''}</a></p>)}
            <a className="underline" href={`/api/hgv-inspections/${check.id}/pdf?revision=${version.revision}`} target="_blank" rel="noreferrer">Download this signed version</a>

          </div>

        </details>)}

      </div>}

      <Dialog open={mode !== null} onOpenChange={value => { if (!value && !busy) { setMode(null); setPhotoItem(null); } }}>

        <DialogContent className={dialogContentViewportClassName({ size: 'lg' })}>

          <DialogHeader><DialogTitle>{mode === 'correction' ? 'Correct my submitted check' : 'Report a new defect'}</DialogTitle><DialogDescription>{mode === 'correction' ? 'Correct a mistake in your answers or notes. Your original signed check and all corrections are retained. KM remains manager-only. A correction does not close a Workshop task.' : 'Report a defect discovered after your daily check. This does not replace a full check. Submission sends the defect to the existing Workshop workflow.'}</DialogDescription></DialogHeader>

          {error && <p role="alert" className="text-destructive">{error}</p>}

          {signature ? <SignaturePad disabled={busy} isSubmitting={busy} submitLabel={mode === 'correction' ? 'Save correction' : 'Submit defect report'} onSave={value => { void save('submitted', value); }} onCancel={() => setSignature(false)} /> : <div className="space-y-4">

            {mode === 'defect' && <><Label htmlFor="hgv-defect-discovered">When was the defect discovered?</Label><Input id="hgv-defect-discovered" type="datetime-local" value={discovered} onChange={event => setDiscovered(event.target.value)} disabled={busy} />

              <Label htmlFor="hgv-defect-item">Add affected checklist item</Label><select id="hgv-defect-item" className="w-full rounded border border-input bg-background p-3 text-foreground" value="" disabled={busy} onChange={event => {

                const number = Number(event.target.value); if (!number || answers.some(item => item.item_number === number)) return;

                setAnswers(previous => [...previous, { item_number: number, item_description: TRUCK_CHECKLIST_ITEMS[number - 1], day_of_week: 1, status: 'attention', comments: '' }]);

              }}><option value="">Select an item…</option>{TRUCK_CHECKLIST_ITEMS.map((item, index) => <option key={item} value={index + 1} disabled={answers.some(answer => answer.item_number === index + 1)}>{item}</option>)}</select></>}

            {answers.map(item => <div key={item.item_number} className="space-y-2 rounded border border-border p-3">

              <Label htmlFor={`hgv-update-${item.item_number}`}>{item.item_description}</Label>

              {mode === 'correction' && <select aria-label={`${item.item_description} result`} className="w-full rounded border border-input bg-background p-3" value={item.status} disabled={busy} onChange={event => changeItem(item.item_number, { status: event.target.value as HgvUpdateItem['status'] })}><option value="ok">Pass</option><option value="attention">Defect</option><option value="na">N/A</option></select>}

              <Textarea id={`hgv-update-${item.item_number}`} value={item.comments || ''} disabled={busy} onChange={event => changeItem(item.item_number, { comments: event.target.value })} placeholder="Describe the defect or correction" />

              {mode === 'defect' && <div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={async () => { const savedId = await save('draft'); if (savedId) setPhotoItem(item.item_number); }}>Add photos</Button><Button variant="ghost" disabled={busy} onClick={() => setAnswers(previous => previous.filter(answer => answer.item_number !== item.item_number))}>Remove item</Button></div>}

            </div>)}

            <Label htmlFor="hgv-update-notes">Notes</Label><Textarea id="hgv-update-notes" value={notes} onChange={event => setNotes(event.target.value)} disabled={busy} />

            {mode === 'correction' && <><Label htmlFor="hgv-update-reason">Reason for correction</Label><Textarea id="hgv-update-reason" value={reason} onChange={event => setReason(event.target.value)} disabled={busy} /></>}

            <div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={() => setMode(null)}>Cancel</Button><Button disabled={busy || !answers.length} onClick={() => { const problem = validate(); setError(problem); if (!problem) setSignature(true); }}>{busy ? 'Saving…' : 'Confirm and sign'}</Button></div>

          </div>}

        </DialogContent>

      </Dialog>

      {photoItem && draftId && <PhotoUpload inspectionId={draftId} itemNumber={photoItem} dayOfWeek={new Date(`${londonDate()}T12:00:00Z`).getUTCDay() || 7} onUploadComplete={() => setPhotoItem(null)} onClose={() => setPhotoItem(null)} />}

    </CardContent>

  </Card>;

}

