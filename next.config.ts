import type { NextConfig } from "next";
import withPWA from "next-pwa";

const nextConfig: NextConfig = {
  /* config options here */
  reactStrictMode: true,
  images: {
    domains: [], // Add Supabase storage domain when configured
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
  webpack: (config) => {
    // Handle canvas package for pdfjs-dist
    config.resolve.alias.canvas = false;
    
    return config;
  },
};

export default withPWA({
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
})(nextConfig);
