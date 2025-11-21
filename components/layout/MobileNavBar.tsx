'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useEffect, useState } from 'react';

export function MobileNavBar() {
  const router = useRouter();
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [isPWA, setIsPWA] = useState(false);

  useEffect(() => {
    // Check if running as PWA (standalone mode)
    const checkPWAMode = () => {
      // Check for standalone mode (Android, iOS)
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
      // Check for iOS Safari standalone
      const isIOSStandalone = (window.navigator as any).standalone === true;
      
      setIsPWA(isStandalone || isIOSStandalone);
    };

    checkPWAMode();

    // Check if browser can go back/forward
    const checkNavigation = () => {
      setCanGoBack(window.history.length > 1);
      // Forward is harder to detect, so we'll keep it grey for now
      setCanGoForward(false);
    };

    checkNavigation();

    // Listen for navigation changes
    window.addEventListener('popstate', checkNavigation);
    return () => window.removeEventListener('popstate', checkNavigation);
  }, []);

  const handleBack = () => {
    if (canGoBack) {
      router.back();
    }
  };

  const handleForward = () => {
    if (canGoForward) {
      router.forward();
    }
  };

  // Only render if in PWA mode
  if (!isPWA) {
    return null;
  }

  return (
    <div className="md:hidden fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-700 z-50 safe-area-inset-bottom">
      <div className="flex items-center justify-around h-28 px-4">
        {/* Back Button */}
        <button
          onClick={handleBack}
          disabled={!canGoBack}
          className={`p-3 rounded-lg transition-colors ${
            canGoBack
              ? 'text-white hover:bg-slate-800'
              : 'text-slate-600 cursor-not-allowed'
          }`}
          aria-label="Go back"
        >
          <ArrowLeft className="w-6 h-6" />
        </button>

        {/* Forward Button */}
        <button
          onClick={handleForward}
          disabled={!canGoForward}
          className={`p-3 rounded-lg transition-colors ${
            canGoForward
              ? 'text-white hover:bg-slate-800'
              : 'text-slate-600 cursor-not-allowed'
          }`}
          aria-label="Go forward"
        >
          <ArrowRight className="w-6 h-6" />
        </button>
      </div>
    </div>
  );
}

