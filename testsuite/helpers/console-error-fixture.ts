/**
 * Shared Playwright fixture that captures page errors and severe console messages.
 * Attach to any test tagged @critical to automatically fail on JS exceptions.
 */
import { Page } from '@playwright/test';

interface CapturedError {
  type: 'pageerror' | 'console';
  message: string;
  url?: string;
}

export function attachConsoleErrorCapture(page: Page): {
  getErrors: () => CapturedError[];
  clear: () => void;
} {
  const errors: CapturedError[] = [];

  page.on('pageerror', (err) => {
    // Ignore known benign dev mode errors
    if (
      err.message.includes('Invalid or unexpected token') ||
      err.message.includes('Hydration') ||
      err.message.includes('Failed to fetch')
    ) {
      return;
    }
    errors.push({
      type: 'pageerror',
      message: err.message,
      url: page.url(),
    });
  });

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Ignore known benign console errors (dev mode noise)
      if (
        text.includes('Download the React DevTools') ||
        text.includes('favicon.ico') ||
        text.includes('[Fast Refresh]') ||
        text.includes('Failed to fetch') ||
        text.includes('ERR_CONNECTION_REFUSED') ||
        text.includes('net::ERR')
      ) {
        return;
      }
      errors.push({
        type: 'console',
        message: text,
        url: page.url(),
      });
    }
  });

  return {
    getErrors: () => [...errors],
    clear: () => {
      errors.length = 0;
    },
  };
}
