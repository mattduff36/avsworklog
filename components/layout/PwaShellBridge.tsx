'use client';

import { useEffect } from 'react';

interface IOSNavigator extends Navigator {
  standalone?: boolean;
}

function isIOSStandalonePwa() {
  if (typeof window === 'undefined') return false;

  return (window.navigator as IOSNavigator).standalone === true;
}

function isStandalonePwa() {
  if (typeof window === 'undefined') return false;

  const hasStandaloneDisplayMode =
    typeof window.matchMedia === 'function' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches);

  return hasStandaloneDisplayMode || isIOSStandalonePwa();
}

function isPlainLeftClick(event: MouseEvent) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

function syncStandaloneAttribute() {
  document.documentElement.toggleAttribute('data-standalone-pwa', isStandalonePwa());
}

function getInternalAppLink(event: MouseEvent) {
  if (event.defaultPrevented || !isPlainLeftClick(event)) return null;
  if (!(event.target instanceof Element)) return null;

  const anchor = event.target.closest<HTMLAnchorElement>('a[href]');
  if (!anchor) return null;
  if (anchor.target && anchor.target !== '_self') return null;
  if (anchor.hasAttribute('download')) return null;

  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin) return null;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_next/')) return null;
  if (`${url.pathname}${url.search}` === `${window.location.pathname}${window.location.search}` && url.hash) {
    return null;
  }

  return url.href;
}

export function PwaShellBridge() {
  useEffect(() => {
    syncStandaloneAttribute();

    if (typeof window.matchMedia !== 'function') {
      return () => document.documentElement.removeAttribute('data-standalone-pwa');
    }

    const standaloneMedia = window.matchMedia('(display-mode: standalone)');
    standaloneMedia.addEventListener('change', syncStandaloneAttribute);

    return () => {
      standaloneMedia.removeEventListener('change', syncStandaloneAttribute);
      document.documentElement.removeAttribute('data-standalone-pwa');
    };
  }, []);

  useEffect(() => {
    if (!isIOSStandalonePwa()) return;

    function handleClick(event: MouseEvent) {
      const href = getInternalAppLink(event);
      if (!href) return;

      event.preventDefault();
      window.location.href = href;
    }

    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, []);

  return null;
}
