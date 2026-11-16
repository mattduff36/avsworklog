'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';

type Asset={id:string;kind:string;label:string};
type Preview={assets:Asset[];counts:Record<string,number>;blockers:string[];fingerprint:string;total:number};
export function TestFleetDebugPanel() {
  const [assets,setAssets]=useState<Asset[]>([]);
  const [selected,setSelected]=useState<string[]>([]);
  const [preview,setPreview]=useState<Preview|null>(null);
  const [confirmation,setConfirmation]=useState('');
  const [busy,setBusy]=useState(true);
  const [error,setError]=useState('');
  useEffect(()=>{
    let active=true;
    fetch('/api/debug/test-vehicles').then(async response=>{
      const body=await response.json();
      if (!response.ok) throw new Error(body.error);
      if (active) setAssets(body.assets);
    }).catch(reason=>{if(active)setError(reason.message);}).finally(()=>{if(active)setBusy(false);});
    return ()=>{active=false;};
  },[]);
  async function submit(execute:boolean) {
    setBusy(true);setError('');
    try {
      const response=await fetch('/api/debug/test-vehicles',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        mode:execute?'execute':'preview',assetIds:selected,
        ...(execute?{fingerprint:preview?.fingerprint,confirmation}:{}),
      })});
      const body=await response.json();
      if(!response.ok) throw new Error(body.error);
      if(execute) {
        setPreview(null);setConfirmation('');
        toast.success(`Reset ${body.total} test records. Assets retained. Audit receipt: ${body.receiptId}`);
      } else {setPreview(body);setConfirmation('');}
    } catch(reason) {
      setError(reason instanceof Error?reason.message:'Unable to reset test records.');
      if(execute){setPreview(null);setConfirmation('');}
    } finally {setBusy(false);}
  }
  return <Card>
    <CardHeader><CardTitle>Reset test fleet records</CardTitle><CardDescription>
      Remove test checks, defects and related database records while keeping the test assets.
      Only TE57 VAN, TE57 HGV and plant TE57 are eligible. Super-admin access is required.
    </CardDescription></CardHeader>
    <CardContent className="space-y-5">
      <p className="text-sm text-muted-foreground">Stored photo and attachment files are retained. A cleanup audit receipt is retained.
        Asset details and linked inventory locations, users, jobs and global settings are kept. Inventory contents, shared records, external documents and published allocations prevent the entire reset.</p>
      <fieldset disabled={busy} className="space-y-3"><legend className="mb-2 font-medium">Select one test asset</legend>
        {assets.map(asset=><label key={asset.id} className="flex min-h-11 items-center gap-3 rounded border p-3">
          <input type="radio" name="test-fleet-asset" checked={selected.includes(asset.id)} onChange={()=>{
            setSelected([asset.id]);
            setPreview(null);setConfirmation('');
          }}/><span>{asset.label} <span className="text-muted-foreground">({asset.kind})</span></span>
        </label>)}
        {!assets.length&&!busy&&<p>No eligible test assets found.</p>}
      </fieldset>
      {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button disabled={busy||!selected.length} onClick={()=>void submit(false)}>{busy?'Please wait…':'Preview records to reset'}</Button>
      {preview&&<section className="space-y-4 rounded border p-4" aria-label="Reset preview">
        <h3 className="font-semibold">{preview.total} records for {preview.assets.map(a=>a.label).join(', ')}</h3>
        <ul className="space-y-1 text-sm">{Object.entries(preview.counts).map(([name,count])=><li key={name}>{name.replace(/^(public|private)\./,'').replaceAll('_',' ')}: {count}</li>)}</ul>
        {preview.blockers.length>0?<div role="alert"><p>Reset blocked. No records will be deleted:</p><ul>{preview.blockers.map(blocker=><li key={blocker}>{blocker}</li>)}</ul></div>:<>
          <p className="text-sm">This permanently removes the listed database records. The test assets remain available for new checks.</p>
          <Label htmlFor="test-fleet-confirmation">Type RESET TEST RECORDS to confirm</Label>
          <Input id="test-fleet-confirmation" value={confirmation} disabled={busy} onChange={event=>setConfirmation(event.target.value)} autoComplete="off"/>
          <Button variant="destructive" className="bg-red-600 text-white hover:bg-red-700" disabled={busy||confirmation!=='RESET TEST RECORDS'||!preview.total} onClick={()=>void submit(true)}>Reset test records</Button>
        </>}
      </section>}
    </CardContent>
  </Card>;
}
