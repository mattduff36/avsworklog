import Link from 'next/link';
import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react';

export interface DemoPageHeaderProps {
  title: string;
  description: string;
  actions?: ReactNode;
}

export function DemoPageHeader({ title, description, actions }: DemoPageHeaderProps) {
  return (
    <header className="dui-page-header">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions ? <div className="dui-page-actions">{actions}</div> : null}
    </header>
  );
}

export interface DemoCardProps {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

export function DemoCard({ title, description, children, className = '' }: DemoCardProps) {
  return (
    <section className={`dui-card ${className}`.trim()}>
      {title || description ? (
        <div className="dui-card-heading">
          {title ? <h2>{title}</h2> : null}
          {description ? <p>{description}</p> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export interface DemoStatProps {
  label: string;
  value: string | number;
  detail?: string;
}

export function DemoStat({ label, value, detail }: DemoStatProps) {
  return (
    <div className="dui-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

export interface DemoStatusPillProps {
  status: string | null | undefined;
  label?: string;
}

function getStatusTone(status: string): string {
  const normalized = status.toLowerCase();
  if (['approved', 'active', 'complete', 'completed', 'processed', 'accepted', 'paid', 'success'].includes(normalized)) {
    return 'success';
  }
  if (['rejected', 'overdue', 'error', 'cancelled', 'inactive', 'failed', 'danger'].includes(normalized)) {
    return 'danger';
  }
  if (['submitted', 'pending', 'on_hold', 'due_soon', 'draft', 'warning'].includes(normalized)) {
    return 'warning';
  }
  return 'neutral';
}

export function DemoStatusPill({ status, label }: DemoStatusPillProps) {
  const value = status || 'unknown';
  return (
    <span className={`dui-status dui-status-${getStatusTone(value)}`}>
      {label || value.replaceAll('_', ' ')}
    </span>
  );
}

export interface DemoToolbarProps {
  children: ReactNode;
  label?: string;
}

export function DemoToolbar({ children, label = 'Filters and actions' }: DemoToolbarProps) {
  return (
    <div className="dui-toolbar" role="group" aria-label={label}>
      {children}
    </div>
  );
}

export interface DemoEmptyStateProps {
  title: string;
  description: string;
  actionHref?: string;
  actionLabel?: string;
}

export function DemoEmptyState({
  title,
  description,
  actionHref,
  actionLabel,
}: DemoEmptyStateProps) {
  return (
    <div className="dui-state dui-empty-state">
      <Inbox aria-hidden="true" />
      <h2>{title}</h2>
      <p>{description}</p>
      {actionHref && actionLabel ? (
        <Link href={actionHref} className="dui-button dui-button-secondary">
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}

export interface DemoLoadingStateProps {
  label?: string;
  rows?: number;
}

export function DemoLoadingState({ label = 'Loading live data', rows = 5 }: DemoLoadingStateProps) {
  return (
    <div className="dui-loading-state" role="status" aria-live="polite">
      <span className="dui-sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <span className="dui-skeleton" key={index} aria-hidden="true" />
      ))}
    </div>
  );
}

export interface DemoErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

export function DemoErrorState({
  title = 'Unable to load this view',
  message,
  onRetry,
}: DemoErrorStateProps) {
  return (
    <div className="dui-state dui-error-state" role="alert">
      <AlertTriangle aria-hidden="true" />
      <h2>{title}</h2>
      <p>{message}</p>
      {onRetry ? (
        <button type="button" className="dui-button dui-button-secondary" onClick={onRetry}>
          <RefreshCw aria-hidden="true" />
          Try again
        </button>
      ) : null}
    </div>
  );
}

export interface DemoFormSectionProps {
  title: string;
  description?: string;
  children: ReactNode;
}

export function DemoFormSection({ title, description, children }: DemoFormSectionProps) {
  return (
    <fieldset className="dui-form-section">
      <legend>{title}</legend>
      {description ? <p>{description}</p> : null}
      <div className="dui-form-grid">{children}</div>
    </fieldset>
  );
}

export interface DemoDataTableColumn<Row> {
  key: string;
  label: string;
  render: (row: Row) => ReactNode;
  numeric?: boolean;
}

export interface DemoDataTableProps<Row> {
  rows: Row[];
  columns: DemoDataTableColumn<Row>[];
  getRowKey: (row: Row) => string;
  caption: string;
}

export function DemoDataTable<Row>({
  rows,
  columns,
  getRowKey,
  caption,
}: DemoDataTableProps<Row>) {
  return (
    <div className="dui-table-shell">
      <table className="dui-table">
        <caption className="dui-sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={column.numeric ? 'dui-numeric' : undefined}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={getRowKey(row)}>
              {columns.map((column) => (
                <td
                  key={column.key}
                  data-label={column.label}
                  className={column.numeric ? 'dui-numeric' : undefined}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
