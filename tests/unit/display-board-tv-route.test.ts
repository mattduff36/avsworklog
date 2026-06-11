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
    expect(html).toContain("DEVICE_TOKEN_STORAGE_KEY = 'displayboard-workshop-device-token'");
    expect(html).toContain("PAIRING_TOKEN_STORAGE_KEY = 'displayboard-workshop-pairing-token'");
    expect(html).not.toContain('x-display-board-token');
  });
});
