import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { BankHolidayE2EHarness } from './BankHolidayE2EHarness';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function BankHolidayE2EPage({ searchParams }: PageProps) {
  const expectedToken = process.env.AVS_BANK_HOLIDAY_E2E_TOKEN;
  const requestHeaders = await headers();
  const host = requestHeaders.get('host')?.toLowerCase() || '';
  const params = await searchParams;
  const token = typeof params.token === 'string' ? params.token : '';
  const scenario = typeof params.scenario === 'string' ? params.scenario : 'eligible';
  const isLoopback =
    host === 'localhost:4000' ||
    host === '127.0.0.1:4000' ||
    host === '[::1]:4000';

  if (
    process.env.NODE_ENV === 'production' ||
    !expectedToken ||
    token !== expectedToken ||
    !isLoopback
  ) {
    notFound();
  }

  return <BankHolidayE2EHarness scenario={scenario} />;
}
