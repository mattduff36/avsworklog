import { permanentRedirect } from 'next/navigation';

type SearchParams = Record<string, string | string[] | undefined>;

function toQueryString(searchParams: SearchParams | undefined) {
  if (!searchParams) return '';
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === 'string') sp.set(key, value);
    else if (Array.isArray(value)) value.forEach(v => sp.append(key, v));
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : '';
}

export default async function RAMSPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  permanentRedirect(`/projects${toQueryString(resolvedSearchParams)}`);
}

