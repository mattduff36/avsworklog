'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowRight, ExternalLink } from 'lucide-react';
import { useAuth } from '@/lib/hooks/useAuth';
import type { ProfileOverviewPayload } from '@/types/profile';
import { useDemoApiData } from '@/components/demo-ui/demo-data';
import { DEMO_ROUTES } from '@/components/demo-ui/route-manifest';
import {
  DemoCard,
  DemoEmptyState,
  DemoErrorState,
  DemoLoadingState,
  DemoPageHeader,
  DemoStat,
  DemoStatusPill,
  DemoToolbar,
} from '@/components/demo-ui/demo-primitives';

interface DashboardSummaryResponse {
  success: boolean;
  metrics: {
    approvals: {
      timesheets: number;
      absences: number;
    };
    badges: {
      approvals: number;
      workshop_pending: number;
      maintenance_due_soon: number;
      maintenance_overdue: number;
      reminders_pending: number;
      actions_unassigned: number;
      quotes_pending_internal_approval: number;
    };
  };
}

interface PriorityItem {
  label: string;
  detail: string;
  count: number;
  href: string;
  tone: string;
}

const REVIEW_FAMILIES = ['Overview', 'Workforce', 'Operations', 'Commercial', 'Account'] as const;

export function DemoIndexPage() {
  return (
    <>
      <DemoPageHeader
        title="Fresh UI review map"
        description="A parallel route set for reviewing the next Squires interface against live operational data."
        actions={
          <Link href="/dashboard" className="dui-button dui-button-secondary">
            Current production UI
            <ExternalLink aria-hidden="true" />
          </Link>
        }
      />

      <div className="dui-notice">
        <strong>Parallel demo</strong>
        <p>
          These routes do not replace production pages. Live actions can affect real records when writes
          are enabled.
        </p>
      </div>

      <div className="dui-review-map">
        {REVIEW_FAMILIES.map((family) => {
          const routes = DEMO_ROUTES.filter((route) => route.family === family);
          return (
            <section key={family} className="dui-review-group">
              <h2>{family}</h2>
              <div className="dui-review-list">
                {routes.map((route) => {
                  const Icon = route.icon;
                  const href =
                    route.href === '/demo/timesheets/[id]' ? '/demo/timesheets' : route.href;
                  return (
                    <Link key={route.href} href={href} className={`dui-review-row dui-accent-${route.accent}`}>
                      <Icon aria-hidden="true" />
                      <span>
                        <strong>{route.label}</strong>
                        <small>{route.href}</small>
                      </span>
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

export function DemoDashboardPage() {
  const { profile } = useAuth();
  const summary = useDemoApiData<DashboardSummaryResponse>(
    'dashboard-summary',
    '/api/dashboard/summary'
  );

  const priorities = useMemo<PriorityItem[]>(() => {
    if (!summary.data) return [];
    const badges = summary.data.metrics.badges;
    return [
      {
        label: 'Approvals waiting',
        detail: `${summary.data.metrics.approvals.timesheets} timesheets and ${summary.data.metrics.approvals.absences} absence requests`,
        count: badges.approvals,
        href: '/demo/approvals',
        tone: 'warning',
      },
      {
        label: 'Maintenance attention',
        detail: `${badges.maintenance_overdue} overdue and ${badges.maintenance_due_soon} due soon`,
        count: badges.maintenance_overdue + badges.maintenance_due_soon,
        href: '/maintenance',
        tone: badges.maintenance_overdue > 0 ? 'danger' : 'warning',
      },
      {
        label: 'Workshop tasks',
        detail: 'Pending operational work',
        count: badges.workshop_pending,
        href: '/demo/workshop-tasks',
        tone: 'neutral',
      },
      {
        label: 'Reminders',
        detail: `${badges.actions_unassigned} unassigned actions`,
        count: badges.reminders_pending,
        href: '/reminders',
        tone: 'neutral',
      },
    ].filter((item) => item.count > 0);
  }, [summary.data]);

  return (
    <>
      <DemoPageHeader
        title={`Good to see you, ${profile?.full_name?.split(' ')[0] || 'there'}`}
        description="Live priorities, handoffs and module access for your current role."
        actions={
          <Link href="/demo/profile" className="dui-button dui-button-secondary">
            View profile
          </Link>
        }
      />

      {summary.isLoading ? <DemoLoadingState /> : null}
      {summary.error ? (
        <DemoErrorState
          message={summary.error.message}
          onRetry={() => void summary.refetch()}
        />
      ) : null}
      {summary.data ? (
        <div className="dui-dashboard-layout">
          <DemoCard
            title="Priority queue"
            description="Items that need attention before routine work."
            className="dui-priority-panel"
          >
            {priorities.length === 0 ? (
              <DemoEmptyState
                title="No urgent items"
                description="The live dashboard summary has no current priority counts for your role."
              />
            ) : (
              <div className="dui-priority-list">
                {priorities.map((item) => (
                  <Link href={item.href} key={item.label} className="dui-priority-row">
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.detail}</small>
                    </span>
                    <span className="dui-priority-count">{item.count}</span>
                    <DemoStatusPill status={item.tone} label="Review" />
                  </Link>
                ))}
              </div>
            )}
          </DemoCard>

          <aside className="dui-dashboard-side">
            <DemoCard title="Role context">
              <div className="dui-stat-stack">
                <DemoStat label="Team" value={profile?.team?.name || 'Not assigned'} />
                <DemoStat
                  label="Role"
                  value={profile?.role?.display_name || profile?.role?.name || 'Employee'}
                />
              </div>
            </DemoCard>
            <DemoCard title="Quick modules">
              <div className="dui-link-list">
                <Link href="/demo/timesheets">Timesheets <ArrowRight aria-hidden="true" /></Link>
                <Link href="/demo/van-inspections/new">New inspection <ArrowRight aria-hidden="true" /></Link>
                <Link href="/demo/absence">Absence <ArrowRight aria-hidden="true" /></Link>
                <Link href="/demo/workshop-tasks">Workshop <ArrowRight aria-hidden="true" /></Link>
              </div>
            </DemoCard>
          </aside>
        </div>
      ) : null}
    </>
  );
}

export function DemoApprovalsPage() {
  const [activeTab, setActiveTab] = useState<'timesheets' | 'absences'>('timesheets');
  const summary = useDemoApiData<DashboardSummaryResponse>(
    'approvals-summary',
    '/api/dashboard/summary'
  );

  const count = summary.data?.metrics.approvals[activeTab] || 0;

  return (
    <>
      <DemoPageHeader
        title="Approvals"
        description="A scope-safe view of the live approval workload for your current role."
      />
      <DemoToolbar label="Approval queue filters">
        <button
          type="button"
          className={`dui-tab${activeTab === 'timesheets' ? ' is-active' : ''}`}
          onClick={() => setActiveTab('timesheets')}
        >
          Timesheets
        </button>
        <button
          type="button"
          className={`dui-tab${activeTab === 'absences' ? ' is-active' : ''}`}
          onClick={() => setActiveTab('absences')}
        >
          Absence
        </button>
        <select aria-label="Approval status" defaultValue="pending" disabled>
          <option value="pending">Pending action</option>
        </select>
      </DemoToolbar>

      {summary.isLoading ? <DemoLoadingState /> : null}
      {summary.error ? (
        <DemoErrorState
          message={summary.error.message}
          onRetry={() => void summary.refetch()}
        />
      ) : null}
      {summary.data ? (
        <DemoCard title={`${activeTab === 'timesheets' ? 'Timesheet' : 'Absence'} queue`}>
          <div className="dui-queue-summary">
            <DemoStat label="Waiting for review" value={count} detail="Live role-scoped summary" />
            <DemoStatusPill status={count > 0 ? 'pending' : 'approved'} label={count > 0 ? 'Action needed' : 'Clear'} />
          </div>
          <DemoEmptyState
            title="Detailed queue stays in production"
            description="The existing queue applies team and secondary-manager rules that are not exposed by a safe list API. Open production to review the exact records."
            actionHref={`/approvals?tab=${activeTab}`}
            actionLabel="Open approval queue"
          />
        </DemoCard>
      ) : null}
    </>
  );
}

export function DemoProfilePage() {
  const profile = useDemoApiData<ProfileOverviewPayload>(
    'profile-overview',
    '/api/profile/overview'
  );

  return (
    <>
      <DemoPageHeader
        title="Profile"
        description="Identity, team, leave and access context from your live Squires profile."
        actions={
          <Link href="/profile" className="dui-button dui-button-primary">
            Edit in production
            <ExternalLink aria-hidden="true" />
          </Link>
        }
      />
      {profile.isLoading ? <DemoLoadingState /> : null}
      {profile.error ? (
        <DemoErrorState
          message={profile.error.message}
          onRetry={() => void profile.refetch()}
        />
      ) : null}
      {profile.data ? (
        <div className="dui-profile-layout">
          <DemoCard title="Identity">
            <dl className="dui-detail-list">
              <div><dt>Name</dt><dd>{profile.data.profile.full_name}</dd></div>
              <div><dt>Email</dt><dd>{profile.data.profile.email || 'Not recorded'}</dd></div>
              <div><dt>Employee ID</dt><dd>{profile.data.profile.employee_id || 'Not recorded'}</dd></div>
              <div><dt>Phone</dt><dd>{profile.data.profile.phone_number || 'Not recorded'}</dd></div>
              <div><dt>Team</dt><dd>{profile.data.profile.team?.name || 'Not assigned'}</dd></div>
              <div><dt>Role</dt><dd>{profile.data.profile.role?.display_name || 'Not assigned'}</dd></div>
            </dl>
          </DemoCard>
          <div className="dui-profile-side">
            <DemoCard title="Annual leave">
              <div className="dui-stat-stack">
                <DemoStat label="Allowance" value={profile.data.annual_leave_summary.allowance} />
                <DemoStat label="Taken" value={profile.data.annual_leave_summary.approved_taken} />
                <DemoStat label="Remaining" value={profile.data.annual_leave_summary.remaining} />
              </div>
            </DemoCard>
            <DemoCard title="Access">
              <p className="dui-muted">
                Effective team: {profile.data.permission_summary.effective_team_name || 'Not assigned'}
              </p>
              <div className="dui-status-wrap">
                {profile.data.permission_summary.modules
                  .filter((module) => module.access_level > 0)
                  .slice(0, 8)
                  .map((module) => (
                    <DemoStatusPill
                      key={module.module_name}
                      status="active"
                      label={module.display_name}
                    />
                  ))}
              </div>
            </DemoCard>
          </div>
        </div>
      ) : null}
    </>
  );
}
