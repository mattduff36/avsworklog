'use client';

import { useEffect } from 'react';

const YARD_KIOSK_CHROME_COLOR = '#020617';

export function YardKioskStatusBar() {
  useEffect(() => {
    const themeMeta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    );
    const viewport = window.visualViewport;
    const previousThemeColor = themeMeta?.content;
    const previousHtmlBackground = document.documentElement.style.backgroundColor;
    const previousBodyBackground = document.body.style.backgroundColor;
    const previousBodyImage = document.body.style.backgroundImage;
    const previousViewportHeight = document.documentElement.style.getPropertyValue(
      '--yard-kiosk-viewport-height',
    );

    function updateViewportHeight() {
      const height = viewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty(
        '--yard-kiosk-viewport-height',
        `${Math.floor(height)}px`,
      );
    }

    if (themeMeta) {
      themeMeta.content = YARD_KIOSK_CHROME_COLOR;
    }

    updateViewportHeight();
    document.documentElement.style.backgroundColor = YARD_KIOSK_CHROME_COLOR;
    document.body.style.backgroundColor = YARD_KIOSK_CHROME_COLOR;
    document.body.style.backgroundImage = 'none';
    window.addEventListener('resize', updateViewportHeight);
    window.addEventListener('orientationchange', updateViewportHeight);
    window.addEventListener('pageshow', updateViewportHeight);
    viewport?.addEventListener('resize', updateViewportHeight);

    return () => {
      if (themeMeta && previousThemeColor) {
        themeMeta.content = previousThemeColor;
      }
      window.removeEventListener('resize', updateViewportHeight);
      window.removeEventListener('orientationchange', updateViewportHeight);
      window.removeEventListener('pageshow', updateViewportHeight);
      viewport?.removeEventListener('resize', updateViewportHeight);
      if (previousViewportHeight) {
        document.documentElement.style.setProperty(
          '--yard-kiosk-viewport-height',
          previousViewportHeight,
        );
      } else {
        document.documentElement.style.removeProperty('--yard-kiosk-viewport-height');
      }
      document.documentElement.style.backgroundColor = previousHtmlBackground;
      document.body.style.backgroundColor = previousBodyBackground;
      document.body.style.backgroundImage = previousBodyImage;
    };
  }, []);

  return null;
}
