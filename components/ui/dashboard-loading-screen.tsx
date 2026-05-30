'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './dashboard-loading-screen.module.css';

export function DashboardLoadingScreen() {
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setPortalRoot(document.body);
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, []);

  const screen = (
    <div className={styles.screen} role="status" aria-live="polite" aria-label="Loading SquireApp">
      <div className={styles.content}>
        <div className={styles.progressTrack} aria-hidden="true">
          <div className={styles.progressBar} />
        </div>
        <p className={styles.label}>Loading SquireApp</p>
      </div>
    </div>
  );

  return portalRoot ? createPortal(screen, portalRoot) : screen;
}
