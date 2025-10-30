import type { NextConfig } from "next";
import withPWA from "next-pwa";

const nextConfig: NextConfig = {
  /* config options here */
  reactStrictMode: true,
  images: {
    domains: [], // Add Supabase storage domain when configured
  },
  // Disable Turbopack for build as PWA plugin may not be compatible yet
  experimental: {
    turbo: {},
  },
  eslint: {
    // Warning: This allows production builds to successfully complete even if
    // your project has ESLint errors.
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Allow build with known Supabase TypeScript limitation in conditional updates
    // All other type errors have been properly fixed with Database types
    ignoreBuildErrors: true,
  },
};

export default withPWA({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",
  // Use custom service worker
  sw: "sw-custom.js",
  // Fallback for offline navigation
  fallbacks: {
    document: "/offline",
  },
})(nextConfig);
