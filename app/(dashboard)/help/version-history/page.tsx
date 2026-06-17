import Link from 'next/link';
import { ArrowLeft, Clock3, History, Sparkles } from 'lucide-react';
import { AppPageHeader, AppPageShell } from '@/components/layout/AppPageShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import releaseHistoryJson from '@/lib/config/release-history.json';
import type { ReleaseHistoryEntry } from '@/lib/config/release-version-logic';

const releaseHistory = releaseHistoryJson as ReleaseHistoryEntry[];

function formatPushedAt(value: string | null): string {
  if (!value) {
    return 'Timestamp unavailable';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Timestamp unavailable';
  }

  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/London',
  }).format(date);
}

function getUpdateKindLabel(entry: ReleaseHistoryEntry): string {
  return entry.updateKind === 'major' ? 'Major update' : 'Minor update';
}

function getUpdateKindClassName(entry: ReleaseHistoryEntry): string {
  return entry.updateKind === 'major'
    ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-200'
    : 'border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-200';
}

export default function HelpVersionHistoryPage() {
  const latestRelease = releaseHistory[0] ?? null;

  return (
    <AppPageShell>
      <AppPageHeader
        title="Version History"
        description="See the main app updates in plain English, including when each update was pushed."
        icon={<History className="h-5 w-5" />}
        actions={(
          <Button asChild variant="outline" size="sm">
            <Link href="/help">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Help
            </Link>
          </Button>
        )}
      />

      <Card className="border-amber-500/30 bg-amber-500/10">
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-xl">
                <Sparkles className="h-5 w-5 text-amber-600 dark:text-amber-300" />
                Current Version
              </CardTitle>
              <CardDescription>
                This is the version currently shown in the Help title bar.
              </CardDescription>
            </div>
            <Badge variant="outline" className="w-fit border-amber-500/40 bg-background/80 text-sm tabular-nums">
              {latestRelease ? `Version ${latestRelease.version}` : 'Version unavailable'}
            </Badge>
          </div>
        </CardHeader>
      </Card>

      <div className="space-y-4">
        {releaseHistory.length > 0 ? (
          releaseHistory.map((entry) => (
            <Card key={entry.version} className="border-border bg-white dark:bg-slate-900">
              <CardContent className="p-5">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="tabular-nums">
                        Version {entry.version}
                      </Badge>
                      <Badge variant="outline" className={getUpdateKindClassName(entry)}>
                        {getUpdateKindLabel(entry)}
                      </Badge>
                    </div>
                    <div className="space-y-1">
                      <h2 className="text-lg font-semibold text-foreground">{entry.title}</h2>
                      <p className="text-sm leading-6 text-muted-foreground">{entry.description}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                    <Clock3 className="h-3.5 w-3.5" />
                    <span title={entry.pushedAt ?? undefined}>{formatPushedAt(entry.pushedAt)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <Card className="border-border bg-white dark:bg-slate-900">
            <CardContent className="p-6 text-sm text-muted-foreground">
              Version history is not available yet.
            </CardContent>
          </Card>
        )}
      </div>
    </AppPageShell>
  );
}
