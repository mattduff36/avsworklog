export type ClientServiceOutageSource = 'auth-session' | 'data-token';

export interface ClientServiceOutage {
  source: ClientServiceOutageSource;
  status: number;
  message: string;
  detectedAt: number;
}

const activeOutages = new Map<ClientServiceOutageSource, ClientServiceOutage>();
const listeners = new Set<() => void>();

function emitChange(): void {
  listeners.forEach((listener) => listener());
}

function normalizeStatus(status?: number | null): number {
  return typeof status === 'number' && status >= 500 ? status : 503;
}

export function shouldTripClientServiceOutage(status?: number | null): boolean {
  return typeof status === 'number' && status >= 500;
}

export function reportClientServiceOutage(
  source: ClientServiceOutageSource,
  status?: number | null,
  message = 'Core data services are temporarily unavailable.'
): void {
  activeOutages.set(source, {
    source,
    status: normalizeStatus(status),
    message,
    detectedAt: Date.now(),
  });
  emitChange();
}

export function clearClientServiceOutage(source?: ClientServiceOutageSource): void {
  if (typeof source === 'undefined') {
    if (activeOutages.size === 0) {
      return;
    }
    activeOutages.clear();
    emitChange();
    return;
  }

  if (!activeOutages.delete(source)) {
    return;
  }

  emitChange();
}

export function getClientServiceOutage(): ClientServiceOutage | null {
  let latestOutage: ClientServiceOutage | null = null;

  activeOutages.forEach((outage) => {
    if (!latestOutage || outage.detectedAt >= latestOutage.detectedAt) {
      latestOutage = outage;
    }
  });

  return latestOutage;
}

export function subscribeToClientServiceOutage(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
