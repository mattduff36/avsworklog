'use client';

import { useEffect } from 'react';

const YARD_KIOSK_CHROME_COLOR = '#020617';

export function YardKioskStatusBar() {
  useEffect(() => {
    const themeMeta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    );
    const previousThemeColor = themeMeta?.content;
    const previousHtmlBackground = document.documentElement.style.backgroundColor;
    const previousBodyBackground = document.body.style.backgroundColor;
    const previousBodyImage = document.body.style.backgroundImage;

    if (themeMeta) {
      themeMeta.content = YARD_KIOSK_CHROME_COLOR;
    }

    document.documentElement.style.backgroundColor = YARD_KIOSK_CHROME_COLOR;
    document.body.style.backgroundColor = YARD_KIOSK_CHROME_COLOR;
    document.body.style.backgroundImage = 'none';

    return () => {
      if (themeMeta && previousThemeColor) {
        themeMeta.content = previousThemeColor;
      }
      document.documentElement.style.backgroundColor = previousHtmlBackground;
      document.body.style.backgroundColor = previousBodyBackground;
      document.body.style.backgroundImage = previousBodyImage;
    };
  }, []);

  return null;
}
