import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, expect, type Response as BrowserResponse } from '@playwright/test';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import { getTestUser } from '../../testsuite/helpers/auth';

// Private, read-only authenticated checks. Start an approved local build yourself.
// This command never seeds accounts, changes a password, starts a server or uploads artifacts.
const baseURL = process.env.PERF_BASE_URL || 'http://127.0.0.1:4100';
const target = new URL(baseURL);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname), 'PERF_BASE_URL must identify a local test server');
assert.ok(fs.existsSync(path.resolve('testsuite/.state/test-users.json')), 'Missing existing testsuite/.state/test-users.json; no accounts will be provisioned');
const directory = path.resolve('testsuite/.state/performance');
fs.mkdirSync(directory, { recursive: true });
const report: { environment: string; generatedAt: string; checks: Array<Record<string, unknown>>; passed: boolean; failedPhase?: string } = {
  environment: 'Authenticated local server; one pass, no cache reset; timings are observations, not budgets',
  generatedAt: new Date().toISOString(), checks: [], passed: false,
};
let phase = 'prerequisites';

function assertCanvasBound(count: number) {
  assert.ok(count <= 6, 'Long PDF retained more than six canvases for the tested viewport');
}

async function syntheticPdf() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let number = 1; number <= 80; number += 1) {
    const page = document.addPage(number % 2 ? [600, 800] : [800, 500]);
    if (number % 7 === 0) page.setRotation(degrees(90));
    page.drawText(`SYNTHETIC PERFORMANCE FIXTURE - PAGE ${number}`, { x: 30, y: 100, size: 16, font });
  }
  return Buffer.from(await document.save());
}

async function measure(response: BrowserResponse) {
  assert.equal(response.status(), 200, 'Expected an authorised successful read');
  const body = await response.body();
  return { bytes: body.length, body };
}

async function main() {
  // Controlled failing observation proves the allocation guard fails closed.
  assert.throws(() => assertCanvasBound(80), /more than six canvases/);
  report.checks.push({ name: 'controlled oversized-canvas fixture rejected', passed: true });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL, viewport: { width: 1200, height: 850 } });
    // Normal login only. Telemetry and all business mutations are blocked.
    await context.route('**/*', route => {
      const request = route.request();
      const allowed = ['GET', 'HEAD', 'OPTIONS'].includes(request.method())
        || (new URL(request.url()).origin === target.origin && new URL(request.url()).pathname === '/api/auth/login');
      return allowed ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    phase = 'authenticate with existing admin';
    const user = getTestUser('admin');
    await page.goto('/login');
    await page.getByLabel('Email Address').fill(user.email);
    await page.getByLabel('Password', { exact: true }).fill(user.password);
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await page.waitForURL('**/dashboard', { timeout: 60_000 });

    phase = 'HGV bounded lightweight list';
    const hgvRead = page.waitForResponse(response => new URL(response.url()).pathname === '/rest/v1/hgv_inspections');
    const hgvStart = Date.now();
    await page.goto('/hgv-inspections');
    const hgvResponse = await hgvRead;
    const hgv = await measure(hgvResponse);
    const hgvQuery = new URL(hgvResponse.url()).searchParams;
    const projection = hgvQuery.get('select') || '';
    assert.ok(!projection.includes('*') && !projection.includes('signature_data') && !projection.includes('inspector_comments'), 'HGV list fetched a heavy projection');
    assert.ok(Number(hgvQuery.get('limit')) > 0 && Number(hgvQuery.get('limit')) <= 21, 'Initial manager HGV request exceeded the visible window plus sentinel');
    const hgvRows: unknown = JSON.parse(hgv.body.toString('utf8'));
    assert.ok(Array.isArray(hgvRows) && hgvRows.length <= 21, 'Initial HGV response was not bounded');
    report.checks.push({ name: 'HGV initial list', rows: hgvRows.length, bytes: hgv.bytes, responseObservedMs: Date.now() - hgvStart });

    phase = 'inventory inactive collection';
    const inventoryRequests: URL[] = [];
    const onRequest = (request: import('@playwright/test').Request) => {
      const url = new URL(request.url());
      if (url.origin === target.origin && url.pathname.startsWith('/api/inventory')) inventoryRequests.push(url);
    };
    page.on('request', onRequest);
    const inventoryRead = page.waitForResponse(response => new URL(response.url()).pathname === '/api/inventory' && new URL(response.url()).searchParams.get('status') !== 'retired');
    await page.goto('/inventory');
    const inventory = await measure(await inventoryRead);
    await page.waitForTimeout(500);
    page.off('request', onRequest);
    const retired = inventoryRequests.filter(url => url.pathname === '/api/inventory' && url.searchParams.get('status') === 'retired');
    assert.ok(retired.every(url => url.searchParams.get('count') === 'exact'), 'Initial inventory load fetched inactive retired rows');
    report.checks.push({ name: 'inventory initial requests', requestsObserved: inventoryRequests.length, retiredCountRequests: retired.length, activeResponseBytes: inventory.bytes });

    phase = 'maintenance read';
    const maintenanceRead = page.waitForResponse(response => new URL(response.url()).pathname === '/api/maintenance');
    const maintenanceStart = Date.now();
    await page.goto('/maintenance');
    const maintenance = await measure(await maintenanceRead);
    report.checks.push({ name: 'maintenance API', bytes: maintenance.bytes, responseObservedMs: Date.now() - maintenanceStart });

    phase = 'synthetic long PDF';
    const pdf = await syntheticPdf();
    const pdfUrl = `${target.origin}/__performance_fixture__/long.pdf`;
    await context.route('**/__performance_fixture__/long.pdf', route => route.fulfill({ contentType: 'application/pdf', body: pdf }));
    await page.goto(`/pdf-viewer?url=${encodeURIComponent(pdfUrl)}`);
    await expect(page.locator('[data-pdf-page]')).toHaveCount(80, { timeout: 60_000 });
    await expect(page.locator('canvas[data-pdf-rendered=true]').first()).toBeVisible();
    assertCanvasBound(await page.locator('canvas').count());
    const middle = page.locator('[data-pdf-page="40"]');
    await middle.scrollIntoViewIfNeeded();
    await expect(middle.locator('canvas[data-pdf-rendered=true]')).toBeVisible();
    await expect(page.locator('[data-pdf-page="1"] canvas')).toHaveCount(0);
    await expect.poll(() => page.locator('canvas').count()).toBeLessThanOrEqual(6);
    const allocation = await page.locator('canvas').evaluateAll(nodes => {
      const canvases = nodes as HTMLCanvasElement[];
      return { canvases: canvases.length, backingPixels: canvases.reduce((sum, canvas) => sum + canvas.width * canvas.height, 0) };
    });
    assertCanvasBound(allocation.canvases);
    report.checks.push({ name: '80-page PDF deep scroll', ...allocation });
    await context.close();
    report.passed = true;
  } finally { await browser.close(); }
}

void main().catch(() => {
  report.failedPhase = phase;
  process.exitCode = 1;
}).finally(() => {
  // Never persist response bodies, credentials, cookies, signed URLs or page HTML.
  fs.writeFileSync(path.join(directory, 'latest.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
});
