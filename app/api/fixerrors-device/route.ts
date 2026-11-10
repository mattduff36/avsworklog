import { NextRequest } from 'next/server';
import { z } from 'zod';
import { applyDeviceCommand, deny } from '@/lib/fixerrors/control';
import { deviceCommandSchema } from '@/lib/fixerrors/protocol';
import { localFixerrorsStore, productionFixerrorsStore } from '@/lib/server/fixerrors/store';
import { issueLocalFixtureRelease } from '@/lib/server/fixerrors/release-fixture';
import { issueProductionAdmission, issueProductionRelease } from '@/lib/server/fixerrors/release-production';
import {
  assertFixerrorsRequest, fixerrorsHttpError, fixerrorsJson, readBoundedJson,
} from '@/lib/server/fixerrors/http';

export const runtime = 'nodejs';

// Independently authenticated device endpoint; never a browser session or cron secret.
export async function POST(request: NextRequest) {
  try {
    const scope = assertFixerrorsRequest(request);
    if (request.headers.has('origin')) deny('Browser device requests are not permitted', 403);
    const id = z.string().uuid().parse(request.headers.get('x-squires-device-id'));
    if (scope === 'production' && id !== process.env.SQUIRES_FIXERRORS_PRODUCTION_DEVICE_ID) deny('Unauthorized device', 401);
    const auth = request.headers.get('authorization') ?? '';
    if (!/^Bearer [A-Za-z0-9_-]{43}$/u.test(auth)) deny('Unauthorized device', 401);
    const command = deviceCommandSchema.parse(await readBoundedJson(request));
    const store = scope === 'production' ? productionFixerrorsStore : localFixerrorsStore;
    const result = await store.transact((tx) => applyDeviceCommand(
      tx, id, auth.slice(7), command, Date.now(),
      scope === 'production' ? issueProductionRelease : issueLocalFixtureRelease,
      scope === 'production' ? issueProductionAdmission : undefined,
    ));
    return fixerrorsJson(result);
  } catch (error) {
    return fixerrorsHttpError(error);
  }
}
