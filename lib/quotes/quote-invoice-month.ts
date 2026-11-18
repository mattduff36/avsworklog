import { isIsoDate } from '@/lib/external-documents/validation';

interface QuoteCreation {
  created_at: string | null;
  quote_thread_id?: string | null;
}

const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;

export function londonMonth(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit',
  }).formatToParts(date);
  return `${parts.find(part => part.type === 'year')?.value}-${parts.find(part => part.type === 'month')?.value}`;
}

export function getQuoteInvoiceStartDate(
  quote: QuoteCreation | null,
  versions: QuoteCreation[] = [],
  threadIds = quote?.quote_thread_id ? [quote.quote_thread_id] : [],
): string {
  const candidates = versions.filter(version => !threadIds.length || threadIds.includes(version.quote_thread_id || ''));
  if (!candidates.length && quote) candidates.push(quote);
  return candidates.map(version => version.created_at).filter((value): value is string => Boolean(value)).sort()[0] || '';
}

export function getQuoteInvoiceMonths(createdAt: string, now = new Date()): string[] {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return [];
  const first = londonMonth(created);
  const current = londonMonth(now);
  const months: string[] = [];
  let [year, month] = current.split('-').map(Number);
  while (`${year}-${String(month).padStart(2, '0')}` >= first) {
    months.push(`${year}-${String(month).padStart(2, '0')}`);
    month -= 1;
    if (!month) { year -= 1; month = 12; }
  }
  return months;
}

// Keep DATE storage and existing report/invoice links; the day has no meaning for new requests.
export function normalizeInvoiceMonth(value: string): string | null {
  const month = value.slice(0, 7);
  if (!monthPattern.test(month)) return null;
  if (value !== month && !isIsoDate(value)) return null;
  return `${month}-01`;
}

export function formatInvoiceMonth(value: string): string {
  const month = value.slice(0, 7);
  if (!monthPattern.test(month)) return value;
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${month}-01T00:00:00Z`));
}
