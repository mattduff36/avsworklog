'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { HgvTrailerPicker } from '@/components/inspections/HgvTrailerPicker';
import { HGV_TRAILER_SWAP_ITEM_NUMBERS, type HgvTrailerSelection } from '@/lib/checklists/hgv-trailer-swap';
import { TRUCK_CHECKLIST_ITEMS } from '@/lib/checklists/vehicle-checklists';
import { fetchHgvCheckAssets, trailerDefectQuery, type HgvCheckAsset } from '@/lib/inspections/hgv-trailer-form';

const SignaturePad = dynamic(() => import('@/components/forms/SignaturePad'), { ssr: false });
type Answer = {item_number: number; item_description: string; status: 'ok' | 'attention' | 'na'; comments: string | null};
interface Swap { id: string; trailer_label: string; signed_at: string; driver_name: string; items: Answer[] }
const resultLabels = { ok: 'Pass', attention: 'Fail', na: 'N/A' } as const;

export function HgvTrailerSwaps({checkId, hgvId, canRecord}: {checkId: string; hgvId: string; canRecord: boolean}) {
  const [history, setHistory] = useState<Swap[]>([]);
  const [assets, setAssets] = useState<HgvCheckAsset[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [assetsError, setAssetsError] = useState('');
  const [open, setOpen] = useState(false);
  const [trailer, setTrailer] = useState<HgvTrailerSelection | null>(null);
  const [answers, setAnswers] = useState<Record<number, Answer>>({});
  const [locked, setLocked] = useState<Set<number>>(new Set());
  const [lockState, setLockState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [retry, setRetry] = useState(0);
  const [signing, setSigning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retryBody, setRetryBody] = useState<string | null>(null);
  const [canEditRejected, setCanEditRejected] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const requestId = useRef('');

  const loadHistory = useCallback(async (signal?: AbortSignal) => {
    setHistoryError('');
    try {
      const response = await fetch(`/api/hgv-inspections/${checkId}/trailer-swaps`, {signal, cache: 'no-store'});
      if (!response.ok) throw new Error();
      const {swaps} = await response.json() as {swaps: Swap[]};
      if (!signal?.aborted) setHistory(swaps);
    } catch {
      if (!signal?.aborted) setHistoryError('Trailer changes could not be loaded.');
    }
  }, [checkId]);

  useEffect(() => {
    const controller = new AbortController();
    void loadHistory(controller.signal);
    return () => controller.abort();
  }, [loadHistory]);

  useEffect(() => {
    if (!canRecord) return;
    let active = true;
    fetchHgvCheckAssets().then(rows => { if (active) setAssets(rows); })
      .catch(() => { if (active) setAssetsError('Could not load trailer choices. Refresh this page to try again.'); });
    return () => { active = false; };
  }, [canRecord]);

  useEffect(() => {
    const anchor = window.location.hash.slice(1);
    if (anchor.startsWith('trailer-swap-')) document.getElementById(anchor)?.scrollIntoView();
  }, [history]);

  useEffect(() => {
    if (!trailer) return;
    const controller = new AbortController();
    const query = trailerDefectQuery(hgvId, trailer, true);
    async function load() {
      try {
        const response = await fetch(`/api/hgv-inspections/locked-defects?${query}`, {signal: controller.signal});
        if (!response.ok) throw new Error();
        const {lockedItems} = await response.json() as {lockedItems: {item_number: number; item_description?: string; comment: string}[]};
        const known: Record<number, Answer> = {};
        for (const item of lockedItems) {
          const index = TRUCK_CHECKLIST_ITEMS.findIndex(label => label.toLowerCase() === item.item_description?.toLowerCase());
          const n = index >= 0 ? index + 1 : item.item_number;
          if (!(HGV_TRAILER_SWAP_ITEM_NUMBERS as readonly number[]).includes(n)) continue;
          known[n] = {item_number: n, item_description: TRUCK_CHECKLIST_ITEMS[n-1], status: 'attention', comments: item.comment || 'Previously reported defect'};
        }
        if (controller.signal.aborted) return;
        setLocked(new Set(Object.keys(known).map(Number)));
        setAnswers(known);
        setLockState('ready');
      } catch { if (!controller.signal.aborted) setLockState('failed'); }
    }
    void load();
    return () => controller.abort();
  }, [trailer, hgvId, retry]);

  function selectTrailer(next: HgvTrailerSelection) {
    setLockState('loading'); setTrailer(next); setAnswers({}); setLocked(new Set()); setSigning(false); setError('');
    return true;
  }

  const complete = Boolean(trailer && lockState === 'ready' && HGV_TRAILER_SWAP_ITEM_NUMBERS.every(n =>
    answers[n] && (answers[n].status !== 'attention' || answers[n].comments?.trim())));

  async function submit(signatureData?: string) {
    if (!complete || submitting.current) return;
    const body = retryBody ?? JSON.stringify({
      requestId: requestId.current,
      trailerSelection: trailer,
      signatureData,
      items: HGV_TRAILER_SWAP_ITEM_NUMBERS.map(n => answers[n]),
    });
    setRetryBody(body);
    setCanEditRejected(false);
    submitting.current = true; setBusy(true); setError('');
    try {
      const response = await fetch(`/api/hgv-inspections/${checkId}/trailer-swaps`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body,
      });
      if (!response.ok) {
        // An interrupted response may have committed. Keep the signed bytes for replay.
        setCanEditRejected(response.status === 400 || response.status === 422);
        const result = await response.json().catch(() => null);
        throw new Error(result?.error || 'Could not save the trailer check.');
      }
      setRetryBody(null); setOpen(false); setTrailer(null); setSigning(false); toast.success('Trailer change recorded');
      await loadHistory();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not confirm the trailer check. Retry to confirm the same check.'); }
    finally { setBusy(false); submitting.current = false; }
  }

  const tractor = assets.find(a => a.id === hgvId);
  const canStart = canRecord && tractor && tractor.classification !== 'rigid' && tractor.classification !== 'trailer';
  if (!canStart && !history.length && !historyError && !assetsError) return null;
  return <Card>
    <CardHeader><CardTitle>Trailer changes</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      {historyError && <p role="alert">{historyError} <Button type="button" variant="link" onClick={() => void loadHistory()}>Retry</Button></p>}
      {assetsError && <p role="alert">{assetsError}</p>}
      {history.map(swap => <section key={swap.id} id={`trailer-swap-${swap.id}`} className="scroll-mt-24 rounded-lg border p-4">
        <h3 className="font-semibold">{swap.trailer_label}</h3>
        <p className="text-sm text-muted-foreground">{swap.driver_name} · {new Date(swap.signed_at).toLocaleString('en-GB', {timeZone:'Europe/London'})}</p>
        <ul className="mt-3 space-y-2">{swap.items.map(item => <li key={item.item_number}>{item.item_description} · {resultLabels[item.status]}{item.comments && <p className="text-sm text-muted-foreground">{item.comments}</p>}</li>)}</ul>
      </section>)}
      {canStart && !open && <Button onClick={() => {requestId.current = crypto.randomUUID(); setOpen(true); setError(''); setAnswers({}); setTrailer(null);}}>Change trailer</Button>}
      {open && <div className="space-y-4">
        <h3 className="font-semibold">New trailer walkaround</h3>
        <HgvTrailerPicker assets={assets} value={trailer} onChange={selectTrailer} confirmChange={Object.keys(answers).length ? 'The recorded walkaround answers will be cleared so you can check the newly selected trailer.' : undefined} allowNone={false} disabled={busy || signing} />
        {trailer && lockState === 'loading' && <p role="status">Checking outstanding defects…</p>}
        {trailer && lockState === 'failed' && <p role="alert">Outstanding defects could not be loaded. <Button variant="link" onClick={() => {setLockState('loading'); setRetry(n => n+1);}}>Retry</Button></p>}
        {trailer && lockState === 'ready' && HGV_TRAILER_SWAP_ITEM_NUMBERS.map(n => {
          const item = answers[n];
          const label = TRUCK_CHECKLIST_ITEMS[n-1];
          const fixed = locked.has(n);
          return <fieldset key={n} disabled={fixed || busy || signing} className="space-y-2 rounded-lg border p-3">
            <legend className="px-1 font-medium">{label}</legend>
            <div className="flex flex-wrap gap-2">{(Object.keys(resultLabels) as Answer['status'][]).map(status =>
              <Button key={status} type="button" variant={item?.status === status ? 'default' : 'outline'} aria-pressed={item?.status === status}
                onClick={() => setAnswers(prev => ({...prev,[n]:{item_number:n,item_description:label,status,comments:prev[n]?.comments ?? null}}))}>{resultLabels[status]}</Button>)}</div>
            {fixed && <p>Outstanding defect · {item?.comments}</p>}
            {!fixed && item?.status === 'attention' && <><Label htmlFor={`swap-comment-${n}`}>Describe the defect</Label>
              <Textarea id={`swap-comment-${n}`} value={item.comments ?? ''} onChange={event => { const comments = event.target.value; setAnswers(prev => ({...prev,[n]:{...prev[n],comments}})); }} /></>}
          </fieldset>;
        })}
        {error && <p role="alert" className="text-destructive">{error}</p>}
        {retryBody ? <div className="flex gap-2">
          <Button disabled={busy} onClick={() => void submit()}>{busy ? 'Submitting…' : 'Retry signed check'}</Button>
          {canEditRejected && <Button variant="outline" disabled={busy} onClick={() => {
            requestId.current = crypto.randomUUID();
            setRetryBody(null);
            setError('');
            setSigning(false);
          }}>Edit check</Button>}
        </div> : signing ? <SignaturePad onSave={submit} onCancel={() => setSigning(false)} isSubmitting={busy} disabled={busy} submitLabel="Submit trailer check" /> :
          <div className="flex gap-2"><Button disabled={!complete} onClick={() => setSigning(true)}>Sign trailer check</Button>
            <Button variant="outline" onClick={() => {setOpen(false); setTrailer(null);}}>Cancel</Button></div>}
      </div>}
    </CardContent>
  </Card>;
}
