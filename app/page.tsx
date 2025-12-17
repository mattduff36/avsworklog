'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    // Auto-redirect based on online status
    if (typeof navigator !== 'undefined') {
      if (navigator.onLine) {
        router.push('/dashboard');
      } else {
        // Redirect to offline page when offline
        router.push('/offline');
      }
    }
  }, [router]);

  const handleGoToDashboard = () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      router.push('/offline');
    } else {
      router.push('/dashboard');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-950 flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center space-y-6">
        {/* Logo/Brand */}
        <div className="space-y-2">
          <h1 className="text-4xl font-bold text-white">
            Squires
          </h1>
          <p className="text-slate-400 text-lg">
            Digital Forms Management
          </p>
        </div>

        {/* Info Card */}
        <div className="bg-slate-800/30 backdrop-blur border border-slate-700 rounded-lg p-6 space-y-4">
          <p className="text-slate-300 text-sm">
            Opening your dashboard...
          </p>
          <p className="text-slate-400 text-xs">
            This app requires an internet connection to work.
          </p>
        </div>

        {/* Action Button */}
        <Button
          variant="ghost"
          onClick={handleGoToDashboard}
          size="lg"
          className="w-full bg-avs-yellow text-slate-900 [&]:text-slate-900 hover:bg-avs-yellow/90 font-semibold"
        >
          Go to Dashboard
        </Button>
      </div>
    </div>
  );
}
