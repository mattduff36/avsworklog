import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface StorageCookie {
  name: string;
  value: string;
}

interface StorageState {
  cookies?: StorageCookie[];
}

interface RouteCheck {
  path: string;
  label: string;
  authenticated?: boolean;
  manifestHref?: string;
  appleAppTitle?: string;
  themeColor?: string;
}

const baseUrl = process.env.PWA_HEAD_BASE_URL || process.env.TESTSUITE_BASE_URL || 'http://localhost:4000';
const adminStorageStatePath = resolve(process.cwd(), 'testsuite/.state/storage-state-admin.json');
const skipAuthenticatedRoutes = process.env.PWA_HEAD_SKIP_AUTHENTICATED === '1';

const publicRoutes: RouteCheck[] = [
  { path: '/', label: 'root redirect' },
  { path: '/login', label: 'login' },
  { path: '/pwa-debug', label: 'pwa debug' },
  {
    path: '/yard-kiosk/install',
    label: 'Yard kiosk install',
    manifestHref: '/manifest-yard-kiosk.json',
    appleAppTitle: 'Yard Inventory',
    themeColor: '#020617',
  },
];

const authenticatedRoutes: RouteCheck[] = [
  { path: '/', label: 'authenticated root redirect', authenticated: true },
  { path: '/dashboard', label: 'dashboard', authenticated: true },
  { path: '/fleet', label: 'fleet', authenticated: true },
  { path: '/timesheets', label: 'timesheets', authenticated: true },
  { path: '/profile', label: 'profile', authenticated: true },
];

function readCookieHeader(): string | null {
  if (!existsSync(adminStorageStatePath)) {
    return null;
  }

  const storageState = JSON.parse(readFileSync(adminStorageStatePath, 'utf8')) as StorageState;
  const cookies = storageState.cookies || [];
  if (cookies.length === 0) {
    return null;
  }

  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

function getInitialHead(html: string): string {
  const match = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  return match?.[1] ?? '';
}

function getNamedMeta(head: string, name: string): string | null {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = head.match(new RegExp(`<meta\\b(?=[^>]*\\bname=["']${escapedName}["'])([^>]*)>`, 'i'));
  if (!match) return null;

  const contentMatch = match[1].match(/\bcontent=["']([^"']*)["']/i);
  return contentMatch?.[1] ?? '';
}

function getManifestLinks(head: string): string[] {
  return [...head.matchAll(/<link\b(?=[^>]*\brel=["']manifest["'])([^>]*)>/gi)]
    .map((match) => {
      const hrefMatch = match[1].match(/\bhref=["']([^"']*)["']/i);
      return hrefMatch?.[1] ?? '';
    });
}

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function fetchHtml(route: RouteCheck, cookieHeader: string | null): Promise<{ html: string; finalUrl: string; status: number }> {
  const response = await fetch(new URL(route.path, baseUrl), {
    redirect: 'follow',
    headers: {
      accept: 'text/html',
      'user-agent': 'Twitterbot',
      ...(route.authenticated && cookieHeader ? { cookie: cookieHeader } : {}),
    },
  });

  return {
    html: await response.text(),
    finalUrl: response.url,
    status: response.status,
  };
}

function verifyHead(route: RouteCheck, html: string, finalUrl: string, status: number): void {
  assert(status === 200, `${route.label}: expected HTTP 200 after redirects, got ${status} at ${finalUrl}`);
  if (route.authenticated) {
    assert(new URL(finalUrl).pathname !== '/login', `${route.label}: authenticated route resolved to /login; refresh testsuite admin storage state`);
  }

  const head = getInitialHead(html);
  assert(head, `${route.label}: initial <head> not found`);

  assert(getNamedMeta(head, 'apple-mobile-web-app-capable') === 'yes', `${route.label}: missing apple-mobile-web-app-capable=yes in initial head`);
  assert(getNamedMeta(head, 'mobile-web-app-capable') === 'yes', `${route.label}: missing mobile-web-app-capable=yes in initial head`);
  const expectedAppleTitle = route.appleAppTitle || 'Squires';
  assert(
    getNamedMeta(head, 'apple-mobile-web-app-title') === expectedAppleTitle,
    `${route.label}: expected apple-mobile-web-app-title=${expectedAppleTitle}`,
  );
  assert(getNamedMeta(head, 'apple-mobile-web-app-status-bar-style') === 'black-translucent', `${route.label}: missing apple status bar meta in initial head`);
  const expectedThemeColor = route.themeColor || '#0f172a';
  assert(
    getNamedMeta(head, 'theme-color') === expectedThemeColor,
    `${route.label}: expected theme-color=${expectedThemeColor}`,
  );

  const manifests = getManifestLinks(head);
  assert(manifests.length === 1, `${route.label}: expected exactly one manifest link in initial head, got ${manifests.length}`);
  const expectedManifest = route.manifestHref || '/manifest.json';
  assert(
    manifests[0] === expectedManifest,
    `${route.label}: expected ${expectedManifest}, got ${manifests[0]}`,
  );

  const allManifestLinks = [...html.matchAll(/<link\b(?=[^>]*\brel=["']manifest["'])([^>]*)>/gi)];
  assert(allManifestLinks.length === 1, `${route.label}: expected exactly one manifest link in full HTML, got ${allManifestLinks.length}`);
}

async function verifyManifest(): Promise<void> {
  const response = await fetch(new URL('/manifest.json', baseUrl));
  assert(response.status === 200, `manifest.json: expected HTTP 200, got ${response.status}`);
  const manifest = await response.json() as {
    start_url?: string;
    scope?: string;
    display?: string;
    display_override?: string[];
  };

  assert(manifest.start_url === '/', `manifest.json: expected start_url "/", got ${manifest.start_url}`);
  assert(manifest.scope === '/', `manifest.json: expected scope "/", got ${manifest.scope}`);
  assert(manifest.display === 'standalone', `manifest.json: expected display "standalone", got ${manifest.display}`);
  assert(Array.isArray(manifest.display_override) && manifest.display_override.includes('standalone'), 'manifest.json: expected display_override to include "standalone"');

  const kioskResponse = await fetch(new URL('/manifest-yard-kiosk.json', baseUrl));
  assert(
    kioskResponse.status === 200,
    `manifest-yard-kiosk.json: expected HTTP 200, got ${kioskResponse.status}`,
  );
  const kioskManifest = await kioskResponse.json() as {
    id?: string;
    name?: string;
    start_url?: string;
    scope?: string;
    display?: string;
    display_override?: string[];
    theme_color?: string;
    orientation?: string;
    icons?: Array<{ sizes?: string; purpose?: string }>;
  };

  assert(kioskManifest.id === '/yard-kiosk', `manifest-yard-kiosk.json: expected distinct id "/yard-kiosk", got ${kioskManifest.id}`);
  assert(kioskManifest.name === 'Yard Inventory', `manifest-yard-kiosk.json: expected name "Yard Inventory", got ${kioskManifest.name}`);
  assert(kioskManifest.start_url === '/yard-kiosk', `manifest-yard-kiosk.json: expected start_url "/yard-kiosk", got ${kioskManifest.start_url}`);
  assert(kioskManifest.scope === '/yard-kiosk', `manifest-yard-kiosk.json: expected scope "/yard-kiosk", got ${kioskManifest.scope}`);
  assert(kioskManifest.display === 'standalone', `manifest-yard-kiosk.json: expected display "standalone", got ${kioskManifest.display}`);
  assert(kioskManifest.theme_color === '#020617', `manifest-yard-kiosk.json: expected theme_color "#020617", got ${kioskManifest.theme_color}`);
  assert(kioskManifest.orientation === 'landscape', `manifest-yard-kiosk.json: expected orientation "landscape", got ${kioskManifest.orientation}`);
  assert(
    Array.isArray(kioskManifest.display_override)
      && kioskManifest.display_override.includes('standalone'),
    'manifest-yard-kiosk.json: expected display_override to include "standalone"',
  );
  assert(
    kioskManifest.icons?.some((icon) => icon.sizes === '192x192'),
    'manifest-yard-kiosk.json: missing 192x192 icon',
  );
  assert(
    kioskManifest.icons?.some((icon) => icon.sizes === '512x512'),
    'manifest-yard-kiosk.json: missing 512x512 icon',
  );
  assert(
    kioskManifest.icons?.some((icon) => icon.purpose === 'maskable'),
    'manifest-yard-kiosk.json: missing maskable icon',
  );

  const staleManifest = await fetch(new URL('/favicon/site.webmanifest', baseUrl), { redirect: 'manual' });
  assert(staleManifest.status !== 200, 'favicon/site.webmanifest: stale secondary manifest should not be served');
}

async function main() {
  const cookieHeader = readCookieHeader();
  const canCheckAuthenticatedRoutes = Boolean(cookieHeader) && !skipAuthenticatedRoutes;
  const routes = canCheckAuthenticatedRoutes
    ? [...publicRoutes, ...authenticatedRoutes]
    : publicRoutes;

  if (!cookieHeader || skipAuthenticatedRoutes) {
    console.warn('Authenticated PWA head routes were unavailable or deliberately skipped.');
  }

  for (const route of routes) {
    const { html, finalUrl, status } = await fetchHtml(route, cookieHeader);
    verifyHead(route, html, finalUrl, status);
    console.log(`PWA head OK: ${route.label} -> ${new URL(finalUrl).pathname}`);
  }

  await verifyManifest();
  console.log('PWA manifests OK: site and Yard kiosk install identities are distinct');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
