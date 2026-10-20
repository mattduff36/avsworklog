'use client';
import { useMemo, useState } from 'react';
import { PoliciesWorkspace } from '@/components/policies-procedures/PoliciesWorkspace';
import { policyHttpAdapter } from '@/lib/client/policies-procedures';
import { Button } from '@/components/ui/button';
export default function Preview() {
  const [level, setLevel] = useState(4);
  const adapter = useMemo(() => policyHttpAdapter({ 'x-preview-level': String(level) }), [level]);
  return <><div className="mx-auto mb-4 flex max-w-6xl flex-wrap items-center gap-2"><span className="text-sm">Test access:</span>{[[0,'No access'],[2,'Reader'],[4,'Document controller']].map(([value,label]) => <Button key={value} variant={level === value ? 'secondary' : 'outline'} onClick={() => setLevel(Number(value))}>{label}</Button>)}<p className="w-full text-xs text-muted-foreground">Imported originals start as drafts. Publish a completed document to test the reader view. Changes here stay on this PC.</p></div><PoliciesWorkspace key={level} adapter={adapter} accessLevel={level} /></>;
}
