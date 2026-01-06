import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import { Toaster } from "@/components/ui/sonner";
import { QueryProvider } from "@/lib/providers/query-provider";
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { ErrorLoggerInit } from "@/components/ErrorLoggerInit";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Squires - A&V Squires Plant Co. Ltd.",
  description: "Digital forms management system for timesheets and vehicle inspections",
  manifest: "/manifest.json",
  // Note: favicon.ico in app/ directory is automatically served by Next.js at /favicon.ico
  icons: [
    { rel: "icon", url: "/favicon.ico" },
    { rel: "apple-touch-icon", url: "/apple-touch-icon.png", sizes: "180x180" },
    { rel: "apple-touch-icon", url: "/apple-touch-icon-180x180.png", sizes: "180x180" },
    { rel: "apple-touch-icon", url: "/apple-touch-icon-152x152.png", sizes: "152x152" },
    { rel: "apple-touch-icon", url: "/apple-touch-icon-167x167.png", sizes: "167x167" },
  ],
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Squires",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#F1D64A",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning style={{ colorScheme: 'dark' }}>
      <head>
        <link rel="icon" type="image/x-icon" href="/favicon.ico" />
        <link rel="shortcut icon" type="image/x-icon" href="/favicon.ico" />
        <meta name="color-scheme" content="dark" />
      </head>
      <body className={`${inter.variable} font-sans antialiased`}>
        <ErrorLoggerInit />
        <NuqsAdapter>
          <QueryProvider>
            {children}
            <Toaster />
            <Analytics />
          </QueryProvider>
        </NuqsAdapter>
      </body>
    </html>
  );
}
