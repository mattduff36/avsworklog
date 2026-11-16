'use client';
import { useEffect, useRef, useState } from 'react';
import { Construction, Forklift, Tractor, Truck, Search, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  return <Icon className="h-10 w-10 text-avs-yellow" aria-hidden="true" />;
}
export function GuestPlantCheckForm() {
  const [assets, setAssets] = useState<GuestPlantAsset[]>([]); const [date, setDate] = useState('');
  const [ready, setReady] = useState(false); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [asset, setAsset] = useState<GuestPlantAsset | null>(null); const [search, setSearch] = useState('');
  const [name, setName] = useState(''); const [jobNumber, setJobNumber] = useState(''); const [jobs, setJobs] = useState<GuestPlantJob[]>([]); const [job, setJob] = useState<GuestPlantJob | null>(null);
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
  async function lookupJob() {
    setBusy(true); setError(''); setJob(null);
    try { const data = await api<{ jobs: GuestPlantJob[] }>(`${API}?job=${encodeURIComponent(jobNumber)}`); setJobs(data.jobs); if (data.jobs.length === 1) setJob(data.jobs[0]); if (!data.jobs.length) setError('No active job matches that number. Check with your supervisor.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to look up job.'); } finally { setBusy(false); }
  }
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
  async function submit() {
    if (!asset || !job || !detailsReady || inFlight.current || pendingPhoto) return;
    const parsed = GuestPlantSubmissionSchema.safeParse({ requestId: requestId.current, plantId: asset.id, name, date, jobNumber, jobSourceType: job.sourceType, jobSourceId: job.sourceId,
      hours: hours.trim() ? Number(hours) : -1, hoursConfirmed, signature, comments, informWorkshop,
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
  if (receipt) return <div className="guest-plant-checks"><AppPageShell width="narrow"><div className="p-6 space-y-4"><CheckCircle2 className="h-12 w-12 text-green-400" /><h1 className="text-2xl font-bold">Daily check submitted</h1><p>{asset?.plant_id} · {receipt.date}</p><p>{name} — Temporary staff</p><p className="break-all text-sm">Reference: {receipt.id}</p><Button onClick={() => window.location.reload()}>Check another plant</Button></div></AppPageShell></div>;
  return <div className="guest-plant-checks"><AppPageShell width="narrow"><AppPageHeader title="Plant Daily Check" description="Temporary staff · no account needed" />
    {error && <div role="alert" className="rounded-lg border border-red-500 bg-red-950/40 p-4 space-y-2"><p>{error}</p>{asset && !lockedForRetry && <Button variant="outline" onClick={() => void loadAsset(asset)}>Reload plant details</Button>}</div>}
    {!ready ? <p role="status">{error ? 'Contact your supervisor if you need a current QR code.' : 'Opening daily checks…'}</p> : !asset ? <section className="space-y-4">
      <h2 className="text-xl font-semibold">Choose your plant</h2><label className="flex items-center gap-2"><Search aria-hidden="true" /><Input aria-label="Search plant" placeholder="Fleet number or description" value={search} onChange={e => setSearch(e.target.value)} /></label>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{assets.filter(a => `${a.plant_id} ${a.nickname} ${a.category}`.toLowerCase().includes(search.toLowerCase())).map(a => <button type="button" key={a.id} className="rounded-lg border border-slate-600 bg-slate-900 p-4 text-left min-h-36 space-y-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow-400 hover:border-yellow-400" onClick={() => void loadAsset(a)}><PlantIcon category={a.category} /><span className="block text-lg font-bold">{a.plant_id}</span><span className="block text-sm break-words">{a.nickname || a.category || 'Company plant'}</span></button>)}</div>
      {!assets.length && <p>No active company plant is available.</p>}
    </section> : <div className="space-y-6">
      <div className="rounded-lg border p-4"><p className="text-xl font-bold">{asset.plant_id} · {asset.nickname || asset.category}</p><p>{date}</p>{!Object.values(answers).some(a => a.status && a.status !== 'logged') && !photos.length && <Button variant="outline" onClick={() => { setAsset(null); setAnswers({}); }}>Choose another plant</Button>}</div>
      {!detailsReady && <p role="status">Checking existing defects…</p>}
      <fieldset disabled={busy || lockedForRetry} className="space-y-5 disabled:opacity-75">
        <label className="block space-y-2"><span>Your full name</span><Input value={name} maxLength={100} autoComplete="name" onChange={e => setName(e.target.value)} /></label>
        <div className="space-y-2"><label htmlFor="guest-job">Job number</label><div className="flex gap-2"><Input id="guest-job" inputMode="numeric" value={jobNumber} maxLength={12} onChange={e => { setJobNumber(e.target.value.replace(/\D/g, '')); setJob(null); setJobs([]); }} /><Button type="button" disabled={!jobNumber || busy} onClick={() => void lookupJob()}>Find job</Button></div>
          {jobs.map(j => <button type="button" aria-pressed={job?.sourceId === j.sourceId && job.sourceType === j.sourceType} key={`${j.sourceType}:${j.sourceId}`} onClick={() => setJob(j)} className={`block w-full text-left rounded-lg border p-3 ${job?.sourceId === j.sourceId ? 'border-yellow-400 bg-yellow-400/10' : 'border-slate-600'}`}>{j.code} · {j.title || 'Job'}</button>)}
        </div>
        <label className="block space-y-2"><span>Current full hours reading</span><Input inputMode="numeric" value={hours} onChange={e => { setHours(e.target.value.replace(/\D/g, '')); setHoursConfirmed(false); }} /></label>
        {currentHours !== null && hours !== '' && (Number(hours) < currentHours || hours.length > String(currentHours).length) && <label className="flex gap-3 rounded border border-amber-400 p-3"><input type="checkbox" checked={hoursConfirmed} onChange={e => setHoursConfirmed(e.target.checked)} /><span>I have checked this reading ({hours} hours). The previous recorded reading was {currentHours}.</span></label>}
        <div className="space-y-4">{PLANT_INSPECTION_ITEMS.map((description, i) => { const number = i + 1; const state = defects[i]; const value = answers[number]; return <section key={number} className="rounded-lg border border-slate-600 p-4 space-y-3"><h2 className="font-semibold">{number}. {description}</h2>
          {state?.locked ? <p className="text-amber-300">Already reported to Workshop</p> : <div className="grid grid-cols-3 gap-2">{[['ok', 'OK'], ['attention', 'Defect'], ['na', 'N/A']].map(([status, label]) => <Button type="button" key={status} variant={value?.status === status ? 'default' : 'outline'} aria-pressed={value?.status === status} onClick={() => answer(number, { status })}>{label}</Button>)}</div>}
          {!state?.locked && value?.status === 'attention' && <><Textarea aria-label={`Defect comments for ${description}`} placeholder="Describe the defect (required)" maxLength={2000} value={value.comment} onChange={e => answer(number, { comment: e.target.value })} />{state?.recentlyCompleted && <label className="flex gap-2"><input type="checkbox" checked={value.repeatConfirmed} onChange={e => answer(number, { repeatConfirmed: e.target.checked })} />This was recently repaired. I confirm this is a new defect.</label>}</>}
          <label className="block text-sm">{photos.filter(p => p.itemNumber === number).length} photo(s) attached · optional<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" aria-label={`Add photo for ${description}`} disabled={uploading !== null || pendingPhoto !== null || photos.length >= 5} className="block w-full mt-2" onChange={e => { void upload(e.target.files?.[0], number); e.target.value = ''; }} /></label>{uploading === number && <p role="status">Uploading photo…</p>}{pendingPhoto?.itemNumber === number && uploading === null && <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => void upload(pendingPhoto.file, number, pendingPhoto.id)}>Retry photo upload</Button><Button type="button" variant="outline" onClick={() => void discardPhoto()}>Discard failed photo</Button></div>}
        </section>; })}</div>
        <label className="block space-y-2"><span>Additional comments</span><Textarea value={comments} maxLength={2000} onChange={e => setComments(e.target.value)} /></label>
        <label className="flex gap-3"><input type="checkbox" checked={informWorkshop} onChange={e => setInformWorkshop(e.target.checked)} /><span>Inform Workshop about these additional comments. Report checklist defects above.</span></label>
        {signature ? <div className="space-y-2"><p>Signature saved</p><Button variant="outline" onClick={() => setSignature('')}>Sign again</Button></div> : <SignaturePad onSave={setSignature} onCancel={() => setSignature('')} />}
      </fieldset>
      <p className="text-sm text-slate-400">Your name, signature, answers and photos will be recorded with this daily check. Keep this page open if your connection drops.</p>
      <Button className="w-full min-h-12" disabled={busy || uploading !== null || pendingPhoto !== null || !detailsReady || !job || !signature} onClick={() => void submit()}>{busy ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Submitting…</> : lockedForRetry ? 'Retry submission' : 'Submit daily check'}</Button>
    </div>}
  </AppPageShell></div>;
}
