import { NextRequest } from 'next/server';
import { adminCommandSchema, FIXERRORS_LOCAL_ORIGIN, publicQueueState } from '@/lib/fixerrors/protocol';
import { applyAdminCommand, expireJobs } from '@/lib/fixerrors/control';
import { getFixerrorsOrigin } from '@/lib/server/fixerrors/config';
import { localFixerrorsStore, productionFixerrorsStore } from '@/lib/server/fixerrors/store';
import {
  assertFixerrorsBrowserOrigin, assertFixerrorsRequest, fixerrorsHttpError,
  fixerrorsJson, readBoundedJson, requireFixerrorsSuperAdmin,
} from '@/lib/server/fixerrors/http';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    await requireFixerrorsSuperAdmin();
    const base = { enabled: false, executionAvailable: false, origin: FIXERRORS_LOCAL_ORIGIN, devices: [], jobs: [] };
    const origin = getFixerrorsOrigin();
    if (!origin) return fixerrorsJson(base);
    const scope = assertFixerrorsRequest(request);
    const store = scope === 'production' ? productionFixerrorsStore : localFixerrorsStore;
    const state = await store.transact((tx) => {
      expireJobs(tx.state, Date.now());
      return publicQueueState(tx.state);
    });
    return fixerrorsJson({
      ...base, ...state, enabled: true, origin,
      executionAvailable: scope === 'production' && state.devices.some((device) => !device.revoked && device.bridgeAvailable),
    });
  } catch (error) {
    return fixerrorsHttpError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireFixerrorsSuperAdmin();
    const scope = assertFixerrorsRequest(request);
    assertFixerrorsBrowserOrigin(request, scope);
    const command = adminCommandSchema.parse(await readBoundedJson(request));
    const store = scope === 'production' ? productionFixerrorsStore : localFixerrorsStore;
    const result = await store.transact((tx) => applyAdminCommand(tx, actor, command, Date.now()));
    return fixerrorsJson(result);
  } catch (error) {
    return fixerrorsHttpError(error);
  }
}
