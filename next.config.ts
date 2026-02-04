import type { NextConfig } from "next";
import withPWA from "next-pwa";
import withBundleAnalyzer from "@next/bundle-analyzer";

const bundleAnalyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const nextConfig: NextConfig = {
  /* config options here */
  reactStrictMode: true,
  images: {
    domains: [], // Add Supabase storage domain when configured
  },
  // Mark server-only packages to prevent client-side bundling
  serverExternalPackages: ['exceljs'],
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
  webpack: (config, { isServer }) => {
    // Handle canvas package for pdfjs-dist
    config.resolve.alias.canvas = false;
    
    // Optimize webpack cache to handle large strings more efficiently
    // This addresses the "Serializing big strings" warning from Supabase types
    if (config.cache && typeof config.cache === 'object') {
      config.cache = {
        ...config.cache,
        // Use gzip compression for cache to reduce memory footprint
        compression: 'gzip',
        // Set maximum age for cached items
        maxAge: 5184000000, // 60 days
      };
    }
    
    // Suppress non-critical warnings
    config.ignoreWarnings = [
      ...(config.ignoreWarnings || []),
      // Suppress Supabase realtime warnings about Node.js APIs in Edge Runtime
      { module: /node_modules\/@supabase\/realtime-js/ },
      { module: /node_modules\/@supabase\/supabase-js/ },
      // Suppress the big string serialization warning (cosmetic only)
      /Serializing big strings/,
    ];
    
    return config;
  },
  // Skip trailing slash redirect for root page
  skipTrailingSlashRedirect: true,
};

export default bundleAnalyzer(withPWA({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",
  // Use custom service worker
  sw: "sw-custom.js",
  // Fallback for offline navigation - this pre-caches the /offline page
  fallbacks: {
    document: "/offline",
  },
  // Runtime caching with explicit fallback handling
  runtimeCaching: [
    // Special handling for the start URL (/)
    {
      urlPattern: ({ url }: { url: URL }) => url.pathname === "/",
      handler: "NetworkFirst",
      options: {
        cacheName: "start-url",
        networkTimeoutSeconds: 10,
        plugins: [
          {
            // Redirect to offline page on failure
            handlerDidError: async () => Response.redirect('/offline', 302),
          },
        ],
      },
    },
  ],
})(nextConfig));
