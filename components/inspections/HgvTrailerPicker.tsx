'use client';

import { useId, useState } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { HgvTrailerSelection } from '@/lib/checklists/hgv-trailer-swap';
import { formatTrailerSelection, type HgvCheckAsset } from '@/lib/inspections/hgv-trailer-form';
import { formatFleetAssetLabel } from '@/lib/utils/fleet-asset-label';

interface Props {
  assets: HgvCheckAsset[];
  value: HgvTrailerSelection | null;
  onChange: (value: HgvTrailerSelection) => boolean;
  allowNone?: boolean;
  unknownClassification?: boolean;
  disabled?: boolean;
  confirmChange?: string;
}

export function HgvTrailerPicker({assets, value, onChange, allowNone = true, unknownClassification, disabled, confirmChange}: Props) {
  const fieldId = useId();
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState('');
  const [hireId, setHireId] = useState('');
  const [company, setCompany] = useState('');
  const [pending, setPending] = useState<HgvTrailerSelection | null>(null);
  function apply(next: HgvTrailerSelection) {
    if (onChange(next)) {
      setEditing(false);
      setChoice('');
      setHireId('');
      setCompany('');
    }
  }
  function commit(next: HgvTrailerSelection) {
    if (value && JSON.stringify(next) === JSON.stringify(value)) {
      setEditing(false);
      setChoice('');
      return;
    }
    if (confirmChange) setPending(next);
    else apply(next);
  }
  if (value && !editing) return <div className="flex flex-wrap items-center justify-between gap-2">
    <span>Trailer · {formatTrailerSelection(value, assets)}</span>
    <Button variant="outline" size="sm" type="button" disabled={disabled} onClick={() => setEditing(true)}>Change selection</Button>
  </div>;
  return <fieldset disabled={disabled} className="space-y-3 text-left normal-case tracking-normal">
    <Label htmlFor={fieldId}>Select trailer</Label>
    {unknownClassification && <p className="text-sm text-muted-foreground">For a rigid HGV, choose No trailer attached.</p>}
    <Select disabled={disabled} value={choice} onValueChange={selected => {
      setChoice(selected);
      if (selected === 'none') commit({kind: 'none'});
      else if (selected !== 'hired') commit({kind: 'fleet', trailerHgvId: selected});
    }}>
      <SelectTrigger id={fieldId}><SelectValue placeholder="Select trailer" /></SelectTrigger>
      <SelectContent>{assets.filter(asset => asset.classification === 'trailer').map(asset =>
        <SelectItem key={asset.id} value={asset.id}>{formatFleetAssetLabel({identifier: asset.reg_number, nickname: asset.nickname})}</SelectItem>
      )}<SelectItem value="hired">Hired trailer</SelectItem>{allowNone && <SelectItem value="none">No trailer attached</SelectItem>}</SelectContent>
    </Select>
    {choice === 'hired' && <div className="space-y-2">
      <Label htmlFor={fieldId + '-id'}>Hired trailer registration or ID</Label>
      <Input id={fieldId + '-id'} value={hireId} maxLength={80} onChange={e => setHireId(e.target.value)} />
      <Label htmlFor={fieldId + '-company'}>Hire company</Label>
      <Input id={fieldId + '-company'} value={company} maxLength={120} onChange={e => setCompany(e.target.value)} />
      <Button type="button" disabled={disabled || !hireId.trim() || !company.trim()} onClick={() => commit({kind:'hired', hiredTrailerId:hireId.trim(), hiredTrailerCompany:company.trim()})}>Use hired trailer</Button>
    </div>}
    <AlertDialog open={Boolean(pending)} onOpenChange={open => {if (!open) setPending(null);}}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Change trailer and recheck?</AlertDialogTitle>
          <AlertDialogDescription>{confirmChange}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setChoice('')}>Keep current answers</AlertDialogCancel>
          <AlertDialogAction onClick={() => {if (pending) apply(pending);}}>Change trailer</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    {editing && <Button type="button" variant="ghost" onClick={() => {setEditing(false); setChoice('');}}>Keep current selection</Button>}
  </fieldset>;
}
