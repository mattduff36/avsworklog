'use client';

import { WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

// Force static generation for this page
export const dynamic = 'force-static';

export default function OfflinePage() {
  const handleRetry = () => {
    window.location.reload();
  };

  return (
    <div className="min-h-screen flex items-start justify-center p-4 pt-12 sm:pt-16 md:pt-24 relative overflow-hidden bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950">
      {/* Subtle background pattern */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(241,214,74,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(241,214,74,0.03)_1px,transparent_1px)] bg-[size:64px_64px]" />

      <div className="w-full max-w-md relative z-10">
        {/* Icon */}
        <div className="flex justify-center mb-6">
          <div className="bg-amber-500 rounded-2xl p-5 shadow-lg shadow-amber-500/20">
            <WifiOff className="h-10 w-10 text-slate-900" strokeWidth={2.5} />
          </div>
        </div>

        {/* Title */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">SQUIRES</h1>
          <p className="text-slate-400 text-lg">Cannot Connect</p>
        </div>

        {/* Glass-morphism Card */}
        <Card className="bg-slate-800/40 backdrop-blur-xl border-slate-700/50 shadow-2xl">
          <CardContent className="p-8">
            <div className="space-y-6 text-center">
              <div className="space-y-3">
                <h2 className="text-xl font-semibold text-white">
                  No Internet Connection
                </h2>
                <p className="text-slate-300 text-sm leading-relaxed">
                  The app needs an active internet connection to work. Please check your WiFi or mobile data and try again.
                </p>
              </div>

              <div className="pt-2">
                <Button
                  variant="ghost"
                  onClick={handleRetry}
                  className="w-full h-12 bg-avs-yellow hover:bg-avs-yellow-hover text-slate-900 [&]:text-slate-900 font-semibold text-base shadow-lg shadow-avs-yellow/20 transition-all"
                >
                  Try Again
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="mt-6 text-center text-sm text-slate-400">
          <p>This app requires an active internet connection</p>
        </div>
      </div>
    </div>
  );
}

