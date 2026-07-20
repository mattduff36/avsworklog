import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface WebAppManifest {
  name: string;
  id: string;
  start_url: string;
  scope: string;
  display: string;
  display_override: string[];
  theme_color: string;
  orientation: string;
  icons: Array<{
    src: string;
    sizes: string;
    purpose: string;
  }>;
}

function readManifest(path: string): WebAppManifest {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), path), 'utf8'),
  ) as WebAppManifest;
}

describe('Yard kiosk PWA manifest', () => {
  const siteManifest = readManifest('public/manifest.json');
  const kioskManifest = readManifest('public/manifest-yard-kiosk.json');

  it('uses a separate kiosk-only install identity', () => {
    expect(kioskManifest.name).toBe('Yard Inventory');
    expect(kioskManifest.id).toBe('/yard-kiosk');
    expect(kioskManifest.id).not.toBe(siteManifest.id);
    expect(kioskManifest.start_url).toBe('/yard-kiosk');
    expect(kioskManifest.scope).toBe('/yard-kiosk');
    expect(kioskManifest.display).toBe('standalone');
    expect(kioskManifest.display_override).toEqual([
      'fullscreen',
      'standalone',
    ]);
    expect(siteManifest.display_override).toEqual(['standalone']);
  });

  it('requests landscape while leaving the main app portrait-first', () => {
    expect(kioskManifest.orientation).toBe('landscape');
    expect(siteManifest.orientation).toBe('portrait-primary');
  });

  it('matches the Android status bar to the kiosk navigation bar', () => {
    expect(kioskManifest.theme_color).toBe('#020617');

    const kioskLayout = readFileSync(
      resolve(process.cwd(), 'app/yard-kiosk/layout.tsx'),
      'utf8',
    );
    expect(kioskLayout).toContain("const YARD_KIOSK_THEME_COLOR = '#020617'");
    expect(kioskLayout).toContain(
      "const YARD_KIOSK_MANIFEST_VERSION = '20260720-status-bar'",
    );
    expect(kioskLayout).toContain('<YardKioskStatusBar />');
  });

  it('provides Android launcher and maskable icon sizes', () => {
    expect(kioskManifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sizes: '192x192', purpose: 'any' }),
        expect.objectContaining({ sizes: '512x512', purpose: 'any' }),
        expect.objectContaining({ sizes: '192x192', purpose: 'maskable' }),
        expect.objectContaining({ sizes: '512x512', purpose: 'maskable' }),
      ]),
    );
  });

  it('keeps the public kiosk manifest outside authentication middleware', () => {
    const middleware = readFileSync(
      resolve(process.cwd(), 'middleware.ts'),
      'utf8',
    );
    expect(middleware).toContain('manifest-yard-kiosk.json');
  });
});
