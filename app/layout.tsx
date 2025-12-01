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
        <link rel="icon" href="/favicon.ico" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon-180x180.png" />
        <link rel="apple-touch-icon" sizes="152x152" href="/apple-touch-icon-152x152.png" />
        <link rel="apple-touch-icon" sizes="167x167" href="/apple-touch-icon-167x167.png" />
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
