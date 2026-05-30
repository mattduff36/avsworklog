'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

function isStandalonePwa() {
  if (typeof window === 'undefined') return false;

  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

function isPlainLeftClick(event: MouseEvent) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

function syncStandaloneAttribute() {
  document.documentElement.toggleAttribute('data-standalone-pwa', isStandalonePwa());
}

export function PwaShellBridge() {
  const router = useRouter();

  useEffect(() => {
    syncStandaloneAttribute();

    const standaloneMedia = window.matchMedia('(display-mode: standalone)');
    standaloneMedia.addEventListener('change', syncStandaloneAttribute);

    return () => {
      standaloneMedia.removeEventListener('change', syncStandaloneAttribute);
      document.documentElement.removeAttribute('data-standalone-pwa');
    };
  }, []);

  useEffect(() => {
    if (!isStandalonePwa()) return;

    function handleClick(event: MouseEvent) {
      if (event.defaultPrevented || !isPlainLeftClick(event)) return;
      if (!(event.target instanceof Element)) return;

      const anchor = event.target.closest<HTMLAnchorElement>('a[href]');
      if (!anchor) return;
      if (anchor.target && anchor.target !== '_self') return;
      if (anchor.hasAttribute('download')) return;

      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_next/')) return;

      event.preventDefault();
      router.push(`${url.pathname}${url.search}${url.hash}`);
    }

    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [router]);

  return null;
}
