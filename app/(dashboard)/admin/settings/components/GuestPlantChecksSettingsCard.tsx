'use client';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

export function GuestPlantChecksSettingsCard() {
  const [settings, setSettings] = useState<{ enabled: boolean; token: string } | null>(null);
  const [qr, setQr] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [confirmRotate, setConfirmRotate] = useState(false);
  const url = settings ? `${window.location.origin}/guest-plant-checks#key=${settings.token}` : '';
  async function load(body?: { enabled: boolean } | { rotate: true }) {
    setBusy(true); setError('');
    try { const response = await fetch('/api/admin/settings/guest-plant-checks', { cache: 'no-store', ...(body ? { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) }); const value = await response.json(); if (!response.ok) throw new Error(value.error || 'Unable to load settings.'); setSettings(value); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to load settings.'); } finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => { if (url) void QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 4, width: 512 }).then(setQr); }, [url]);
  async function download() { if (!url) return; const svg = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 4 }); const blob = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); const link = document.createElement('a'); link.href = blob; link.download = 'squires-plant-daily-check.svg'; link.click(); setTimeout(() => URL.revokeObjectURL(blob), 1000); }
  function print() { const frame = document.createElement('iframe'); frame.style.position = 'fixed'; frame.style.width = '0'; frame.style.height = '0'; frame.style.border = '0'; document.body.appendChild(frame); const doc = frame.contentDocument; if (!doc) return;
    frame.onload = async () => { try { await Promise.all(Array.from(doc.images).map(image => image.decode())); frame.contentWindow?.focus(); frame.contentWindow?.print(); } finally { setTimeout(() => frame.remove(), 60000); } };
    doc.open(); doc.write(`<html><head><title>Plant Daily Check labels</title><style>body{font:16px Arial;color:#000}.labels{display:grid;grid-template-columns:repeat(2,1fr);gap:20px}.label{border:1px solid #ccc;text-align:center;padding:20px;break-inside:avoid}img{width:180px;height:180px}@page{size:A4;margin:12mm}</style></head><body><div class="labels">${Array.from({ length: 6 }, () => `<div class="label"><h2>SQUIRES</h2><img src="${qr}" alt="Daily check QR code"><h3>Plant Daily Check</h3><p>Scan · Choose plant · Complete check<br>No account required</p></div>`).join('')}</div></body></html>`); doc.close(); }
  return <Card><CardHeader><CardTitle>Temporary staff plant daily checks</CardTitle><CardDescription>One shared QR code for company plant. Staff enter their name and job number, complete the check and sign. No account or PIN is required.</CardDescription></CardHeader><CardContent className="space-y-5">
    {error && <p role="alert" className="text-red-400">{error}</p>}
    {!settings ? <Button variant="outline" disabled={busy} onClick={() => void load()}>{busy ? 'Loading…' : 'Retry'}</Button> : <>
      <div className="flex flex-wrap items-center gap-3"><span>Guest access is <strong>{settings.enabled ? 'enabled' : 'disabled'}</strong></span><Button disabled={busy} onClick={() => void load({ enabled: !settings.enabled })}>{busy ? 'Saving…' : settings.enabled ? 'Disable guest checks' : 'Enable guest checks'}</Button></div>
      <p className="text-sm text-muted-foreground">Disabling access immediately stops new guest activity and keeps submitted checks. Managers and supervisors with Plant Daily Checks access can see the submitted checks.</p>
      {qr && <img src={qr} width={256} height={256} alt="Shared plant daily check QR code" className="bg-white rounded" />}
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!qr || busy} onClick={() => void download()}>Download QR (SVG)</Button><Button variant="outline" disabled={!qr || busy} onClick={print}>Print labels</Button><Button variant="outline" disabled={busy} onClick={() => setConfirmRotate(true)}>Replace QR code</Button></div>
      <p className="text-sm text-muted-foreground">Anyone with this QR link can submit a check while enabled. Names are entered by staff and are not verified identities. Replacing the QR code invalidates old stickers and guest sessions.</p>
    </>}
    <AlertDialog open={confirmRotate} onOpenChange={setConfirmRotate}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Replace the shared QR code?</AlertDialogTitle><AlertDialogDescription>Every existing sticker will stop working. Print and fit replacement labels. Submitted checks are kept.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel><AlertDialogAction className="min-h-11" onClick={() => void load({ rotate: true })}>Replace QR code</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </CardContent></Card>;
}
