'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    // Immediate redirect to dashboard
    router.replace('/dashboard');
  }, [router]);

  // Show minimal loading state during redirect
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-950 flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-white mb-2">Squires</h1>
        <p className="text-slate-400">Loading...</p>
      </div>
    </div>
  );
}
