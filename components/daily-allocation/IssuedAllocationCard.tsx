import { format, parseISO } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime } from '@/lib/utils/date';
import { formatDailyAllocationVisitTime } from '@/lib/utils/daily-allocation-timeline';
import type { DailyAllocationIssuedItem, DailyAllocationIssuedVisit } from '@/types/daily-allocation';

function formatWorkDate(workDate: string): string {
  if (!workDate) return 'Unspecified date';
  try {
    return format(parseISO(workDate), 'EEEE d MMM yyyy');
  } catch {
    return workDate;
  }
}

function VisitRow({ visit }: { visit: DailyAllocationIssuedVisit }) {
  const start = formatDailyAllocationVisitTime(visit.starts_at) || visit.instructions.start_time;
  const end = formatDailyAllocationVisitTime(visit.ends_at);
  return (
    <li className="rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{visit.job_code}</p>
        <p>
          <time dateTime={visit.starts_at}>{start || '—'}</time>
          {end ? <>–<time dateTime={visit.ends_at}>{end}</time></> : null}
        </p>
      </div>
      {visit.title ? <p className="text-muted-foreground">{visit.title}</p> : null}
      {visit.site_address ? <p><span className="text-muted-foreground">Site:</span> {visit.site_address}</p> : null}
      {visit.instructions.meeting_point ? <p><span className="text-muted-foreground">Meeting point:</span> {visit.instructions.meeting_point}</p> : null}
      {visit.instructions.meet_person ? <p><span className="text-muted-foreground">Meet:</span> {visit.instructions.meet_person}</p> : null}
      {visit.instructions.notes ? <p><span className="text-muted-foreground">Notes:</span> {visit.instructions.notes}</p> : null}
    </li>
  );
}

export function IssuedAllocationCard({
  item,
  highlighted = false,
}: {
  item: DailyAllocationIssuedItem;
  highlighted?: boolean;
}) {
  const isV2 = item.snapshot_version === 2;
  return (
    <Card
      className={highlighted ? 'border-primary' : undefined}
      data-testid={isV2 ? 'daily-allocation-issued-v2' : 'daily-allocation-issued-v1'}
    >
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base sm:text-lg">
          <span>{formatWorkDate(item.work_date)}</span>
          <span className="flex flex-wrap items-center gap-2">
            {item.revision_no > 0 ? <Badge variant="secondary">Revision {item.revision_no}</Badge> : null}
            <Badge variant="outline">{isV2 ? 'Timed itinerary' : 'Legacy allocation'}</Badge>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Published {formatDateTime(item.published_at) || item.published_at}
        </p>
        {item.availability !== 'available' && item.absence ? (
          <p data-testid="daily-allocation-absence">
            {item.absence.reason_name}
            {item.absence.is_half_day ? ` (${item.absence.half_day_session || 'half day'})` : ''}
          </p>
        ) : null}
        {isV2 && item.unallocated ? (
          <p data-testid="daily-allocation-unallocated">
            You are unallocated for this date. Stay available unless your manager contacts you.
          </p>
        ) : null}
        {isV2 && item.visits.length > 0 ? (
          <ol className="space-y-2" aria-label="Issued visits">
            {item.visits.map((visit) => (
              <VisitRow key={visit.published_visit_id} visit={visit} />
            ))}
          </ol>
        ) : null}
        {!isV2 ? (
          <>
            {item.job_code ? <p><span className="text-muted-foreground">Job:</span> {item.job_code}</p> : null}
            {item.title ? <p><span className="text-muted-foreground">Title:</span> {item.title}</p> : null}
            {item.site_address ? <p><span className="text-muted-foreground">Site:</span> {item.site_address}</p> : null}
            {item.instructions.start_time ? <p><span className="text-muted-foreground">Start:</span> {item.instructions.start_time}</p> : null}
            {item.instructions.meeting_point ? <p><span className="text-muted-foreground">Meeting point:</span> {item.instructions.meeting_point}</p> : null}
            {item.instructions.meet_person ? <p><span className="text-muted-foreground">Meet:</span> {item.instructions.meet_person}</p> : null}
            {item.instructions.notes ? <p><span className="text-muted-foreground">Notes:</span> {item.instructions.notes}</p> : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
