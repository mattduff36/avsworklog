'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useDeferredValue, useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import {
  useDemoAbsences,
  useDemoTimesheetDetail,
  useDemoTimesheets,
  type DemoAbsenceRow,
  type DemoTimesheetRow,
} from '@/components/demo-ui/demo-data';
import {
  DemoCard,
  DemoDataTable,
  DemoEmptyState,
  DemoErrorState,
  DemoLoadingState,
  DemoPageHeader,
  DemoStat,
  DemoStatusPill,
  DemoToolbar,
  type DemoDataTableColumn,
} from '@/components/demo-ui/demo-primitives';
import { DAY_NAMES, type TimesheetEntry } from '@/types/timesheet';

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Not recorded';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${value.slice(0, 10)}T12:00:00`));
}

export function DemoTimesheetsPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const timesheets = useDemoTimesheets();

  const rows = useMemo(() => {
    return (timesheets.data || []).filter((row) => {
      const matchesStatus = status === 'all' || row.status === status;
      const haystack = `${row.profile?.full_name || ''} ${row.profile?.employee_id || ''} ${row.week_ending} ${row.reg_number || ''}`.toLowerCase();
      return matchesStatus && (!deferredSearch || haystack.includes(deferredSearch));
    });
  }, [deferredSearch, status, timesheets.data]);

  const columns: DemoDataTableColumn<DemoTimesheetRow>[] = [
    {
      key: 'week',
      label: 'Week ending',
      render: (row) => (
        <Link href={`/demo/timesheets/${row.id}`} className="dui-table-link">
          {formatDate(row.week_ending)}
        </Link>
      ),
    },
    {
      key: 'employee',
      label: 'Employee',
      render: (row) => row.profile?.full_name || 'My timesheet',
    },
    {
      key: 'type',
      label: 'Type',
      render: (row) => row.timesheet_type || 'Standard',
    },
    {
      key: 'vehicle',
      label: 'Vehicle',
      render: (row) => row.reg_number || 'Not assigned',
    },
    {
      key: 'status',
      label: 'Status',
      render: (row) => <DemoStatusPill status={row.status} />,
    },
  ];

  return (
    <>
      <DemoPageHeader
        title="Timesheets"
        description="A compact live record view with status, week and employee context."
        actions={
          <Link href="/timesheets/new" className="dui-button dui-button-primary">
            New timesheet
            <ExternalLink aria-hidden="true" />
          </Link>
        }
      />
      <DemoToolbar>
        <label className="dui-field dui-field-grow">
          <span>Search</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Employee, week or vehicle"
          />
        </label>
        <label className="dui-field">
          <span>Status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">All statuses</option>
            <option value="draft">Draft</option>
            <option value="submitted">Submitted</option>
            <option value="approved">Approved</option>
            <option value="processed">Processed</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
      </DemoToolbar>

      {timesheets.scopeUnavailable ? (
        <DemoEmptyState
          title="Elevated list scope stays in production"
          description="Manager and admin lists depend on team and secondary permission rules. The demo will not issue a broader query."
          actionHref="/timesheets"
          actionLabel="Open scoped timesheets"
        />
      ) : null}
      {!timesheets.scopeUnavailable && timesheets.isLoading ? <DemoLoadingState /> : null}
      {!timesheets.scopeUnavailable && timesheets.error ? (
        <DemoErrorState
          message={timesheets.error.message}
          onRetry={() => void timesheets.refetch()}
        />
      ) : null}
      {!timesheets.scopeUnavailable && timesheets.data && rows.length === 0 ? (
        <DemoEmptyState
          title="No timesheets match"
          description="Try a different status or clear the search field."
        />
      ) : null}
      {!timesheets.scopeUnavailable && rows.length > 0 ? (
        <DemoDataTable
          rows={rows}
          columns={columns}
          getRowKey={(row) => row.id}
          caption="Live timesheets"
        />
      ) : null}
    </>
  );
}

export function DemoTimesheetDetailPage() {
  const params = useParams<{ id: string }>();
  const timesheet = useDemoTimesheetDetail(params.id || null);

  const entryColumns: DemoDataTableColumn<TimesheetEntry>[] = [
    {
      key: 'day',
      label: 'Day',
      render: (entry) => DAY_NAMES[Math.max(0, entry.day_of_week - 1)] || `Day ${entry.day_of_week}`,
    },
    {
      key: 'start',
      label: 'Start',
      render: (entry) => entry.time_started || 'Not worked',
    },
    {
      key: 'finish',
      label: 'Finish',
      render: (entry) => entry.time_finished || 'Not worked',
    },
    {
      key: 'hours',
      label: 'Hours',
      numeric: true,
      render: (entry) => entry.daily_total?.toFixed(2) || '0.00',
    },
    {
      key: 'job',
      label: 'Job',
      render: (entry) => entry.job_number || entry.job_numbers?.join(', ') || 'Not assigned',
    },
    {
      key: 'remarks',
      label: 'Remarks',
      render: (entry) => entry.remarks || 'None',
    },
  ];

  return (
    <>
      <DemoPageHeader
        title="Timesheet detail"
        description="One selected record, loaded only after access checks have completed."
        actions={
          <Link href={`/timesheets/${params.id}`} className="dui-button dui-button-primary">
            Open production actions
            <ExternalLink aria-hidden="true" />
          </Link>
        }
      />
      {timesheet.isLoading ? <DemoLoadingState rows={8} /> : null}
      {timesheet.error ? (
        <DemoErrorState
          message={timesheet.error.message}
          onRetry={() => void timesheet.refetch()}
        />
      ) : null}
      {timesheet.data ? (
        <>
          <DemoCard title={timesheet.data.profile?.full_name || 'Timesheet overview'}>
            <div className="dui-overview-strip">
              <DemoStat label="Week ending" value={formatDate(timesheet.data.week_ending)} />
              <DemoStat label="Vehicle" value={timesheet.data.reg_number || 'Not assigned'} />
              <DemoStat label="Type" value={timesheet.data.timesheet_type || 'Standard'} />
              <div className="dui-stat">
                <span>Status</span>
                <DemoStatusPill status={timesheet.data.status} />
              </div>
            </div>
          </DemoCard>
          <DemoCard title="Daily entries" description="Hours and job context recorded against this week.">
            {timesheet.data.entries.length === 0 ? (
              <DemoEmptyState
                title="No entries recorded"
                description="This timesheet does not currently contain daily entries."
              />
            ) : (
              <DemoDataTable
                rows={timesheet.data.entries}
                columns={entryColumns}
                getRowKey={(entry) => entry.id || `${entry.timesheet_id}-${entry.day_of_week}`}
                caption="Timesheet daily entries"
              />
            )}
          </DemoCard>
        </>
      ) : null}
    </>
  );
}

export function DemoAbsencePage() {
  const [status, setStatus] = useState('all');
  const absences = useDemoAbsences();
  const rows = useMemo(
    () => (absences.data || []).filter((row) => status === 'all' || row.status === status),
    [absences.data, status]
  );
  const groupedByMonth = useMemo(() => {
    const groups = new Map<string, DemoAbsenceRow[]>();
    rows.forEach((row) => {
      const key = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(
        new Date(`${row.date}T12:00:00`)
      );
      groups.set(key, [...(groups.get(key) || []), row]);
    });
    return Array.from(groups.entries());
  }, [rows]);

  return (
    <>
      <DemoPageHeader
        title="Absence"
        description="Your live leave requests grouped into a compact planning timeline."
        actions={
          <Link href="/absence" className="dui-button dui-button-primary">
            Request absence
            <ExternalLink aria-hidden="true" />
          </Link>
        }
      />
      <DemoToolbar>
        <label className="dui-field">
          <span>Request status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="processed">Processed</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
      </DemoToolbar>
      {absences.isLoading ? <DemoLoadingState /> : null}
      {absences.error ? (
        <DemoErrorState message={absences.error.message} onRetry={() => void absences.refetch()} />
      ) : null}
      {absences.data && groupedByMonth.length === 0 ? (
        <DemoEmptyState
          title="No absence requests"
          description="No live requests match the selected status."
          actionHref="/absence"
          actionLabel="Open absence workflow"
        />
      ) : null}
      <div className="dui-timeline">
        {groupedByMonth.map(([month, monthRows]) => (
          <section key={month} className="dui-timeline-month">
            <h2>{month}</h2>
            <div>
              {monthRows.map((row) => (
                <article key={row.id} className="dui-absence-row">
                  <time dateTime={row.date}>
                    <strong>{new Date(`${row.date}T12:00:00`).getDate()}</strong>
                    <span>{formatDate(row.end_date || row.date)}</span>
                  </time>
                  <span>
                    <strong>{row.absence_reasons?.name || 'Absence'}</strong>
                    <small>
                      {row.is_half_day ? 'Half day' : `${row.duration_days || 1} day request`}
                    </small>
                  </span>
                  <DemoStatusPill status={row.status} />
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
