import { describe, expect, it } from 'vitest';
import { GET } from '@/app/displayboard-workshop-tv/route';

describe('legacy display board TV route', () => {
  it('serves a no-cache HTML display board shell', async () => {
    const response = GET();
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store, max-age=0');
    expect(html).toContain('<title>Workshop Display Board TV</title>');
    expect(html).toContain('Workshop Display Board');
  });

  it('uses legacy-safe browser APIs for old Samsung TVs', async () => {
    const html = await GET().text();

    expect(html).toContain('new XMLHttpRequest()');
    expect(html).toContain('window.localStorage.getItem');
    expect(html).toContain('window.setTimeout(loadBoard');
    expect(html).not.toContain('fetch(');
    expect(html).not.toContain('/_next/static');
  });

  it('keeps the existing pairing flow and query-string token fallback', async () => {
    const html = await GET().text();

    expect(html).toContain("'/api/display-board/workshop/pairing?_='");
    expect(html).toContain("'/api/display-board/workshop/pairing?pairing_token='");
    expect(html).toContain("'/api/display-board/workshop/data?device_token='");
    expect(html).toContain('"deviceTokenStorageKey":"displayboard-workshop-device-token"');
    expect(html).toContain('"pairingTokenStorageKey":"displayboard-workshop-pairing-token"');
    expect(html).toContain('var DEVICE_TOKEN_STORAGE_KEY = BOARD_CONFIG.deviceTokenStorageKey');
    expect(html).toContain('var PAIRING_TOKEN_STORAGE_KEY = BOARD_CONFIG.pairingTokenStorageKey');
    expect(html).not.toContain('x-display-board-token');
  });

  it('applies saved device text-size steps to the fallback board shell', async () => {
    const html = await GET().text();

    expect(html).toContain('html.tv-text-step-1 { font-size: 50%; }');
    expect(html).toContain('.title { margin-top: 3px; font-size: 2.6875rem;');
    expect(html).toContain('function setTextSizeClass(step)');
    expect(html).toContain('setTextSizeClass(textSize);');
    expect(html).toContain("app.className = 'board text-step-' + textSize;");
  });

  it('uses shared display-board definitions for fallback stats and panels', async () => {
    const html = await GET().text();

    expect(html).toContain('"statTiles":[{"id":"all-assets"');
    expect(html).toContain('"taskPanels":[{"id":"pending"');
    expect(html).toContain('for (index = 0; index < BOARD_CONFIG.statTiles.length; index += 1)');
    expect(html).toContain('for (index = 0; index < BOARD_CONFIG.taskPanels.length; index += 1)');
    expect(html).toContain('rows = rows.slice(0, BOARD_CONFIG.topMaintenanceLimit);');
  });

  it('keeps fallback-only runtime behaviour close to the normal board', async () => {
    const html = await GET().text();

    expect(html).toContain('id="board-now"');
    expect(html).toContain('function startClock()');
    expect(html).toContain('function refreshVisibleBoard()');
    expect(html).toContain('class="hp-badge">HP</span>');
    expect(html).toContain("rows[index].status === 'due_soon' ? 'row-due' : 'row-overdue'");
  });

  it('scales the 1920x1080 fallback canvas to low-resolution TV viewports', async () => {
    const html = await GET().text();

    expect(html).toContain('"designWidth":1920');
    expect(html).toContain('"designHeight":1080');
    expect(html).toContain('width: 1920px;');
    expect(html).toContain('height: 1080px;');
    expect(html).toContain('function scaleBoardToViewport()');
    expect(html).toContain('Math.min(viewport.width / BOARD_CONFIG.designWidth, viewport.height / BOARD_CONFIG.designHeight)');
    expect(html).toContain("var transform = 'scale(' + scale + ')';");
    expect(html).toContain("window.addEventListener('resize', scaleBoardToViewport);");
  });

  it('uses the same viewport scaling on loading, unauthorised, and pairing screens', async () => {
    const html = await GET().text();

    expect(html).toContain('.boot {');
    expect(html).toContain('width: 1920px;');
    expect(html).toContain('height: 1080px;');
    expect(html).toContain("app.className.indexOf('board') === -1 && app.className.indexOf('boot') === -1");
    expect(html).toContain("app.className = 'boot';\n        scaleBoardToViewport();");
    expect(html).toContain('Confirm this code in Admin Settings');
    expect(html).toContain('<div class="pair-code">');
  });
});
