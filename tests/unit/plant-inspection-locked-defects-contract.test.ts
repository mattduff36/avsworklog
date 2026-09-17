import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const page = fs.readFileSync(
  path.join(process.cwd(), 'app/(dashboard)/plant-inspections/new/page.tsx'),
  'utf-8'
);

describe('Plant inspection locked-defect page contract', () => {
  it('PI-LOCK-NET-001 clears stale state and records loader failure without direct error logging', () => {
    const loadStart = page.indexOf('const loadLockedDefects = async');
    const tryStart = page.indexOf('try {', loadStart);
    const startBlock = page.slice(loadStart, tryStart);
    const catchStart = page.indexOf('} catch (err) {', loadStart);
    const catchEnd = page.indexOf('loadLockedDefectsRef.current', catchStart);
    const catchBlock = page.slice(catchStart, catchEnd);

    expect(startBlock).toContain("setLockedDefectsLoadState('loading')");
    expect(startBlock).toContain('setLockedDefectsAuthFailed(false)');
    expect(startBlock).toContain('setLoggedDefects(new Map())');
    expect(startBlock).toContain('setRecentlyCompletedDefects(new Map())');
    expect(startBlock).toContain("if (mode === 'replace')");
    expect(catchBlock).toContain('setLockedDefectsLoadState(reportLockedDefectsLoadFailure(err))');
    expect(catchBlock).not.toContain('console.error');
  });

  it('PI-LOCK-GATE-001 ignores stale responses, retries failures, and gates registered Plant submits', () => {
    expect(page.match(/requestId !== lockedDefectsRequestIdRef\.current/g)).toHaveLength(3);
    expect(page).toContain('onClick={() => void loadLockedDefects(selectedPlantId)}');
    expect(page.match(/disabled=\{loading \|\| \(!selectedPlantId && !isHiredPlant\) \|\| !lockedDefectsCheckReady\}/g)).toHaveLength(2);
    expect(page).toContain("setLockedDefectsLoadState('ready')");
    expect(page).toContain("setLockedDefectsLoadState('idle')");
    expect(page).toContain('lockedDefectsRequestIdRef.current += 1');
  });

  it('PI-LOCK-GATE-002 uses no-store fetches and keeps registered-plant submit fail-closed', () => {
    expect(page).toContain("fetch(`/api/plant-inspections/locked-defects?plantId=${plantId}`, { cache: 'no-store' })");
    expect(page).toContain("fetch(`/api/plant-inspections/recent-completed-defects?plantId=${plantId}&days=7`, { cache: 'no-store' })");
    expect(page).toContain('createLockedDefectsCheckError(lockedResponse.status, recentCompletedResponse.status)');
    expect(page).toContain('lockedDefectsFailureIncludesUnauthorized(err)');
    expect(page).toContain("setLockedDefectsAuthFailed(authFailed)");
    expect(page.match(/disabled=\{loading \|\| \(!selectedPlantId && !isHiredPlant\) \|\| !lockedDefectsCheckReady\}/g)).toHaveLength(2);
  });
});
