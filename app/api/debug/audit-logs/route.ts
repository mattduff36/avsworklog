import { NextRequest, NextResponse } from 'next/server';
import {
  AuditLogQueryError,
  clampAuditLogLimit,
  listAuditLogs,
  requireAuditLogAdminAccess,
  type AuditChangeFilter,
  type AuditTimeWindow,
} from '@/lib/server/audit-logs';
import { createDebugAccessErrorBody } from '@/lib/server/debug-console-access';
import { logServerError } from '@/lib/utils/server-error-logger';

const TIME_WINDOWS = new Set<AuditTimeWindow>(['all', '24h', '7d', '30d', '90d']);
const CHANGE_FILTERS = new Set<AuditChangeFilter>(['all', 'with_changes', 'without_changes']);

function parseTimeWindow(raw: string | null): AuditTimeWindow {
  return raw && TIME_WINDOWS.has(raw as AuditTimeWindow) ? (raw as AuditTimeWindow) : 'all';
}

function parseChangeFilter(raw: string | null): AuditChangeFilter {
  return raw && CHANGE_FILTERS.has(raw as AuditChangeFilter) ? (raw as AuditChangeFilter) : 'all';
}

export async function GET(request: NextRequest) {
  const access = await requireAuditLogAdminAccess();
  if (!access.ok) {
    return NextResponse.json(createDebugAccessErrorBody(access), { status: access.status });
  }

  try {
    const params = request.nextUrl.searchParams;
    const includeFacets = params.get('includeFacets') === '1' || params.get('includeFacets') === 'true';
    const result = await listAuditLogs(
      {
        q: params.get('q') || undefined,
        userId: params.get('userId') || undefined,
        teamId: params.get('teamId') || undefined,
        table: params.get('table') || undefined,
        action: params.get('action') || undefined,
        timeWindow: parseTimeWindow(params.get('timeWindow')),
        changeFilter: parseChangeFilter(params.get('changeFilter')),
        cursor: params.get('cursor'),
        limit: clampAuditLogLimit(params.get('limit')),
      },
      { includeFacets }
    );

    return NextResponse.json({
      success: true,
      logs: result.logs,
      pagination: result.pagination,
      facets: result.facets,
      searchApplied: result.searchApplied,
    });
  } catch (error) {
    if (error instanceof AuditLogQueryError) {
      const status = error.code === 'INVALID_CURSOR' || error.code === 'SEARCH_TOO_BROAD' ? 400 : 500;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/debug/audit-logs',
      additionalData: {
        endpoint: '/api/debug/audit-logs',
        method: 'GET',
      },
    });

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
