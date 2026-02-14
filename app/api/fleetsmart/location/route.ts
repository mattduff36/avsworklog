import { NextRequest, NextResponse } from 'next/server';

const BASE = process.env.FLEETSMART_BASE_URL ?? 'https://www.fleetsmartlive.com';
const CLIENT_ID = process.env.FLEETSMART_CLIENT_ID ?? '';
const API_KEY = process.env.FLEETSMART_API_KEY ?? '';

/* ---------- rate-limit / cache ---------- */
let cachedVehicles: FleetVehicle[] | null = null;
let vehiclesCachedAt = 0;
const VEHICLES_TTL_MS = 10_000; // cache the vehicle list for 10 s

let lastRequestAt = 0;
const MIN_INTERVAL_MS = 1_100; // respect ~1 req/s

/* ---------- types ---------- */
interface FleetVehicle {
  id: string;
  name: string;
  vrn: string;
  [key: string]: unknown;
}

interface FleetLocation {
  latitude: number;
  longitude: number;
  speed: number;
  heading: number;
  timestamp: string;
  [key: string]: unknown;
}

/* ---------- helpers ---------- */
function fleetsmartHeaders(): HeadersInit {
  return {
    'X-CLIENT-ID': CLIENT_ID,
    'X-API-KEY': API_KEY,
    'Content-Type': 'application/vnd.api+json',
  };
}

function regNorm(s: string): string {
  return s.replace(/\s/g, '').toUpperCase();
}

function matchAsset(
  vehicles: FleetVehicle[],
  plantId?: string,
  regNumber?: string
): FleetVehicle | null {
  for (const v of vehicles) {
    if (
      plantId &&
      (v.name?.endsWith(`/${plantId}`) || v.name?.includes(`/${plantId}`))
    ) {
      return v;
    }
    if (
      regNumber &&
      (regNorm(v.vrn || '') === regNorm(regNumber) ||
        regNorm(v.name || '') === regNorm(regNumber))
    ) {
      return v;
    }
  }
  return null;
}

async function throttle(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestAt;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
  }
  lastRequestAt = Date.now();
}

async function fetchVehicles(): Promise<FleetVehicle[]> {
  const now = Date.now();
  if (cachedVehicles && now - vehiclesCachedAt < VEHICLES_TTL_MS) {
    return cachedVehicles;
  }

  await throttle();

  const url = `${BASE}/api/vehicles.json`;
  const res = await fetch(url, {
    headers: fleetsmartHeaders(),
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`FleetSmart vehicles request failed: ${res.status}`);
  }

  const json = await res.json();
  const vehicles: FleetVehicle[] = json.data ?? json ?? [];
  cachedVehicles = vehicles;
  vehiclesCachedAt = Date.now();
  return vehicles;
}

async function fetchLatestLocation(
  vehicleId: string
): Promise<FleetLocation | null> {
  await throttle();

  const url = `${BASE}/api/vehicle_locations.json?filter[vehicle_id]=${vehicleId}&sort=-timestamp&page[size]=1`;
  const res = await fetch(url, {
    headers: fleetsmartHeaders(),
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`FleetSmart location request failed: ${res.status}`);
  }

  const json = await res.json();
  const locations: FleetLocation[] = json.data ?? json ?? [];
  return locations.length > 0 ? locations[0] : null;
}

/* ---------- route handler ---------- */
export async function GET(request: NextRequest) {
  if (!CLIENT_ID || !API_KEY) {
    return NextResponse.json(
      { error: 'missing_credentials', message: 'FleetSmart API credentials not configured' },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const plantId = searchParams.get('plantId') ?? undefined;
  const regNumber = searchParams.get('regNumber') ?? undefined;

  if (!plantId && !regNumber) {
    return NextResponse.json(
      { error: 'bad_request', message: 'Provide either plantId or regNumber query param' },
      { status: 400 }
    );
  }

  try {
    const vehicles = await fetchVehicles();
    const matched = matchAsset(vehicles, plantId, regNumber);

    if (!matched) {
      return NextResponse.json({ error: 'not_found', message: 'Asset not found in FleetSmart' });
    }

    const location = await fetchLatestLocation(matched.id);

    if (!location) {
      return NextResponse.json({
        error: 'no_location',
        message: 'Asset found but no location data available',
        vehicleName: matched.name,
      });
    }

    return NextResponse.json({
      vehicleId: matched.id,
      name: matched.name,
      vrn: matched.vrn,
      lat: location.latitude,
      lng: location.longitude,
      speed: location.speed,
      heading: location.heading,
      updatedAt: location.timestamp,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';

    if (message.includes('401') || message.includes('403')) {
      return NextResponse.json(
        { error: 'auth_error', message: 'FleetSmart authentication failed' },
        { status: 401 }
      );
    }
    if (message.includes('429')) {
      return NextResponse.json(
        { error: 'rate_limited', message: 'FleetSmart rate limit exceeded. Try again shortly.' },
        { status: 429 }
      );
    }

    console.error('[FleetSmart API]', message);
    return NextResponse.json(
      { error: 'server_error', message: 'Failed to fetch FleetSmart data' },
      { status: 500 }
    );
  }
}
