'use client';

import { useState } from 'react';
import { Loader2, PlusCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface LegacyJobCodeResponse {
  success?: boolean;
  message?: string;
  error?: string;
  legacy_job_code?: {
    quote_reference: string | null;
    customer_name: string;
    title: string;
    wasExisting: boolean;
  };
}

export function LegacyJobCodesDebugPanel() {
  const [jobCode, setJobCode] = useState('');
  const [name, setName] = useState('');
  const [customer, setCustomer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<LegacyJobCodeResponse['legacy_job_code'] | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setLastResult(null);

    try {
      const response = await fetch('/api/debug/legacy-job-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_code: jobCode,
          name,
          customer,
        }),
      });
      const payload = await response.json().catch(() => null) as LegacyJobCodeResponse | null;

      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || 'Unable to add legacy job code.');
      }

      setLastResult(payload.legacy_job_code || null);
      toast.success(payload.message || 'Legacy job code added.');
      if (!payload.legacy_job_code?.wasExisting) {
        setJobCode('');
        setName('');
        setCustomer('');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to add legacy job code.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <PlusCircle className="h-5 w-5 text-red-300" />
          Temporary Legacy Job Code Tool
        </CardTitle>
        <CardDescription>
          Add missing job codes to the read-only legacy quotes archive so they appear in the timesheet job-code picker.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 md:grid-cols-[220px_1fr_1fr_auto]" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="legacy-job-code">Job code</Label>
            <Input
              id="legacy-job-code"
              value={jobCode}
              onChange={(event) => setJobCode(event.target.value.toUpperCase())}
              placeholder="0003-NF"
              className="uppercase"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="legacy-job-name">Name</Label>
            <Input
              id="legacy-job-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Short description"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="legacy-job-customer">Customer</Label>
            <Input
              id="legacy-job-customer"
              value={customer}
              onChange={(event) => setCustomer(event.target.value)}
              placeholder="Customer name"
              required
            />
          </div>
          <div className="flex items-end">
            <Button
              type="submit"
              disabled={submitting}
              className="w-full bg-avs-yellow text-slate-900 hover:bg-avs-yellow/90 md:w-auto"
            >
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlusCircle className="mr-2 h-4 w-4" />}
              Add Code
            </Button>
          </div>
        </form>

        {lastResult ? (
          <div className="mt-4 rounded-lg border border-slate-700 bg-slate-900/60 p-4 text-sm text-slate-200">
            <p className="font-semibold text-foreground">
              {lastResult.wasExisting ? 'Already existed' : 'Added'}: {lastResult.quote_reference}
            </p>
            <p className="mt-1 text-slate-400">{lastResult.customer_name} - {lastResult.title}</p>
          </div>
        ) : null}

        <p className="mt-4 text-xs text-slate-400">
          Temporary tool: this writes to `legacy_quotes` only. It does not create live quotes or project numbers.
        </p>
      </CardContent>
    </Card>
  );
}
