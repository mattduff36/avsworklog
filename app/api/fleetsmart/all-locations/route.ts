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

/**
 * Flat JSON format from /api/vehicle_locations.json
 * Fields are top-level (no `attributes` nesting).
 */
interface FlatLocationEntry {
  id: number | string;
  vehicle_id: number | string;
  latitude: string | number;
  longitude: string | number;
  speed: number;
  heading: number;
  date_time: string;
  address?: string;
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
 * Fetch latest locations for ALL vehicles using the FLAT .json format.
 * This avoids JSON:API relationship issues and gives us direct vehicle_id access.
 */
async function fetchAllLatestLocations(
  vehicles: FleetVehicle[]
): Promise<VehicleWithLocation[]> {
  if (cache.allLocations && Date.now() - cache.allLocationsCachedAt < ALL_LOC_TTL_MS) {
    return cache.allLocations;
  }

  // Use the .json flat format (not JSON:API) — same pattern as vehicles endpoint
  const url = `${BASE}/api/vehicle_locations.json?page%5Bsize%5D=500`;
  const res = await fetchWithRetry(url, {
    headers: fleetsmartHeaders(),
    cache: 'no-store',
  });

  if (!res.ok) throw new Error(`FleetSmart all-locations: ${res.status}`);

  const json = await res.json();

  // .json format can be a plain array OR { data: [...] }
  const entries: FlatLocationEntry[] = Array.isArray(json) ? json : (json.data ?? []);

  console.log(`[FleetSmart All-Locations] Fetched ${entries.length} location entries`);

  if (entries.length > 0) {
    // Log first entry's keys for debugging
    console.log('[FleetSmart All-Locations] Sample entry keys:', Object.keys(entries[0]));
  }

  // Build vehicle lookup by id
  const vehicleMap = new Map<string, FleetVehicle>();
  for (const v of vehicles) {
    vehicleMap.set(String(v.id), v);
  }

  // Deduplicate: keep only the latest entry per vehicle_id
  // Entries are in default order (may not be sorted), so track by date_time
  const latestByVehicle = new Map<string, FlatLocationEntry>();

  for (const entry of entries) {
    const vid = String(entry.vehicle_id);
    if (!vid || vid === 'undefined' || vid === 'null') continue;

    const existing = latestByVehicle.get(vid);
    if (!existing || (entry.date_time > existing.date_time)) {
      latestByVehicle.set(vid, entry);
    }
  }

  const results: VehicleWithLocation[] = [];

  for (const [vid, entry] of latestByVehicle) {
    const lat = typeof entry.latitude === 'number' ? entry.latitude : parseFloat(String(entry.latitude));
    const lng = typeof entry.longitude === 'number' ? entry.longitude : parseFloat(String(entry.longitude));

    if (isNaN(lat) || isNaN(lng)) continue;

    const vehicle = vehicleMap.get(vid);

    results.push({
      vehicleId: vid,
      name: vehicle?.name ?? `Vehicle ${vid}`,
      vrn: vehicle?.vrn ?? '',
      lat,
      lng,
      speed: entry.speed ?? 0,
      heading: entry.heading ?? 0,
      updatedAt: entry.date_time,
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

    return NextResponse.json({ vehicles: allLocations, count: allLocations.length });
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
