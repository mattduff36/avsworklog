'use client';

import { useEffect, useRef, useState } from 'react';

import Link from 'next/link';

import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { PanelLoader } from '@/components/ui/panel-loader';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, dialogContentViewportClassName } from '@/components/ui/dialog';

import { AlertTriangle, ArrowLeft, ArrowRight, Camera, Check, ChevronRight, ClipboardList, FileDown, History, Loader2, Minus, Pencil, Trash2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';


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
  const [expandedNotes, setExpandedNotes] = useState<number[]>([]);

  const [reason, setReason] = useState('');


  const [signature, setSignature] = useState(false);

  const [busy, setBusy] = useState(false);

  const [error, setError] = useState('');

  const [draftId, setDraftId] = useState<string | null>(null);

  const [photoItem, setPhotoItem] = useState<number | null>(null);

  const [history, setHistory] = useState<HistoryResponse | null>(null);

  const [historyError, setHistoryError] = useState('');

  const editorRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (mode) editorRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [mode]);

  function open(next: 'defect' | 'correction') {

    operationId.current = isReport && check.status === 'draft' ? check.id : crypto.randomUUID();

    setMode(next); setAnswers(next === 'correction' || isReport ? items.map(item => ({ ...item })) : []);

    setNotes(next === 'correction' || isReport ? check.inspector_comments || '' : '');

    setExpandedNotes([]);
    setReason(''); setDraftId(isReport && check.status === 'draft' ? check.id : null); setError(''); setSignature(false); setPhotoItem(null);


  }

  function changeItem(number: number, update: Partial<HgvUpdateItem>) {
    setError('');

    setAnswers(previous => previous.map(item => item.item_number === number ? { ...item, ...update } : item));

  }

  function validate() {

    if (!answers.length) return 'Select at least one affected item.';

    if (answers.some(item => item.status === 'attention' && !item.comments?.trim())) return 'Describe each defect.';

    if (mode === 'correction' && reason.trim().length < 5) return 'Enter a reason for this correction (at least 5 characters).';


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

        discoveredAt: mode === 'correction' ? check.discovered_at || null : null,

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

  const primaryClass = 'min-h-[44px] bg-primary text-primary-foreground hover:bg-primary/90';
  const fieldClass = 'min-h-[44px] bg-slate-900/50 border-slate-600 text-white';
  const title = mode === 'correction' ? 'Correct my check' : 'Report a new defect';

  return <div className="space-y-4" ref={editorRef} style={{ scrollMarginTop: 96 }}>
    {mode ? <Card>
      <CardHeader className="space-y-3 p-4 sm:p-6">
        <Button variant="ghost" className="-ml-2 min-h-[44px] w-fit px-2 text-muted-foreground" disabled={busy} onClick={() => setMode(null)}>
          <ArrowLeft className="mr-2 h-4 w-4" />Back to check
        </Button>
        <div>
          <CardTitle className="text-xl text-foreground">{title}</CardTitle>
          <CardDescription className="mt-2">
            {mode === 'defect' ? 'Choose an item, add a note and an optional photo, then submit.' : 'Update the answers or notes that need correcting, then sign again.'}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-6 p-4 pt-0 sm:p-6 sm:pt-0">
        {mode === 'defect' ? <div className="space-y-3">
          <h3 className="font-medium">Select the item(s) with a defect</h3>
          <div role="group" aria-label="Checklist items" className="grid grid-cols-2 gap-2">
            {TRUCK_CHECKLIST_ITEMS.map((item, index) => {
              const number = index + 1;
              const selected = answers.some(answer => answer.item_number === number);
              return <button type="button" key={number} aria-pressed={selected} disabled={busy}
                onClick={() => { setError(''); setAnswers(previous => selected ? previous.filter(answer => answer.item_number !== number) : [...previous, { item_number: number, item_description: item, day_of_week: 1, status: 'attention', comments: '' }]); }}
                className={`relative flex min-h-[64px] items-center justify-center gap-2 rounded-lg border-2 px-6 py-3 text-center text-[14px] leading-snug focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${selected ? 'border-primary bg-primary/15 text-foreground' : 'border-slate-600 bg-slate-900/50 text-foreground hover:bg-slate-800'}`}>
                <span className="min-w-0 flex-1 break-words">{item}</span>{selected && <Check aria-hidden="true" className="absolute right-2 h-4 w-4" />}
              </button>;
            })}
          </div>
        </div> : <p className="text-sm text-muted-foreground">Your original signed check is kept. KM corrections stay with a manager, and existing Workshop tasks remain open.</p>}

        {answers.length > 0 && <div className="space-y-3">
          <h3 className="font-semibold text-foreground">{mode === 'correction' ? 'Checklist answers' : `Defect details (${answers.length})`}</h3>
          {answers.map(item => <div key={item.item_number} className="rounded-lg border border-border/50 bg-slate-900/30 p-4 space-y-3">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-600 bg-slate-800 text-sm font-bold text-muted-foreground">{item.item_number}</span>
              <h4 className="min-w-0 flex-1 text-[16px] font-medium text-white">{item.item_description}</h4>
              {mode === 'defect' && <Button variant="ghost" size="icon" className="min-h-[44px] min-w-[44px] text-muted-foreground" aria-label={`Remove ${item.item_description}`} disabled={busy} onClick={() => setAnswers(previous => previous.filter(answer => answer.item_number !== item.item_number))}><Trash2 className="h-4 w-4" /></Button>}
            </div>
            {mode === 'correction' && <div role="group" aria-label={`${item.item_description} result`} className="grid grid-cols-3 gap-2">
              {([{ value: 'ok', label: 'Pass', icon: Check }, { value: 'attention', label: 'Fail', icon: X }, { value: 'na', label: 'N/A', icon: Minus }] as const).map(option => <Button key={option.value} variant="outline" aria-pressed={item.status === option.value} disabled={busy} onClick={() => changeItem(item.item_number, { status: option.value })} className={`min-h-[48px] gap-2 border-2 ${item.status !== option.value ? 'border-slate-600 text-muted-foreground' : option.value === 'ok' ? 'border-green-500 bg-green-500/20 text-green-300 hover:bg-green-500/30' : option.value === 'attention' ? 'border-red-500 bg-red-500/20 text-red-300 hover:bg-red-500/30' : 'border-slate-400 bg-slate-700 text-white'}`}><option.icon className="h-4 w-4" />{option.label}</Button>)}
            </div>}
            {(item.status === 'attention' || item.comments || expandedNotes.includes(item.item_number)) ? <div className="space-y-2">
              <Label htmlFor={`hgv-update-${item.item_number}`}>{item.status === 'attention' ? (mode === 'defect' ? 'Note (required)' : 'Describe the defect (required)') : 'Notes (optional)'}</Label>
              <Textarea id={`hgv-update-${item.item_number}`} className={`${fieldClass} min-h-[88px] text-[16px]`} value={item.comments || ''} disabled={busy} onChange={event => changeItem(item.item_number, { comments: event.target.value })} placeholder={item.status === 'attention' ? 'What is wrong and where is it?' : 'Add details if needed'} />
            </div> : <Button variant="ghost" className="min-h-[44px] px-0 text-muted-foreground" disabled={busy} onClick={() => setExpandedNotes(previous => [...previous, item.item_number])}>Add a note<span className="sr-only"> for {item.item_description}</span></Button>}
            {mode === 'defect' && <Button variant="outline" className="min-h-[44px] gap-2" disabled={busy} onClick={async () => { const savedId = await save('draft'); if (savedId) setPhotoItem(item.item_number); }}><Camera className="h-4 w-4" />Add photos</Button>}
          </div>)}
        </div>}

        {mode === 'correction' && <div className="space-y-2">
          <Label htmlFor="hgv-update-notes">Additional notes (optional)</Label>
          <Textarea id="hgv-update-notes" className={`${fieldClass} min-h-[88px] text-[16px]`} placeholder="Anything else to add?" value={notes} onChange={event => setNotes(event.target.value)} disabled={busy} />
        </div>}
        {mode === 'correction' && <div className="space-y-2">
          <Label htmlFor="hgv-update-reason">Reason for correction (required)</Label>
          <Textarea id="hgv-update-reason" className={`${fieldClass} min-h-[88px] text-[16px]`} placeholder="Explain what was recorded incorrectly" value={reason} onChange={event => setReason(event.target.value)} disabled={busy} />
          <p className="text-sm text-muted-foreground">This reason is saved with the correction history.</p>
        </div>}
        {error && !signature && <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
        <div className="border-t border-border pt-4 space-y-3">
          <p className="text-sm text-muted-foreground">{mode === 'defect' ? 'New defects go to Workshop immediately on submission. No full check or countdown is needed.' : 'Review your changes before signing. Your previous submission stays in the history.'}</p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" className="min-h-[44px]" disabled={busy} onClick={() => setMode(null)}>Cancel</Button>
            <Button className={`${primaryClass} gap-2`} disabled={busy || !answers.length} onClick={() => { const problem = validate(); setError(problem); if (!problem) setSignature(true); }}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}{busy ? 'Saving...' : 'Review and sign'}</Button>
          </div>
        </div>
      </CardContent>
    </Card> : <>
      <Card>
        <CardHeader className="p-4 pb-3 sm:p-6 sm:pb-3">
          <CardTitle className="text-lg">{isReport ? 'Defect report' : history?.updatesEnabled && owner ? 'Need to update this check?' : 'Check activity'}</CardTitle>
          <CardDescription>{isReport ? `Submitted ${timeLabel(check.submitted_at)}` : history?.updatesEnabled && owner ? 'Report a new problem or correct a mistake in your submitted check.' : `Submitted ${timeLabel(check.submitted_at)}`} </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 p-4 pt-0 sm:p-6 sm:pt-0">
          {check.parent_check_id && <Link className="inline-flex min-h-[44px] items-center gap-2 text-sm underline underline-offset-4" href={`/hgv-inspections/${check.parent_check_id}`}><ArrowLeft className="h-4 w-4" />View original daily check</Link>}
          {history?.updatesEnabled && owner && check.status === 'draft' && isReport && <Button className={primaryClass} onClick={() => open('defect')}>Resume defect report</Button>}
          {history?.updatesEnabled && owner && check.status === 'submitted' && <>
            {!isReport && <Button className={`${primaryClass} w-full gap-2 sm:w-auto`} onClick={() => open('defect')}><AlertTriangle className="h-4 w-4" />Report a new defect</Button>}
            <div className="divide-y divide-border border-t border-border">
              {canCorrect && <button type="button" onClick={() => open('correction')} className="flex w-full min-h-[64px] items-center gap-3 py-3 text-left hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">
                <Pencil className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="flex-1"><span className="block font-medium">Correct my check</span><span className="block text-sm text-muted-foreground">Change answers or notes from today</span></span><ChevronRight className="h-4 w-4 shrink-0" />
              </button>}
              <Link className="flex min-h-[64px] items-center gap-3 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm" href={`/hgv-inspections/new?hgvId=${check.hgv_id}`}><ClipboardList className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="flex-1"><span className="block font-medium">Start another full check</span><span className="block text-sm text-muted-foreground">Complete the checklist / 10-minute minimum</span></span><ChevronRight className="h-4 w-4 shrink-0" /></Link>
            </div>
          </>}
          {!history && !historyError && <PanelLoader accent="hgv-inspections" message="Loading available updates..." className="min-h-32" />}
          {historyError && <p role="alert" className="text-sm text-red-300">{historyError}</p>}
          {history && history.reports.length > 0 && <div className="space-y-2 border-t border-border pt-4"><h3 className="font-medium">Additional defect reports</h3>{history.reports.map(report => <Link key={report.id} className="flex min-h-[44px] items-center gap-3 text-sm underline underline-offset-4" href={`/hgv-inspections/${report.id}`}><span className="flex-1">{report.submitted_at ? timeLabel(report.submitted_at) : 'Unsubmitted report'}</span><Badge variant="outline">{report.status === 'draft' ? 'Draft' : 'Submitted'}</Badge><ArrowRight className="h-4 w-4" /></Link>)}</div>}
        </CardContent>
      </Card>
      {history && (history.versions.length > 0 || history.observations.length > 0) && <Card className="p-4 sm:p-6">
        <details className="group">
          <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden"><History className="h-4 w-4 text-muted-foreground" /><span className="flex-1 font-medium">Check history &amp; Workshop</span><ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" /></summary>
          <div className="mt-4 space-y-4">
            {history.observations.length > 0 && <div className="space-y-2"><h3 className="text-sm font-semibold">Reported to Workshop</h3>{history.observations.map(observation => <Link className="flex min-h-[44px] items-start gap-3 rounded-md border border-border p-3 text-sm" key={`${observation.revision}-${observation.item_number}`} href={`/workshop-tasks?taskId=${observation.task_id}`}><span className="flex-1 break-words">{observation.comment || 'View reported defect'}<span className="mt-1 block text-muted-foreground">{observation.revision ? `Correction ${observation.revision}` : 'Original submission'}</span></span><ChevronRight className="h-4 w-4 shrink-0" /></Link>)}</div>}
            {history.versions.map(version => <details key={version.revision} className="rounded-md border border-border p-3">
              <summary className="min-h-[44px] cursor-pointer text-sm"><span className="font-medium">{version.revision === 0 ? 'Original submission' : `Correction ${version.revision}`}</span><span className="mt-1 block text-muted-foreground">{timeLabel(version.recorded_at)}</span></summary>
              <div className="mt-3 space-y-3 text-sm">
                {version.reason && <p><span className="font-medium">Reason:</span> {version.reason}</p>}
                {version.actor_id === actorId && <p className="text-muted-foreground">Recorded by you</p>}
                <div className="divide-y divide-border">{version.snapshot.items.map(item => <div key={item.item_number} className="py-2"><div className="flex items-start justify-between gap-3"><span>{item.item_description}</span><span className={item.status === 'attention' ? 'text-red-300' : 'text-muted-foreground'}>{item.status === 'attention' ? 'Fail' : item.status === 'ok' ? 'Pass' : 'N/A'}</span></div>{item.comments && <p className="mt-1 text-muted-foreground">{item.comments}</p>}</div>)}</div>
                {version.snapshot.inspection.inspector_comments && <p>Notes: {version.snapshot.inspection.inspector_comments}</p>}
                {version.snapshot.photos.map((photo, index) => <a key={`${photo.photo_url}-${index}`} className="block py-2 underline underline-offset-4" href={photo.photo_url} target="_blank" rel="noreferrer">Retained photo {index + 1}{photo.caption ? `: ${photo.caption}` : ''}</a>)}
                <Button variant="outline" className="min-h-[44px] w-full gap-2 sm:w-auto" asChild><a href={`/api/hgv-inspections/${check.id}/pdf?revision=${version.revision}`} target="_blank" rel="noreferrer"><FileDown className="h-4 w-4" />Download signed version</a></Button>
              </div>
            </details>)}
          </div>
        </details>
      </Card>}
    </>}
    <Dialog open={signature} onOpenChange={value => { if (!busy) setSignature(value); }}>
      <DialogContent data-accent="hgv-inspections" mobileKeyboardSafe className={dialogContentViewportClassName({ size: 'lg' })}>
        <DialogHeader><DialogTitle>{mode === 'correction' ? 'Sign your correction' : 'Sign your defect report'}</DialogTitle><DialogDescription>{mode === 'correction' ? 'Confirm the corrected answers and notes are accurate.' : 'Confirm these defect details are accurate. Your report will be sent to Workshop.'}</DialogDescription></DialogHeader>
        <p className="text-sm text-muted-foreground">{answers.filter(item => item.status === 'attention').length} failed item(s){mode === 'correction' && ` / Reason: ${reason}`}</p>
        {error && <p role="alert" className="text-red-300">{error}</p>}
        <div className="[&_button]:min-h-[44px]"><SignaturePad disabled={busy} isSubmitting={busy} submitLabel={mode === 'correction' ? 'Save correction' : 'Submit defect report'} onSave={value => { void save('submitted', value); }} onCancel={() => setSignature(false)} /></div>
      </DialogContent>
    </Dialog>
    {photoItem && draftId && <PhotoUpload inspectionId={draftId} itemNumber={photoItem} dayOfWeek={new Date(`${londonDate()}T12:00:00Z`).getUTCDay() || 7} onUploadComplete={() => setPhotoItem(null)} onClose={() => setPhotoItem(null)} />}
  </div>;
}
