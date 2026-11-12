import { NextRequest } from 'next/server';
import { adminCommandSchema, FIXERRORS_LOCAL_ORIGIN, publicQueueState } from '@/lib/fixerrors/protocol';
import { applyAdminCommand, deny, expireJobs, expirePreapprovals, type PreparedFixerrorsEvidence } from '@/lib/fixerrors/control';
import { captureFreshFixerrorsEvidence } from '@/lib/server/fixerrors/evidence';
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
      expirePreapprovals(tx, Date.now());
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
    let evidence: PreparedFixerrorsEvidence | undefined;
    if (command.op === 'enqueue') {
      const preparation = await store.transact((tx) => {
        const device = tx.state.devices.find(item => item.id === command.deviceId);
        const current = device?.checkout ?? device?.workspace;
        if (!current) deny('Connected clean checkout required');
        const clean = { head: current.head, tree: current.tree, clean: true as const };
        const { autoDeployConfirmation: _preapproval, ...preflightCommand } = command;
        // Preflight without persisting a job, then recheck under lock after the read.
        applyAdminCommand({ state: structuredClone(tx.state), audit: () => {} }, actor, preflightCommand, Date.now(),
          { checkout: clean, packet: null });
        return {
          checkout: clean,
          reviewPacket: command.reviewJobId ? tx.state.jobs.find(job => job.id === command.reviewJobId)?.packet : undefined,
        };
      });
      if (command.reviewJobId) deny('Request a fresh full batch instead of reusing a single-packet review');
      const batch = await captureFreshFixerrorsEvidence(command.requestId, preparation.checkout);
      evidence = { checkout: preparation.checkout, packet: null, batch };
    }
    const result = await store.transact((tx) => applyAdminCommand(tx, actor, command, Date.now(), evidence));
    return fixerrorsJson(result);
  } catch (error) {
    return fixerrorsHttpError(error);
  }
}
