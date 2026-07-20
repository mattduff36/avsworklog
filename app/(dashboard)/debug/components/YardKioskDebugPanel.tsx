'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Loader2,
  RefreshCw,
  Search,
  Tablet,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PanelLoader } from '@/components/ui/panel-loader';

interface DebugDevice {
  id: string;
  device_label: string;
  presence: 'online' | 'stale' | 'offline' | 'revoked';
  last_heartbeat_at: string | null;
  last_authenticated_at: string | null;
  last_phase: string | null;
  last_app_version: string | null;
  last_deployment_id: string | null;
  last_error_code: string | null;
  last_diagnostic_id: string | null;
  revoked_at: string | null;
}

interface DebugCommand {
  id: string;
  device_id: string;
  command_type: string;
  status: string;
  issued_at: string;
  result_code: string | null;
  error_message: string | null;
}

interface DebugEvent {
  id: string;
  device_id: string | null;
  event_type: string;
  error_code: string | null;
  diagnostic_id: string | null;
  message: string | null;
  created_at: string;
}

interface ErrorCatalogueEntry {
  code: string;
  title: string;
  likelyCause: string;
  howToFix: string;
  severity: string;
}

interface DebugSnapshot {
  devices: DebugDevice[];
  commands: DebugCommand[];
  events: DebugEvent[];
  error_catalogue: ErrorCatalogueEntry[];
  guidance: Array<{
    device_id: string;
    device_label: string;
    code: string;
    likely_cause: string;
    how_to_fix: string;
    diagnostic_id: string | null;
  }>;
  error?: string;
}

function formatDateTime(value: string | null): string {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

export function YardKioskDebugPanel() {
  const [snapshot, setSnapshot] = useState<DebugSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [diagnosticFilter, setDiagnosticFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (diagnosticFilter.trim()) {
        params.set('diagnostic_id', diagnosticFilter.trim());
      }
      const response = await fetch(
        `/api/debug/kiosk${params.toString() ? `?${params}` : ''}`,
        { cache: 'no-store' },
      );
      const result = await response.json() as DebugSnapshot;
      if (!response.ok) {
        throw new Error(result.error || 'Unable to load Yard kiosk diagnostics');
      }
      setSnapshot(result);
      setError('');
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Unable to load Yard kiosk diagnostics',
      );
    } finally {
      setLoading(false);
    }
  }, [diagnosticFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !snapshot) {
    return (
      <PanelLoader
        message="Loading Yard kiosk diagnostics..."
        accent="debug"
        className="min-h-[320px]"
      />
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-border bg-slate-900/50">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-white">
              <Tablet className="h-5 w-5 text-amber-300" />
              Yard Kiosk diagnostics
            </CardTitle>
            <CardDescription className="mt-2 max-w-3xl">
              Live presence, command audit, and plain-English recovery guidance for
              the separate Yard Inventory PWA. Recovery actions stay in Inventory Settings.
            </CardDescription>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Input
              value={diagnosticFilter}
              onChange={(event) => setDiagnosticFilter(event.target.value)}
              placeholder="Filter by Ref / diagnostic ID"
              className="sm:w-72"
            />
            <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Refresh
            </Button>
          </div>
        </CardHeader>
        {error ? (
          <CardContent>
            <div className="flex items-start gap-2 rounded-xl border border-red-500/35 bg-red-500/10 p-3 text-sm text-red-100">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </div>
          </CardContent>
        ) : null}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-border bg-slate-900/40">
          <CardHeader>
            <CardTitle className="text-white">Devices</CardTitle>
            <CardDescription>Heartbeat and last known kiosk state</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(snapshot?.devices || []).map((device) => (
              <div
                key={device.id}
                className="rounded-xl border border-border bg-slate-950/40 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-white">{device.device_label}</p>
                  <Badge variant="outline">{device.presence}</Badge>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  Heartbeat {formatDateTime(device.last_heartbeat_at)}
                  {device.last_phase ? ` · ${device.last_phase}` : ''}
                </p>
                <p className="text-xs text-slate-400">
                  App {device.last_app_version || 'unknown'}
                  {device.last_deployment_id ? ` · deploy ${device.last_deployment_id}` : ''}
                </p>
                {device.last_error_code ? (
                  <p className="mt-1 text-xs text-amber-200">
                    {device.last_error_code}
                    {device.last_diagnostic_id ? ` · ${device.last_diagnostic_id}` : ''}
                  </p>
                ) : null}
              </div>
            ))}
            {(snapshot?.devices || []).length === 0 ? (
              <p className="text-sm text-slate-400">No kiosk devices found.</p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="border-border bg-slate-900/40">
          <CardHeader>
            <CardTitle className="text-white">Likely causes</CardTitle>
            <CardDescription>Guidance from the latest device errors</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(snapshot?.guidance || []).map((item) => (
              <div
                key={`${item.device_id}-${item.code}`}
                className="rounded-xl border border-amber-400/20 bg-amber-500/5 p-3"
              >
                <p className="font-semibold text-amber-100">
                  {item.device_label} · {item.code}
                </p>
                <p className="mt-1 text-sm text-slate-300">{item.likely_cause}</p>
                <p className="mt-1 text-sm text-slate-400">{item.how_to_fix}</p>
                {item.diagnostic_id ? (
                  <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                    Ref {item.diagnostic_id}
                  </p>
                ) : null}
              </div>
            ))}
            {(snapshot?.guidance || []).length === 0 ? (
              <p className="text-sm text-slate-400">No active device error guidance.</p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card className="border-border bg-slate-900/40">
        <CardHeader>
          <CardTitle className="text-white">Command audit</CardTitle>
          <CardDescription>Recent remote recovery commands</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {(snapshot?.commands || []).slice(0, 25).map((command) => (
            <div
              key={command.id}
              className="grid gap-1 rounded-lg border border-border bg-slate-950/40 px-3 py-2 text-sm sm:grid-cols-[1fr_auto]"
            >
              <div>
                <p className="font-medium text-white">
                  {command.command_type} · {command.status}
                </p>
                <p className="text-xs text-slate-400">
                  Device {command.device_id.slice(0, 8)}… · {formatDateTime(command.issued_at)}
                </p>
                {command.error_message ? (
                  <p className="text-xs text-red-300">{command.error_message}</p>
                ) : null}
              </div>
              <p className="text-xs text-slate-500">{command.result_code || '—'}</p>
            </div>
          ))}
          {(snapshot?.commands || []).length === 0 ? (
            <p className="text-sm text-slate-400">No remote commands yet.</p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="border-border bg-slate-900/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <Search className="h-4 w-4" />
            Error catalogue
          </CardTitle>
          <CardDescription>
            Codes the Yard Inventory tablet can show, with plain-English fixes
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-2">
          {(snapshot?.error_catalogue || []).map((entry) => (
            <div
              key={entry.code}
              className="rounded-lg border border-border bg-slate-950/40 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-mono text-xs text-amber-200">{entry.code}</p>
                <Badge variant="outline">{entry.severity}</Badge>
              </div>
              <p className="mt-1 font-semibold text-white">{entry.title}</p>
              <p className="mt-1 text-xs text-slate-400">{entry.likelyCause}</p>
              <p className="mt-1 text-xs text-slate-300">{entry.howToFix}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="border-border bg-slate-900/40">
        <CardHeader>
          <CardTitle className="text-white">Recent events</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(snapshot?.events || []).slice(0, 30).map((event) => (
            <div
              key={event.id}
              className="rounded-lg border border-border bg-slate-950/40 px-3 py-2 text-sm"
            >
              <p className="font-medium text-white">
                {event.event_type}
                {event.error_code ? ` · ${event.error_code}` : ''}
              </p>
              <p className="text-xs text-slate-400">
                {formatDateTime(event.created_at)}
                {event.diagnostic_id ? ` · ${event.diagnostic_id}` : ''}
              </p>
              {event.message ? (
                <p className="text-xs text-slate-300">{event.message}</p>
              ) : null}
            </div>
          ))}
          {(snapshot?.events || []).length === 0 ? (
            <p className="text-sm text-slate-400">No diagnostic events recorded yet.</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
