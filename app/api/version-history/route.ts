import { NextRequest, NextResponse } from 'next/server';
import releaseHistoryJson from '@/lib/config/release-history.json';
import {
  formatReleaseHistoryMonthLabel,
  getRecentReleaseHistoryMonths,
  getReleaseHistoryEntriesForMonth,
  type ReleaseHistoryEntry,
} from '@/lib/config/release-version-logic';

const releaseHistory = releaseHistoryJson as ReleaseHistoryEntry[];
const monthKeyPattern = /^\d{4}$/u;

export function GET(request: NextRequest) {
  const availableMonths = getRecentReleaseHistoryMonths(releaseHistory);
  const requestedMonth = request.nextUrl.searchParams.get('month')?.trim();
  const monthKey = requestedMonth || availableMonths[0]?.key || '';

  if (!monthKeyPattern.test(monthKey)) {
    return NextResponse.json({ error: 'Invalid month key' }, { status: 400 });
  }

  const month = availableMonths.find((option) => option.key === monthKey) ?? {
    key: monthKey,
    label: formatReleaseHistoryMonthLabel(monthKey),
  };

  return NextResponse.json({
    month,
    entries: getReleaseHistoryEntriesForMonth(releaseHistory, monthKey),
  });
}
