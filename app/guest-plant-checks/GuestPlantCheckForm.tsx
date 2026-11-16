'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Construction, Forklift, Tractor, Truck, Search, CheckCircle2, XCircle, Loader2, Camera, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, dialogContentViewportClassName } from '@/components/ui/dialog';
import { JobCodePicker } from '@/components/timesheets/JobCodeFields';
import { Textarea } from '@/components/ui/textarea';
import { AppPageShell, AppPageHeader } from '@/components/layout/AppPageShell';
import { SignaturePad } from '@/components/forms/SignaturePad';
import { PLANT_INSPECTION_ITEMS } from '@/lib/checklists/plant-checklists';
import { GuestPlantSubmissionSchema, type GuestPlantAsset, type GuestPlantJob, type GuestPlantDefect } from '@/lib/inspections/guest-plant';

const API = '/api/guest-plant-checks';
class ApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, { cache: 'no-store', ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const value = await response.json(); if (!response.ok) throw new ApiError(value.error || 'Unable to connect. Your answers have been kept.', response.status); return value;
}
function PlantIcon({ category }: { category: string | null }) {
  const text = category?.toLowerCase() || ''; const Icon = text.includes('fork') || text.includes('telehandler') ? Forklift : text.includes('tractor') ? Tractor : text.includes('dumper') || text.includes('truck') ? Truck : Construction;
  return <Icon className="h-10 w-10 text-plant-inspection" aria-hidden="true" />;
}
export function GuestPlantCheckForm() {
  const [assets, setAssets] = useState<GuestPlantAsset[]>([]); const [date, setDate] = useState('');
  const [ready, setReady] = useState(false); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [asset, setAsset] = useState<GuestPlantAsset | null>(null); const [search, setSearch] = useState('');
  const [name, setName] = useState(''); const [jobNumber, setJobNumber] = useState(''); const [jobs, setJobs] = useState<GuestPlantJob[]>([]); const [job, setJob] = useState<GuestPlantJob | null>(null);
  const [jobQuery, setJobQuery] = useState(''); const [jobLoading, setJobLoading] = useState(false); const [jobError, setJobError] = useState(''); const [jobRetry, setJobRetry] = useState(0);
  const [showSignature, setShowSignature] = useState(false);
  const [hours, setHours] = useState(''); const [currentHours, setCurrentHours] = useState<number | null>(null); const [hoursConfirmed, setHoursConfirmed] = useState(false);
  const [defects, setDefects] = useState<GuestPlantDefect[]>([]); const [detailsReady, setDetailsReady] = useState(false);
  const [answers, setAnswers] = useState<Record<number, { status: string; comment: string; repeatConfirmed: boolean }>>({});
  const [comments, setComments] = useState(''); const [informWorkshop, setInformWorkshop] = useState(false); const [signature, setSignature] = useState('');
  const [photos, setPhotos] = useState<Array<{ id: string; itemNumber: number }>>([]); const [uploading, setUploading] = useState<number | null>(null); const [pendingPhoto, setPendingPhoto] = useState<{ file: File; itemNumber: number; id: string } | null>(null);
  const [receipt, setReceipt] = useState<{ id: string; date: string } | null>(null);
  const requestId = useRef(''); const pendingPayload = useRef<unknown>(null); const inFlight = useRef(false); const assetGeneration = useRef(0); const bootStarted = useRef(false);
  useEffect(() => {
    document.documentElement.classList.add('guest-plant-page');
    if (bootStarted.current) return () => document.documentElement.classList.remove('guest-plant-page');
    bootStarted.current = true;
    requestId.current = crypto.randomUUID();
    // Fragment never reaches the server, is removed before any API call, and this route omits global analytics/error logging.
    const token = new URLSearchParams(window.location.hash.slice(1)).get('key');
    if (token) window.history.replaceState(null, '', window.location.pathname);
    const boot = async () => {
      try { if (token) await api(API, { token }); const data = await api<{ assets: GuestPlantAsset[]; date: string }>(API); setAssets(data.assets); setDate(data.date); setReady(true); }
      catch (e) { setError(e instanceof Error ? e.message : 'Scan your QR code again.'); }
    }; void boot();
    return () => document.documentElement.classList.remove('guest-plant-page');
  }, []);
  async function loadAsset(next: GuestPlantAsset) {
    const generation = ++assetGeneration.current; setAsset(next); setDetailsReady(false); setError('');
    try {
      const data = await api<{ defects: GuestPlantDefect[]; currentHours: number | null; date: string }>(`${API}?plantId=${next.id}`);
      if (generation !== assetGeneration.current) return;
      setDefects(data.defects); setCurrentHours(data.currentHours); setDate(data.date);
      setAnswers(previous => Object.fromEntries(PLANT_INSPECTION_ITEMS.map((_, i) => [i + 1, data.defects[i]?.locked ? { status: 'logged', comment: '', repeatConfirmed: false } : previous[i + 1]?.status === 'logged' ? { status: '', comment: '', repeatConfirmed: false } : previous[i + 1] || { status: '', comment: '', repeatConfirmed: false }])));
      setDetailsReady(true);
    } catch (e) { if (generation === assetGeneration.current) setError(e instanceof Error ? e.message : 'Unable to load defects.'); }
  }
  const searchJobs = useCallback((query: string) => setJobQuery(query), []);
  useEffect(() => {
    let active = true;
    setJobs([]); setJobError('');
    const query = jobQuery.trim();
    if (query.replace(/\s/g, '').length < 3) { setJobLoading(false); return; }
    setJobLoading(true);
    const timer = window.setTimeout(() => {
      void api<{ jobs: GuestPlantJob[] }>(`${API}?search=${encodeURIComponent(query)}`)
        .then(data => { if (active) setJobs(data.jobs); })
        .catch(e => { if (active) setJobError(e instanceof Error ? e.message : 'Unable to load job codes.'); })
        .finally(() => { if (active) setJobLoading(false); });
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [jobQuery, jobRetry]);
  function answer(number: number, patch: Partial<{ status: string; comment: string; repeatConfirmed: boolean }>) { setAnswers(prev => ({ ...prev, [number]: { ...(prev[number] || { status: '', comment: '', repeatConfirmed: false }), ...patch } })); }
  async function upload(file: File | undefined, itemNumber: number, retryId?: string) {
    if (!file || uploading !== null || (pendingPhoto && !retryId)) return; const id = retryId || crypto.randomUUID(); setPendingPhoto({ file, itemNumber, id }); setUploading(itemNumber); setError('');
    try { const form = new FormData(); form.set('photo', file); form.set('itemNumber', String(itemNumber)); form.set('requestId', requestId.current); form.set('uploadId', id); const response = await fetch(`${API}/photos`, { method: 'POST', body: form }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setPhotos(prev => prev.some(p => p.id === data.id) ? prev : [...prev, data]); setPendingPhoto(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'Photo upload failed.'); } finally { setUploading(null); }
  }
  async function discardPhoto() {
    if (!pendingPhoto || uploading !== null) return;
    setUploading(pendingPhoto.itemNumber); setError('');
    try {
      const response = await fetch(`${API}/photos`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({uploadId:pendingPhoto.id,requestId:requestId.current}) });
      if (!response.ok) throw new Error('Unable to discard photo. Retry when connected.');
      setPendingPhoto(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to discard photo.'); } finally { setUploading(null); }
  }
  async function submit(signatureValue = signature) {
    if (!asset || !job || !detailsReady || inFlight.current || pendingPhoto) return;
    const parsed = GuestPlantSubmissionSchema.safeParse({ requestId: requestId.current, plantId: asset.id, name, date, jobNumber, jobSourceType: job.sourceType, jobSourceId: job.sourceId,
      hours: hours.trim() ? Number(hours) : -1, hoursConfirmed, signature: signatureValue, comments, informWorkshop,
      items: PLANT_INSPECTION_ITEMS.map((_, i) => ({ number: i + 1, status: answers[i + 1]?.status, comment: answers[i + 1]?.comment || '', repeatConfirmed: answers[i + 1]?.repeatConfirmed || false })), photoIds: photos.map(p => p.id) });
    if (!pendingPayload.current && !parsed.success) { setError(parsed.error.issues[0]?.message || 'Complete every item and sign.'); return; }
    inFlight.current = true; setBusy(true); setError('');
    const payload = pendingPayload.current || (parsed.success ? parsed.data : null);
    try { setReceipt(await api(API, payload)); pendingPayload.current = null; }
    catch (e) { // Keep the identical request for an uncertain response; the server returns the same receipt on replay.
      pendingPayload.current = e instanceof ApiError && e.status < 500 ? null : payload; setError(e instanceof Error ? e.message : 'Unable to submit. Retry without closing this page.');
    } finally { inFlight.current = false; setBusy(false); }
  }
  const lockedForRetry = pendingPayload.current !== null;
  const completed = Object.values(answers).filter(value => value.status).length;
  const changedHours = currentHours !== null && hours !== '' && (Number(hours) < currentHours || hours.length > String(currentHours).length);
  const inputClass = 'h-12 text-base bg-slate-900/50 border-slate-600 text-white';
  const primaryClass = 'min-h-[48px] bg-plant-inspection text-white hover:bg-plant-inspection/90';
  const selectedDescription = asset?.nickname || asset?.category || 'Company plant';
  const dateLabel = date ? new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' }) : '';

  function review() {
    let problem = '';
    if (name.trim().length < 2) problem = 'Enter your full name.';
    else if (!job) problem = 'Please select a catalogue job.';
    else if (!hours.trim() || !Number.isSafeInteger(Number(hours)) || Number(hours) > 2147483647) problem = 'Enter the current full hours reading.';
    else if (changedHours && !hoursConfirmed) problem = 'Confirm the changed hours reading.';
    else if (completed !== PLANT_INSPECTION_ITEMS.length) problem = 'Complete every checklist item.';
    else if (Object.values(answers).some(value => value.status === 'attention' && !value.comment.trim())) problem = 'Describe each defect.';
    else if (defects.some(state => !state.locked && state.recentlyCompleted && answers[state.number]?.status === 'attention' && !answers[state.number]?.repeatConfirmed)) problem = 'Confirm that the recently repaired item has a new defect.';
    else if (informWorkshop && comments.trim().length < 10) problem = 'Add at least 10 characters for Workshop.';
    setError(problem);
    if (problem) { document.getElementById('guest-form-error')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    setShowSignature(true);
  }

  function resultControls(number: number, compact = false) {
    const value = answers[number]; const locked = defects[number - 1]?.locked;
    return <div role="group" aria-label={`${PLANT_INSPECTION_ITEMS[number - 1]} result`} className={compact ? 'flex justify-center gap-2' : 'grid grid-cols-3 gap-2'}>
      {(['ok', 'attention', 'na'] as const).map(status => {
        const selected = value?.status === status;
        const label = status === 'ok' ? 'Pass' : status === 'attention' ? 'Fail' : 'N/A';
        const color = !selected ? 'bg-slate-800/30 border-slate-700 hover:bg-slate-800/50' : status === 'ok' ? 'bg-green-500/20 border-green-500 text-green-400' : status === 'attention' ? 'bg-red-500/20 border-red-500 text-red-400' : 'bg-slate-500/20 border-slate-400 text-slate-200';
        return <button type="button" key={status} aria-label={label} title={label} aria-pressed={selected} disabled={locked} onClick={() => answer(number, { status })} className={`flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-xl border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${compact ? 'w-14' : 'w-full'} ${color}`}>
          {status === 'ok' ? <CheckCircle2 className="h-6 w-6" aria-hidden="true" /> : status === 'attention' ? <XCircle className="h-6 w-6" aria-hidden="true" /> : <span className="text-sm font-extrabold">N/A</span>}
          {status !== 'na' && <span className="text-xs font-medium">{label}</span>}
        </button>;
      })}
    </div>;
  }

  function itemNotes(number: number, desktop = false) {
    const value = answers[number]; const state = defects[number - 1];
    if (state?.locked) return <p className="text-sm text-red-300">Already reported to Workshop</p>;
    return <div className="space-y-2">
      <Textarea aria-label={`${value?.status === 'attention' ? 'Defect comments' : 'Notes'} for ${PLANT_INSPECTION_ITEMS[number - 1]}`} placeholder={value?.status === 'attention' ? 'Describe the defect (required)' : 'Optional notes'} maxLength={2000} value={value?.comment || ''} onChange={e => answer(number, { comment: e.target.value })} className={`min-h-[80px] bg-slate-900/50 border-slate-600 text-base text-white ${value?.status === 'attention' && !value.comment.trim() ? 'border-red-500' : ''} ${!desktop && value?.status !== 'attention' && !value?.comment ? 'hidden' : ''}`} />
      {value?.status === 'attention' && state?.recentlyCompleted && <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={value.repeatConfirmed} onChange={e => answer(number, { repeatConfirmed: e.target.checked })} /><span>This was recently repaired. I confirm this is a new defect.</span></label>}
    </div>;
  }

  function photoControl(number: number) {
    const count = photos.filter(photo => photo.itemNumber === number).length;
    return <div className="space-y-2">
      <label className={`relative flex min-h-[48px] cursor-pointer items-center justify-center gap-2 rounded-md border border-slate-600 px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-ring ${uploading !== null || pendingPhoto !== null || photos.length >= 5 ? 'opacity-60' : 'hover:bg-slate-800'}`}>
        <Camera className="h-4 w-4 shrink-0" aria-hidden="true" /><span>{count ? `${count} photo${count === 1 ? '' : 's'} attached` : 'Add photo'}</span>
        <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" aria-label={`Add photo for ${PLANT_INSPECTION_ITEMS[number - 1]}`} disabled={uploading !== null || pendingPhoto !== null || photos.length >= 5} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" onChange={e => { void upload(e.target.files?.[0], number); e.target.value = ''; }} />
      </label>
      {uploading === number && <p role="status" className="text-sm text-muted-foreground">Uploading photo…</p>}
      {pendingPhoto?.itemNumber === number && uploading === null && <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => void upload(pendingPhoto.file, number, pendingPhoto.id)}>Retry photo upload</Button><Button type="button" variant="outline" onClick={() => void discardPhoto()}>Discard failed photo</Button></div>}
    </div>;
  }

  if (receipt) return <div className="guest-plant-checks" data-accent="plant-inspections"><AppPageShell width="narrow"><Card><CardContent className="p-6 space-y-4"><CheckCircle2 className="h-12 w-12 text-green-400" /><h1 className="text-2xl font-bold">Daily check submitted</h1><p>{asset?.plant_id} · {receipt.date}</p><p>{name} — Temporary staff</p><p className="break-all text-sm text-muted-foreground">Reference: {receipt.id}</p><Button className={primaryClass} onClick={() => window.location.reload()}>Check another plant</Button></CardContent></Card></AppPageShell></div>;
  return <div className="guest-plant-checks" data-accent="plant-inspections"><AppPageShell>
    <AppPageHeader title="New Plant Daily Check" description="Daily safety check · Temporary staff" titleClassName="text-xl md:text-3xl" actions={asset ? <div className="rounded-lg border border-plant-inspection/30 bg-plant-inspection/10 px-3 py-2"><div className="text-xs text-muted-foreground">Progress</div><p className="text-lg font-bold">{completed}/{PLANT_INSPECTION_ITEMS.length}</p></div> : undefined} footer={asset ? <div className="h-2 bg-slate-800" role="progressbar" aria-label="Checklist progress" aria-valuemin={0} aria-valuemax={PLANT_INSPECTION_ITEMS.length} aria-valuenow={completed}><div className="h-full bg-plant-inspection transition-all" style={{ width: `${completed / PLANT_INSPECTION_ITEMS.length * 100}%` }} /></div> : undefined} />
    <div id="guest-form-error">{error && <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300 space-y-3"><p>{error}</p>{asset && !lockedForRetry && <Button type="button" variant="outline" disabled={busy} onClick={() => void loadAsset(asset)}>Reload plant details</Button>}</div>}</div>
    {!ready ? <p role="status">{error ? 'Contact your supervisor if you need a current QR code.' : 'Opening daily checks…'}</p> : !asset ? <Card>
      <CardHeader><CardTitle>Choose your plant</CardTitle><CardDescription>Select the company plant you are checking today.</CardDescription></CardHeader>
      <CardContent className="space-y-4"><label className="relative block"><Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input aria-label="Search plant" className={`${inputClass} pl-10`} placeholder="Fleet number or description" value={search} onChange={e => setSearch(e.target.value)} /></label>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">{assets.filter(a => `${a.plant_id} ${a.nickname} ${a.category}`.toLowerCase().includes(search.toLowerCase())).map(a => <button type="button" key={a.id} className="min-h-36 rounded-lg border border-slate-600 bg-slate-900 p-4 text-left space-y-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:border-plant-inspection" onClick={() => void loadAsset(a)}><PlantIcon category={a.category} /><span className="block text-lg font-bold">{a.plant_id}</span><span className="block text-sm break-words">{a.nickname || a.category || 'Company plant'}</span></button>)}</div>
        {!assets.length ? <p>No active company plant is available.</p> : !assets.some(a => `${a.plant_id} ${a.nickname} ${a.category}`.toLowerCase().includes(search.toLowerCase())) && <p className="text-sm text-muted-foreground">No plant matches your search.</p>}
      </CardContent>
    </Card> : <>
      <fieldset disabled={busy || lockedForRetry} className="min-w-0 space-y-6 disabled:opacity-75">
        <Card><CardHeader className="pb-4"><CardTitle>Daily Check Details</CardTitle><CardDescription>Date: {dateLabel}</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2"><Label htmlFor="guest-name" className="text-base">Your full name <span className="text-red-400">*</span></Label><Input id="guest-name" className={inputClass} placeholder="Enter your name" value={name} maxLength={100} autoComplete="name" onChange={e => setName(e.target.value)} /></div>
            <div className="rounded-lg border border-slate-600 bg-slate-900/50 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs text-muted-foreground">Company plant</p><p className="font-semibold text-lg">{asset.plant_id}</p><p className="text-sm text-muted-foreground">{selectedDescription}</p></div>{!Object.values(answers).some(a => a.status && a.status !== 'logged') && !photos.length && <Button type="button" variant="outline" disabled={uploading !== null || pendingPhoto !== null} onClick={() => { assetGeneration.current++; setAsset(null); setAnswers({}); setHours(''); setHoursConfirmed(false); }}>Choose another plant</Button>}</div></div>
            {!detailsReady && <p role="status" className="text-sm text-muted-foreground">Checking existing defects…</p>}
            <div className="space-y-2"><Label htmlFor="guest-job" className="text-base">Job code <span className="text-red-400">*</span></Label><JobCodePicker id="guest-job" value={job?.code || ''} selectedSourceId={job?.sourceId} disabled={busy || lockedForRetry} inputClassName={inputClass} onChange={() => undefined} onSearchChange={searchJobs} serverSideFiltering jobCodeOptionsLoading={jobLoading} jobCodeOptionsError={jobError} onRetryJobCodeOptions={() => setJobRetry(value => value + 1)} showOptionDetails jobCodeOptions={jobs.map(option => ({ value: option.code, label: option.code, source: option.sourceType, sourceId: option.sourceId, customerName: option.customerName || null, quoteTitle: option.title }))} onSelectOption={option => { const selected = jobs.find(candidate => candidate.sourceId === option.sourceId && candidate.sourceType === option.source && candidate.code === option.value); if (selected) { setJob(selected); setJobNumber(selected.code); } }} /></div>
            <div className="space-y-2"><Label htmlFor="guest-hours" className="text-base">Current Hours <span className="text-red-400">*</span></Label><Input id="guest-hours" className={inputClass} inputMode="numeric" placeholder={currentHours === null ? 'Enter full hours reading' : `e.g. ${currentHours}`} value={hours} onChange={e => { setHours(e.target.value.replace(/\D/g, '')); setHoursConfirmed(false); }} /><p className="text-xs text-muted-foreground">Enter the full hours shown on the meter.</p></div>
            {changedHours && <label className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"><input type="checkbox" className="mt-1" checked={hoursConfirmed} onChange={e => setHoursConfirmed(e.target.checked)} /><span>I have checked this reading ({hours} hours). The previous recorded reading was {currentHours}.</span></label>}
          </CardContent>
        </Card>
        <Card><CardHeader><CardTitle>{PLANT_INSPECTION_ITEMS.length}-Point Plant Safety Check</CardTitle><CardDescription>Check each item and select Pass, Fail or N/A. Describe any defects.</CardDescription></CardHeader>
          <CardContent>
            <div className="space-y-4 md:hidden">{PLANT_INSPECTION_ITEMS.map((description, i) => <section key={i} className={`space-y-3 rounded-xl border p-4 ${defects[i]?.locked ? 'border-red-500/30 bg-red-500/5' : 'border-slate-700 bg-slate-800/30'}`}><div className="flex items-start gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-700/50 text-sm font-bold text-muted-foreground">{i + 1}</span><div><h3 className="text-base font-medium leading-tight">{description}</h3>{defects[i]?.locked && <Badge className="mt-2 border-red-500/30 bg-red-500/20 text-red-400">LOCKED DEFECT</Badge>}</div></div>{resultControls(i + 1)}{itemNotes(i + 1)}{photoControl(i + 1)}</section>)}</div>
            <div className="hidden md:block overflow-x-auto"><table className="w-full border-collapse"><thead><tr className="border-b border-border text-sm"><th className="p-3 text-left font-medium">#</th><th className="p-3 text-left font-medium">Item</th><th className="p-3 text-center font-medium">Status</th><th className="p-3 text-left font-medium">Comments</th><th className="p-3 text-center font-medium">Photo</th></tr></thead><tbody>{PLANT_INSPECTION_ITEMS.map((description, i) => <tr key={i} className={`border-b border-border/50 ${defects[i]?.locked ? 'bg-red-500/5' : 'hover:bg-slate-800/30'}`}><td className="p-3 text-sm text-muted-foreground">{i + 1}</td><td className="p-3 text-sm"><span>{description}</span>{defects[i]?.locked && <Badge className="mt-2 border-red-500/30 bg-red-500/20 text-red-400">LOCKED</Badge>}</td><td className="p-3">{resultControls(i + 1, true)}</td><td className="min-w-48 p-3">{itemNotes(i + 1, true)}</td><td className="min-w-36 p-3">{photoControl(i + 1)}</td></tr>)}</tbody></table></div>
          </CardContent>
        </Card>
        <Card><CardHeader><CardTitle>Additional Comments</CardTitle><CardDescription>Anything else to note about this plant.</CardDescription></CardHeader><CardContent className="space-y-4"><Textarea aria-label="Additional comments" className="min-h-[100px] bg-slate-900/50 border-slate-600 text-base" value={comments} maxLength={2000} placeholder="Optional comments…" onChange={e => setComments(e.target.value)} /><label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={informWorkshop} onChange={e => setInformWorkshop(e.target.checked)} /><span>Inform Workshop about these additional comments. Report checklist defects above.</span></label></CardContent></Card>
      </fieldset>
      <div className="space-y-3"><p className="text-sm text-muted-foreground">Your name, signature, answers and photos will be recorded with this daily check. Keep this page open if your connection drops.</p><Button className={`${primaryClass} w-full gap-2 md:w-auto`} disabled={busy || uploading !== null || pendingPhoto !== null || !detailsReady} onClick={() => lockedForRetry ? void submit() : review()}>{busy ? <><Loader2 className="h-4 w-4 animate-spin" />Submitting…</> : <><Send className="h-4 w-4" />{lockedForRetry ? 'Retry submission' : 'Review and sign'}</>}</Button></div>
      <Dialog open={showSignature} onOpenChange={open => { if (!busy) setShowSignature(open); }}><DialogContent data-accent="plant-inspections" mobileKeyboardSafe className={dialogContentViewportClassName({ size: 'lg', className: 'guest-plant-checks' })}><DialogHeader><DialogTitle>Sign Plant Daily Check</DialogTitle><DialogDescription>Confirm you have checked {asset.plant_id} today and that your answers are accurate.</DialogDescription></DialogHeader><div className="rounded-lg border border-border p-3 text-sm"><p className="font-medium">{name} — Temporary staff</p><p className="text-muted-foreground">{dateLabel} · {completed}/{PLANT_INSPECTION_ITEMS.length} items complete · {photos.length} photo(s)</p></div>{error && <p role="alert" className="text-sm text-red-300">{error}</p>}{lockedForRetry ? <Button className={primaryClass} disabled={busy} onClick={() => void submit()}>{busy ? 'Submitting…' : 'Retry submission'}</Button> : <SignaturePad initialValue={signature || null} disabled={busy} isSubmitting={busy} submitLabel="Submit daily check" onSave={value => { setSignature(value); void submit(value); }} onCancel={() => setShowSignature(false)} />}</DialogContent></Dialog>
    </>}
  </AppPageShell></div>;
}
