import type { NextConfig } from "next";
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
    ignoreDuringBuilds: false,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    
    // Disable persistent cache to avoid noisy PackFile serialization warnings in CI.
    config.cache = false;
    
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

export default bundleAnalyzer(nextConfig);
