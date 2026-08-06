'use client';

import Link from 'next/link';
import { useDeferredValue, useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import {
  useDemoApiData,
  useDemoFleet,
  useDemoWorkshopTasks,
  type DemoFleetAsset,
  type DemoWorkshopTask,
} from '@/components/demo-ui/demo-data';
import {
  DemoDataTable,
  DemoEmptyState,
  DemoErrorState,
  DemoFormSection,
  DemoLoadingState,
  DemoPageHeader,
  DemoStat,
  DemoStatusPill,
  DemoToolbar,
  type DemoDataTableColumn,
} from '@/components/demo-ui/demo-primitives';

interface InspectionCheck {
  id: string;
  label: string;
}

interface InspectionSection {
  id: string;
  title: string;
  description: string;
  checks: InspectionCheck[];
}

interface InventoryItem {
  id: string;
  item_number: string | null;
  name: string;
  category: string | null;
  status: string;
  last_checked_at: string | null;
  location?: {
    name?: string | null;
  } | null;
  inventory_group?: {
    name?: string | null;
  } | null;
}

interface InventoryResponse {
  inventory: InventoryItem[];
}

const INSPECTION_SECTIONS: InspectionSection[] = [
  {
    id: 'cab',
    title: 'Cab and controls',
    description: 'Confirm the driver environment is safe before moving the vehicle.',
    checks: [
      { id: 'mirrors', label: 'Mirrors secure and correctly adjusted' },
      { id: 'horn', label: 'Horn operates correctly' },
      { id: 'seatbelt', label: 'Seatbelt locks and releases correctly' },
      { id: 'warning-lights', label: 'No unexpected warning lights' },
    ],
  },
  {
    id: 'external',
    title: 'External condition',
    description: 'Walk around the vehicle and check visible safety points.',
    checks: [
      { id: 'tyres', label: 'Tyres have safe tread and pressure' },
      { id: 'lights', label: 'Lights and indicators operate correctly' },
      { id: 'body', label: 'Bodywork has no new unsafe damage' },
      { id: 'plates', label: 'Registration plates are clean and secure' },
    ],
  },
  {
    id: 'equipment',
    title: 'Safety equipment',
    description: 'Verify required equipment is present and usable.',
    checks: [
      { id: 'first-aid', label: 'First aid kit present and in date' },
      { id: 'extinguisher', label: 'Fire extinguisher present and in date' },
      { id: 'hi-vis', label: 'High visibility equipment available' },
      { id: 'load', label: 'Load area and restraints are secure' },
    ],
  },
];

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Not recorded';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

export function DemoVanInspectionPage() {
  const [vehicle, setVehicle] = useState('');
  const [mileage, setMileage] = useState('');
  const [notes, setNotes] = useState('');
  const [completedChecks, setCompletedChecks] = useState<Set<string>>(() => new Set());
  const totalChecks = INSPECTION_SECTIONS.reduce((total, section) => total + section.checks.length, 0);
  const completedCount = completedChecks.size;
  const completion = Math.round((completedCount / totalChecks) * 100);

  function toggleCheck(id: string) {
    setCompletedChecks((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      <DemoPageHeader
        title="New van inspection"
        description="A mobile-first checklist draft. Final submission remains in the proven production workflow."
      />
      <div className="dui-inspection-progress" aria-live="polite">
        <span>
          <strong>{completedCount}</strong> of {totalChecks} checks complete
        </span>
        <span>{completion}%</span>
      </div>
      <form className="dui-inspection-form" onSubmit={(event) => event.preventDefault()}>
        <DemoFormSection title="Inspection details" description="Record the vehicle and reading before checking each section.">
          <label className="dui-field">
            <span>Vehicle registration</span>
            <input
              value={vehicle}
              onChange={(event) => setVehicle(event.target.value)}
              autoComplete="off"
              placeholder="Enter registration"
            />
          </label>
          <label className="dui-field">
            <span>Current mileage</span>
            <input
              inputMode="numeric"
              value={mileage}
              onChange={(event) => setMileage(event.target.value)}
              placeholder="Enter mileage"
            />
          </label>
        </DemoFormSection>

        {INSPECTION_SECTIONS.map((section) => {
          const sectionCompleted = section.checks.filter((check) => completedChecks.has(check.id)).length;
          return (
            <DemoFormSection
              key={section.id}
              title={section.title}
              description={`${section.description} ${sectionCompleted} of ${section.checks.length} complete.`}
            >
              <div className="dui-check-list">
                {section.checks.map((check) => (
                  <label key={check.id} className="dui-check-row">
                    <input
                      type="checkbox"
                      checked={completedChecks.has(check.id)}
                      onChange={() => toggleCheck(check.id)}
                    />
                    <span>{check.label}</span>
                  </label>
                ))}
              </div>
            </DemoFormSection>
          );
        })}

        <DemoFormSection title="Notes and handoff">
          <label className="dui-field dui-field-full">
            <span>Defects or notes</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={4}
              placeholder="Add any issues that need attention"
            />
          </label>
          <div className="dui-form-handoff">
            <p>
              This concept keeps draft interactions local. Use production to select the live vehicle,
              capture signatures and submit the inspection.
            </p>
            <Link href="/van-inspections/new" className="dui-button dui-button-primary">
              Continue in production
              <ExternalLink aria-hidden="true" />
            </Link>
          </div>
        </DemoFormSection>
      </form>
    </>
  );
}

export function DemoFleetPage() {
  const [kind, setKind] = useState<'Van' | 'Plant' | 'HGV'>('Van');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const fleet = useDemoFleet();
  const rows = useMemo(
    () =>
      (fleet.data || []).filter(
        (asset) =>
          asset.kind === kind &&
          (!deferredSearch ||
            `${asset.identifier} ${asset.nickname || ''} ${asset.category || ''}`
              .toLowerCase()
              .includes(deferredSearch))
      ),
    [deferredSearch, fleet.data, kind]
  );

  const columns: DemoDataTableColumn<DemoFleetAsset>[] = [
    {
      key: 'asset',
      label: 'Asset',
      render: (asset) => (
        <span className="dui-strong-cell">
          <strong>{asset.identifier}</strong>
          <small>{asset.nickname || 'No nickname'}</small>
        </span>
      ),
    },
    { key: 'category', label: 'Category', render: (asset) => asset.category || 'Uncategorised' },
    { key: 'kind', label: 'Type', render: (asset) => asset.kind },
    {
      key: 'inspection',
      label: 'Last inspection',
      render: (asset) => formatDate(asset.lastInspectionDate),
    },
    { key: 'status', label: 'Status', render: (asset) => <DemoStatusPill status={asset.status} /> },
  ];

  return (
    <>
      <DemoPageHeader
        title="Fleet"
        description="Live vans, plant and HGV records in one dense asset register."
        actions={
          <Link href={`/fleet?tab=${kind.toLowerCase()}s`} className="dui-button dui-button-secondary">
            Manage in production
            <ExternalLink aria-hidden="true" />
          </Link>
        }
      />
      <DemoToolbar>
        <div className="dui-tab-group" role="tablist" aria-label="Fleet asset type">
          {(['Van', 'Plant', 'HGV'] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={kind === option}
              className={`dui-tab${kind === option ? ' is-active' : ''}`}
              onClick={() => setKind(option)}
            >
              {option}
            </button>
          ))}
        </div>
        <label className="dui-field dui-field-grow">
          <span>Search assets</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} type="search" />
        </label>
      </DemoToolbar>
      {fleet.isLoading ? <DemoLoadingState /> : null}
      {fleet.error ? <DemoErrorState message={fleet.error.message} onRetry={() => void fleet.refetch()} /> : null}
      {fleet.data && rows.length === 0 ? (
        <DemoEmptyState title={`No ${kind.toLowerCase()} assets`} description="No live assets match the selected type and search." />
      ) : null}
      {rows.length > 0 ? (
        <DemoDataTable rows={rows} columns={columns} getRowKey={(row) => row.id} caption={`${kind} fleet assets`} />
      ) : null}
    </>
  );
}

function getWorkshopAsset(task: DemoWorkshopTask): string {
  return (
    task.vans?.nickname ||
    task.vans?.reg_number ||
    task.hgvs?.nickname ||
    task.hgvs?.reg_number ||
    task.plant?.nickname ||
    task.plant?.plant_id ||
    'Unassigned asset'
  );
}

export function DemoWorkshopTasksPage() {
  const [filter, setFilter] = useState('all');
  const tasks = useDemoWorkshopTasks();
  const filteredTasks = useMemo(
    () => (tasks.data || []).filter((task) => filter === 'all' || task.status === filter),
    [filter, tasks.data]
  );
  const groups = [
    { status: 'pending', label: 'Pending' },
    { status: 'logged', label: 'In progress' },
    { status: 'on_hold', label: 'On hold' },
    { status: 'completed', label: 'Completed' },
  ];

  return (
    <>
      <DemoPageHeader
        title="Workshop tasks"
        description="Live asset work grouped by operational state for quick triage."
        actions={
          <Link href="/workshop-tasks" className="dui-button dui-button-primary">
            Open workflow
            <ExternalLink aria-hidden="true" />
          </Link>
        }
      />
      <DemoToolbar>
        <label className="dui-field">
          <span>Status</span>
          <select value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value="all">All statuses</option>
            {groups.map((group) => <option key={group.status} value={group.status}>{group.label}</option>)}
          </select>
        </label>
      </DemoToolbar>
      {tasks.isLoading ? <DemoLoadingState /> : null}
      {tasks.error ? <DemoErrorState message={tasks.error.message} onRetry={() => void tasks.refetch()} /> : null}
      {tasks.data && filteredTasks.length === 0 ? (
        <DemoEmptyState title="No workshop tasks" description="No live tasks match the selected status." />
      ) : null}
      {filteredTasks.length > 0 ? (
        <div className="dui-task-board">
          {groups.map((group) => {
            const groupTasks = filteredTasks.filter((task) => task.status === group.status);
            if (filter !== 'all' && filter !== group.status) return null;
            return (
              <section key={group.status} className="dui-task-column">
                <header>
                  <h2>{group.label}</h2>
                  <span>{groupTasks.length}</span>
                </header>
                <div>
                  {groupTasks.length === 0 ? <p className="dui-muted">No tasks</p> : null}
                  {groupTasks.map((task) => (
                    <article key={task.id} className="dui-task-row">
                      <span>
                        <strong>{task.title || getWorkshopAsset(task)}</strong>
                        <small>{getWorkshopAsset(task)}</small>
                      </span>
                      <DemoStatusPill status={task.priority || 'normal'} label={task.priority || 'Normal'} />
                      <p>{task.description || 'No task description'}</p>
                      <Link href="/workshop-tasks">Open in production</Link>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : null}
    </>
  );
}

export function DemoInventoryPage() {
  const [search, setSearch] = useState('');
  const [location, setLocation] = useState('all');
  const [inventoryStatus, setInventoryStatus] = useState<'active' | 'retired'>('active');
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const inventory = useDemoApiData<InventoryResponse>(
    'inventory',
    `/api/inventory?limit=500&status=${inventoryStatus}`
  );
  const locations = useMemo(
    () =>
      Array.from(
        new Set((inventory.data?.inventory || []).map((item) => item.location?.name).filter(Boolean))
      ).sort() as string[],
    [inventory.data]
  );
  const rows = useMemo(
    () =>
      (inventory.data?.inventory || []).filter((item) => {
        const matchesLocation = location === 'all' || item.location?.name === location;
        const text = `${item.item_number || ''} ${item.name} ${item.category || ''}`.toLowerCase();
        return matchesLocation && (!deferredSearch || text.includes(deferredSearch));
      }),
    [deferredSearch, inventory.data, location]
  );
  const columns: DemoDataTableColumn<InventoryItem>[] = [
    {
      key: 'item',
      label: 'Item',
      render: (item) => (
        <span className="dui-strong-cell">
          <strong>{item.name}</strong>
          <small>{item.item_number || 'No item number'}</small>
        </span>
      ),
    },
    { key: 'category', label: 'Category', render: (item) => item.category?.replaceAll('_', ' ') || 'Uncategorised' },
    { key: 'location', label: 'Location', render: (item) => item.location?.name || 'Unknown location' },
    { key: 'checked', label: 'Last checked', render: (item) => formatDate(item.last_checked_at) },
    { key: 'status', label: 'Status', render: (item) => <DemoStatusPill status={item.status} /> },
  ];

  return (
    <>
      <DemoPageHeader
        title="Inventory"
        description="Live stock and equipment records organised for fast location checks."
        actions={
          <Link href="/inventory" className="dui-button dui-button-secondary">
            Manage inventory
            <ExternalLink aria-hidden="true" />
          </Link>
        }
      />
      <DemoToolbar>
        <label className="dui-field dui-field-grow">
          <span>Search stock</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} type="search" />
        </label>
        <label className="dui-field">
          <span>Location</span>
          <select value={location} onChange={(event) => setLocation(event.target.value)}>
            <option value="all">All locations</option>
            {locations.map((option) => <option value={option} key={option}>{option}</option>)}
          </select>
        </label>
        <label className="dui-field">
          <span>Record status</span>
          <select
            value={inventoryStatus}
            onChange={(event) => setInventoryStatus(event.target.value as 'active' | 'retired')}
          >
            <option value="active">Active</option>
            <option value="retired">Retired</option>
          </select>
        </label>
      </DemoToolbar>
      {inventory.isLoading ? <DemoLoadingState /> : null}
      {inventory.error ? (
        <DemoErrorState message={inventory.error.message} onRetry={() => void inventory.refetch()} />
      ) : null}
      {inventory.data && rows.length === 0 ? (
        <DemoEmptyState title="No stock matches" description="Try a different search or location." />
      ) : null}
      {rows.length > 0 ? (
        <>
          <div className="dui-inline-stats">
            <DemoStat label="Visible items" value={rows.length} />
            <DemoStat label="Locations" value={locations.length} />
          </div>
          <DemoDataTable rows={rows} columns={columns} getRowKey={(row) => row.id} caption="Live inventory items" />
        </>
      ) : null}
    </>
  );
}
