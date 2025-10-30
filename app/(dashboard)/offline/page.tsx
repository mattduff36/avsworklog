'use client';

import { WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';

export default function OfflinePage() {
  const router = useRouter();

  const handleRetry = () => {
    if (navigator.onLine) {
      router.push('/dashboard');
    } else {
      alert('Still offline. Please connect to the internet.');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-950 flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center space-y-6">
        {/* Icon */}
        <div className="flex justify-center">
          <div className="w-24 h-24 rounded-full bg-slate-800/50 backdrop-blur flex items-center justify-center">
            <WifiOff className="w-12 h-12 text-amber-400" />
          </div>
        </div>

        {/* Title */}
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-white">
            You're Offline
          </h1>
          <p className="text-slate-400 text-lg">
            This page hasn't been cached yet
          </p>
        </div>

        {/* Description */}
        <div className="bg-slate-800/30 backdrop-blur border border-slate-700 rounded-lg p-6 space-y-3 text-left">
          <p className="text-slate-300 text-sm">
            <strong className="text-white">What happened?</strong>
          </p>
          <p className="text-slate-400 text-sm">
            You tried to visit a page that hasn't been loaded while online yet. 
            The app needs to cache pages before they work offline.
          </p>
          <p className="text-slate-300 text-sm">
            <strong className="text-white">What to do:</strong>
          </p>
          <ol className="text-slate-400 text-sm space-y-2 list-decimal list-inside">
            <li>Connect to WiFi or mobile data</li>
            <li>Navigate to the pages you need</li>
            <li>Those pages will then work offline</li>
          </ol>
        </div>

        {/* Action */}
        <Button
          onClick={handleRetry}
          size="lg"
          className="w-full bg-avs-yellow text-slate-900 hover:bg-avs-yellow/90 font-semibold"
        >
          Retry Connection
        </Button>

        {/* Cached Pages Info */}
        <div className="text-sm text-slate-500">
          <p>Cached pages will load automatically when offline</p>
        </div>
      </div>
    </div>
  );
}

