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

interface FleetLocationAttributes {
  latitude: string;
  longitude: string;
  speed: number;
  heading: number;
  date_time: string;
  address: string;
  vehicle_id: number;
  [key: string]: unknown;
}

interface FleetLocationResource {
  id: string;
  type: string;
  attributes: FleetLocationAttributes;
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

const VEHICLES_TTL_MS = 60_000; // cache vehicle list for 60 s
const ALL_LOC_TTL_MS = 60_000;  // cache all locations for 60 s
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
 * Fetch latest locations for ALL vehicles in bulk.
 * Strategy: fetch the most recent 500 location entries (no vehicle_id filter),
 * then deduplicate to keep only the latest per vehicle.
 */
async function fetchAllLatestLocations(
  vehicles: FleetVehicle[]
): Promise<VehicleWithLocation[]> {
  // Return from cache if still fresh
  if (cache.allLocations && Date.now() - cache.allLocationsCachedAt < ALL_LOC_TTL_MS) {
    return cache.allLocations;
  }

  // Fetch a large batch of recent locations across all vehicles
  const url = `${BASE}/api/vehicle_locations?sort=-date_time&page%5Bsize%5D=500`;
  const res = await fetchWithRetry(url, {
    headers: fleetsmartHeaders(),
    cache: 'no-store',
  });

  if (!res.ok) throw new Error(`FleetSmart all-locations: ${res.status}`);

  const json = await res.json();
  const resources: FleetLocationResource[] = json.data ?? [];

  // Build vehicle lookup by id
  const vehicleMap = new Map<string, FleetVehicle>();
  for (const v of vehicles) {
    vehicleMap.set(String(v.id), v);
  }

  // Deduplicate: keep the first (most recent due to sort) entry per vehicle_id
  const seen = new Set<string>();
  const results: VehicleWithLocation[] = [];

  for (const r of resources) {
    const vid = String(r.attributes.vehicle_id);
    if (seen.has(vid)) continue;
    seen.add(vid);

    const vehicle = vehicleMap.get(vid);
    const lat = parseFloat(r.attributes.latitude);
    const lng = parseFloat(r.attributes.longitude);

    if (isNaN(lat) || isNaN(lng)) continue;

    results.push({
      vehicleId: vid,
      name: vehicle?.name ?? `Vehicle ${vid}`,
      vrn: vehicle?.vrn ?? '',
      lat,
      lng,
      speed: r.attributes.speed ?? 0,
      heading: r.attributes.heading ?? 0,
      updatedAt: r.attributes.date_time,
    });
  }

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

    return NextResponse.json({ vehicles: allLocations });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';

    if (message.includes('429')) {
      return NextResponse.json(
        { error: 'rate_limited', message: 'FleetSmart rate limit exceeded.' },
        { status: 429 }
      );
    }

    console.error('[FleetSmart All-Locations]', message);
    return NextResponse.json(
      { error: 'server_error', message: 'Failed to fetch all vehicle locations' },
      { status: 500 }
    );
  }
}
