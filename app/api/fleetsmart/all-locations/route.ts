import { NextResponse } from 'next/server';

const BASE = process.env.FLEETSMART_BASE_URL ?? 'https://www.fleetsmartlive.com';
const CLIENT_ID = process.env.FLEETSMART_CLIENT_ID ?? '';
const API_KEY = process.env.FLEETSMART_API_KEY ?? '';

/* ---------- types ---------- */
interface FleetVehicle {
  id: string;
  name: string;
  vrn: string;
  [key: string]: unknown;
}

interface VehicleWithLocation {
  vehicleId: string;
  name: string;
  vrn: string;
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  updatedAt: string;
}

/* ---------- persistent cache (survives HMR in dev) ---------- */
interface AllLocationsCache {
  vehicles: FleetVehicle[] | null;
  vehiclesCachedAt: number;
  allLocations: VehicleWithLocation[] | null;
  allLocationsCachedAt: number;
  lastRequestAt: number;
}

const g = globalThis as unknown as { __fleetsmartAllLocCache?: AllLocationsCache };
if (!g.__fleetsmartAllLocCache) {
  g.__fleetsmartAllLocCache = {
    vehicles: null,
    vehiclesCachedAt: 0,
    allLocations: null,
    allLocationsCachedAt: 0,
    lastRequestAt: 0,
  };
}
const cache = g.__fleetsmartAllLocCache;

const VEHICLES_TTL_MS = 60_000;
const ALL_LOC_TTL_MS = 60_000;
const MIN_INTERVAL_MS = 2_000;

/* ---------- helpers ---------- */
function fleetsmartHeaders(): HeadersInit {
  return {
    'X-CLIENT-ID': CLIENT_ID,
    'X-API-KEY': API_KEY,
    'Content-Type': 'application/vnd.api+json',
  };
}

async function throttle(): Promise<void> {
  const now = Date.now();
  const elapsed = now - cache.lastRequestAt;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
  }
  cache.lastRequestAt = Date.now();
}

async function fetchWithRetry(
  url: string,
  opts: RequestInit,
  retries = 2
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttle();
    const res = await fetch(url, opts);
    if (res.status === 429 && attempt < retries) {
      await new Promise((r) => setTimeout(r, 3_000));
      continue;
    }
    return res;
  }
  throw new Error('FleetSmart request failed after retries');
}

async function fetchVehicles(): Promise<FleetVehicle[]> {
  const now = Date.now();
  if (cache.vehicles && now - cache.vehiclesCachedAt < VEHICLES_TTL_MS) {
    return cache.vehicles;
  }

  const url = `${BASE}/api/vehicles.json?page%5Bsize%5D=200`;
  const res = await fetchWithRetry(url, {
    headers: fleetsmartHeaders(),
    cache: 'no-store',
  });

  if (!res.ok) throw new Error(`FleetSmart vehicles: ${res.status}`);

  const json = await res.json();
  const vehicles: FleetVehicle[] = json.data ?? json ?? [];
  cache.vehicles = vehicles;
  cache.vehiclesCachedAt = Date.now();
  return vehicles;
}

/**
 * Try to extract vehicle_id from a JSON:API resource.
 * Checks: attributes.vehicle_id, relationships.vehicle.data.id
 */
function extractVehicleId(resource: Record<string, unknown>): string | null {
  // 1. Try attributes.vehicle_id
  const attrs = resource.attributes as Record<string, unknown> | undefined;
  if (attrs?.vehicle_id != null) {
    return String(attrs.vehicle_id);
  }

  // 2. Try relationships.vehicle.data.id (JSON:API standard)
  const rels = resource.relationships as Record<string, unknown> | undefined;
  if (rels?.vehicle) {
    const vehicleRel = rels.vehicle as Record<string, unknown>;
    const data = vehicleRel.data as Record<string, unknown> | undefined;
    if (data?.id != null) {
      return String(data.id);
    }
  }

  // 3. Try top-level vehicle_id (flat format mixed in)
  if ((resource as Record<string, unknown>).vehicle_id != null) {
    return String((resource as Record<string, unknown>).vehicle_id);
  }

  return null;
}

/**
 * Fetch latest locations for ALL vehicles.
 * Strategy:
 * 1. Try JSON:API format with large page size (multiple pages if needed)
 * 2. Extract vehicle_id from attributes or relationships
 * 3. Deduplicate to latest per vehicle
 */
async function fetchAllLatestLocations(
  vehicles: FleetVehicle[]
): Promise<VehicleWithLocation[]> {
  if (cache.allLocations && Date.now() - cache.allLocationsCachedAt < ALL_LOC_TTL_MS) {
    return cache.allLocations;
  }

  const vehicleMap = new Map<string, FleetVehicle>();
  for (const v of vehicles) {
    vehicleMap.set(String(v.id), v);
  }

  // Collect all raw entries across pages
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allEntries: Record<string, any>[] = [];
  let page = 1;
  const maxPages = 5; // safety limit

  while (page <= maxPages) {
    const url = `${BASE}/api/vehicle_locations?sort=-date_time&page%5Bnumber%5D=${page}&page%5Bsize%5D=200`;
    const res = await fetchWithRetry(url, {
      headers: fleetsmartHeaders(),
      cache: 'no-store',
    });

    if (!res.ok) {
      console.error(`[FleetSmart All-Locations] Page ${page} failed: ${res.status}`);
      break;
    }

    const json = await res.json();

    // Log raw structure on first page for debugging
    if (page === 1) {
      const dataArr = json.data ?? [];
      console.log(`[FleetSmart All-Locations] Page 1: ${dataArr.length} entries`);
      if (dataArr.length > 0) {
        const sample = dataArr[0];
        console.log('[FleetSmart All-Locations] Sample entry keys:', Object.keys(sample));
        if (sample.attributes) {
          console.log('[FleetSmart All-Locations] Sample attributes keys:', Object.keys(sample.attributes));
        }
        if (sample.relationships) {
          console.log('[FleetSmart All-Locations] Sample relationships keys:', Object.keys(sample.relationships));
        }
      }
      // Log meta/links for pagination info
      if (json.meta) {
        console.log('[FleetSmart All-Locations] Meta:', JSON.stringify(json.meta));
      }
      if (json.links) {
        console.log('[FleetSmart All-Locations] Links:', JSON.stringify(json.links));
      }
    }

    const entries = json.data ?? [];
    if (entries.length === 0) break;

    allEntries.push(...entries);

    // Check if there are more pages
    const hasNextPage = json.links?.next != null;
    if (!hasNextPage || entries.length < 200) break;

    page++;
  }

  console.log(`[FleetSmart All-Locations] Total raw entries across ${page} page(s): ${allEntries.length}`);

  // Deduplicate: keep latest per vehicle_id
  const latestByVehicle = new Map<string, { entry: Record<string, unknown>; dateTime: string }>();

  let unknownVidCount = 0;

  for (const entry of allEntries) {
    const vid = extractVehicleId(entry);
    if (!vid) {
      unknownVidCount++;
      continue;
    }

    const attrs = (entry.attributes ?? entry) as Record<string, unknown>;
    const dateTime = String(attrs.date_time ?? attrs.dateTime ?? '');

    const existing = latestByVehicle.get(vid);
    if (!existing || dateTime > existing.dateTime) {
      latestByVehicle.set(vid, { entry, dateTime });
    }
  }

  if (unknownVidCount > 0) {
    console.warn(`[FleetSmart All-Locations] ${unknownVidCount} entries had no extractable vehicle_id`);
  }

  const results: VehicleWithLocation[] = [];

  for (const [vid, { entry }] of latestByVehicle) {
    const attrs = (entry.attributes ?? entry) as Record<string, unknown>;

    const lat = parseFloat(String(attrs.latitude ?? ''));
    const lng = parseFloat(String(attrs.longitude ?? ''));
    if (isNaN(lat) || isNaN(lng)) continue;

    const vehicle = vehicleMap.get(vid);

    results.push({
      vehicleId: vid,
      name: vehicle?.name ?? `Vehicle ${vid}`,
      vrn: vehicle?.vrn ?? '',
      lat,
      lng,
      speed: Number(attrs.speed ?? 0),
      heading: Number(attrs.heading ?? 0),
      updatedAt: String(attrs.date_time ?? attrs.dateTime ?? ''),
    });
  }

  console.log(`[FleetSmart All-Locations] Resolved ${results.length} unique vehicle locations`);

  cache.allLocations = results;
  cache.allLocationsCachedAt = Date.now();
  return results;
}

/* ---------- route handler ---------- */
export async function GET() {
  if (!CLIENT_ID || !API_KEY) {
    return NextResponse.json(
      { error: 'missing_credentials', message: 'FleetSmart API credentials not configured' },
      { status: 500 }
    );
  }

  try {
    const vehicles = await fetchVehicles();
    const allLocations = await fetchAllLatestLocations(vehicles);

    return NextResponse.json({
      vehicles: allLocations,
      count: allLocations.length,
      totalVehicles: vehicles.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';

    if (message.includes('429')) {
      return NextResponse.json(
        { error: 'rate_limited', message: 'FleetSmart rate limit exceeded.' },
        { status: 429 }
      );
    }

    console.error('[FleetSmart All-Locations] Error:', message);
    return NextResponse.json(
      { error: 'server_error', message: 'Failed to fetch all vehicle locations' },
      { status: 500 }
    );
  }
}
